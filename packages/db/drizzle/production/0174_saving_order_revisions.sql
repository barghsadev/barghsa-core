CREATE TABLE saving_order_revisions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
  order_id uuid NOT NULL REFERENCES saving_orders(id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  previous_version_id uuid NOT NULL REFERENCES contract_versions(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES contract_versions(id) ON DELETE RESTRICT,
  previous_snapshot jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saving_order_revisions_snapshot CHECK (jsonb_typeof(previous_snapshot)='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX saving_order_revisions_user_key ON saving_order_revisions(user_id,idempotency_key);
--> statement-breakpoint
CREATE INDEX saving_order_revisions_order_idx ON saving_order_revisions(order_id,created_at);
--> statement-breakpoint
CREATE FUNCTION guard_saving_order_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saving order revision history is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER saving_order_revision_guard BEFORE UPDATE OR DELETE ON saving_order_revisions
FOR EACH ROW EXECUTE FUNCTION guard_saving_order_revision();
--> statement-breakpoint
CREATE FUNCTION move_saving_inventory_on_hardware_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_res saving_inventory_reservations%ROWTYPE; new_hardware products%ROWTYPE;
  old_hardware products%ROWTYPE; invoice_state text;
BEGIN
  IF OLD.hardware_product_id=NEW.hardware_product_id THEN RETURN NEW; END IF;
  IF OLD.status<>'awaiting_staff_review' OR OLD.financial_status<>'unpaid' THEN
    RAISE EXCEPTION 'Saving hardware cannot change after review or payment' USING ERRCODE='23514';
  END IF;
  SELECT state INTO invoice_state FROM invoices WHERE order_id=OLD.order_id AND type='auto'
    AND replaces_invoice_id IS NULL AND adjustment_for_invoice_id IS NULL FOR UPDATE;
  IF invoice_state IS DISTINCT FROM 'Unpaid' THEN
    RAISE EXCEPTION 'Saving hardware requires an unpaid invoice' USING ERRCODE='23514';
  END IF;
  PERFORM id FROM products WHERE id IN (OLD.hardware_product_id,NEW.hardware_product_id)
    ORDER BY id FOR UPDATE;
  SELECT * INTO old_hardware FROM products WHERE id=OLD.hardware_product_id;
  SELECT * INTO new_hardware FROM products WHERE id=NEW.hardware_product_id;
  SELECT * INTO old_res FROM saving_inventory_reservations WHERE order_id=NEW.id FOR UPDATE;
  IF old_res.id IS NOT NULL AND old_res.hardware_product_id<>OLD.hardware_product_id THEN
    RAISE EXCEPTION 'Saving inventory reservation does not match the order' USING ERRCODE='23514';
  END IF;
  IF old_res.id IS NOT NULL AND old_res.status='allocated' THEN
    RAISE EXCEPTION 'Allocated hardware cannot be changed' USING ERRCODE='23514';
  END IF;
  IF old_res.id IS NOT NULL AND old_res.status='reserved' THEN
    UPDATE products SET reserved_count=reserved_count-1 WHERE id=old_hardware.id;
    PERFORM audit_saving_inventory(NEW.id,old_res.id,'released');
  END IF;
  IF new_hardware.stock_tracking THEN
    IF new_hardware.stock_count <= new_hardware.reserved_count THEN
      RAISE EXCEPTION 'Saving hardware is out of stock' USING ERRCODE='23514';
    END IF;
    UPDATE products SET reserved_count=reserved_count+1 WHERE id=new_hardware.id;
    IF old_res.id IS NULL THEN
      INSERT INTO saving_inventory_reservations(order_id,hardware_product_id,expires_at)
        VALUES(NEW.id,new_hardware.id,clock_timestamp()+make_interval(mins=>new_hardware.reservation_minutes));
    ELSE
      UPDATE saving_inventory_reservations SET hardware_product_id=new_hardware.id,status='reserved',
        expires_at=clock_timestamp()+make_interval(mins=>new_hardware.reservation_minutes),
        allocated_at=NULL,released_at=NULL WHERE id=old_res.id;
    END IF;
    PERFORM audit_saving_inventory(NEW.id,
      (SELECT id FROM saving_inventory_reservations WHERE order_id=NEW.id),'reserved');
  ELSIF old_res.id IS NOT NULL THEN
    UPDATE saving_inventory_reservations SET hardware_product_id=new_hardware.id,status='released',
      released_at=clock_timestamp(),allocated_at=NULL WHERE id=old_res.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_inventory_on_hardware_change
AFTER UPDATE OF hardware_product_id ON saving_orders FOR EACH ROW
WHEN (OLD.hardware_product_id IS DISTINCT FROM NEW.hardware_product_id)
EXECUTE FUNCTION move_saving_inventory_on_hardware_change();

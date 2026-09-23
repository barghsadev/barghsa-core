CREATE TABLE "saving_hardware_amendments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"contract_version_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"previous_hardware_id" uuid NOT NULL,
	"hardware_id" uuid NOT NULL,
	"previous_snapshot" jsonb NOT NULL,
	"hardware_snapshot" jsonb NOT NULL,
	"original_invoice_id" uuid NOT NULL,
	"price_delta_irr" bigint DEFAULT '0' NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saving_hardware_amendments_distinct" CHECK ("saving_hardware_amendments"."previous_hardware_id"<>"saving_hardware_amendments"."hardware_id"),
	CONSTRAINT "saving_hardware_amendments_snapshots" CHECK (jsonb_typeof("saving_hardware_amendments"."previous_snapshot")='object' AND jsonb_typeof("saving_hardware_amendments"."hardware_snapshot")='object'),
	CONSTRAINT "saving_hardware_amendments_reason" CHECK (length(trim("saving_hardware_amendments"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "saving_hardware_amendments_zero_delta" CHECK ("saving_hardware_amendments"."price_delta_irr"=0)
);
--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_order_id_saving_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."saving_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_contract_version_id_contract_versions_id_fk" FOREIGN KEY ("contract_version_id") REFERENCES "public"."contract_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_actor_user_id_users_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_previous_hardware_id_products_id_fk" FOREIGN KEY ("previous_hardware_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_hardware_id_products_id_fk" FOREIGN KEY ("hardware_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_original_invoice_id_invoices_id_fk" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saving_hardware_amendments_order_idx" ON "saving_hardware_amendments" USING btree ("order_id","created_at","id");
--> statement-breakpoint
CREATE FUNCTION guard_saving_hardware_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saving hardware amendment history is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER saving_hardware_amendment_guard BEFORE UPDATE OR DELETE ON saving_hardware_amendments
FOR EACH ROW EXECUTE FUNCTION guard_saving_hardware_amendment();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION move_saving_inventory_on_hardware_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_res saving_inventory_reservations%ROWTYPE; new_hardware products%ROWTYPE;
  old_hardware products%ROWTYPE; invoice_state text; paid_invoice_id uuid;
BEGIN
  IF OLD.hardware_product_id=NEW.hardware_product_id THEN RETURN NEW; END IF;
  IF OLD.financial_status='paid' AND NEW.financial_status='paid' THEN
    SELECT i.id,i.state INTO paid_invoice_id,invoice_state FROM invoices i
      WHERE i.order_id=OLD.order_id AND i.type='auto'
        AND i.replaces_invoice_id IS NULL AND i.adjustment_for_invoice_id IS NULL FOR UPDATE;
    IF OLD.status NOT IN ('approved','in_progress') OR NEW.status<>OLD.status
      OR invoice_state IS DISTINCT FROM 'Paid'
      OR NOT EXISTS (
        SELECT 1 FROM saving_hardware_amendments a
         WHERE a.order_id=NEW.id AND a.previous_hardware_id=OLD.hardware_product_id
           AND a.hardware_id=NEW.hardware_product_id AND a.original_invoice_id=paid_invoice_id
           AND a.created_at>=transaction_timestamp()
      )
      OR NOT EXISTS (
        SELECT 1 FROM saving_fulfillment_stages f WHERE f.order_id=NEW.id
          AND f.stage='product_delivery' AND f.status='in_progress'
      )
      OR EXISTS (
        SELECT 1 FROM saving_fulfillment_stages f WHERE f.order_id=NEW.id
          AND f.stage IN ('installation_and_document_upload','equipment_handover','process_completion')
          AND f.status<>'pending'
      ) THEN
      RAISE EXCEPTION 'Paid saving hardware requires a current pre-delivery amendment' USING ERRCODE='23514';
    END IF;
    PERFORM id FROM products WHERE id IN (OLD.hardware_product_id,NEW.hardware_product_id)
      ORDER BY id FOR UPDATE;
    SELECT * INTO old_hardware FROM products WHERE id=OLD.hardware_product_id;
    SELECT * INTO new_hardware FROM products WHERE id=NEW.hardware_product_id;
    SELECT * INTO old_res FROM saving_inventory_reservations WHERE order_id=NEW.id FOR UPDATE;
    IF old_res.id IS NOT NULL AND
       (old_res.hardware_product_id<>OLD.hardware_product_id OR old_res.status<>'allocated') THEN
      RAISE EXCEPTION 'Saving inventory allocation does not match the paid order' USING ERRCODE='23514';
    END IF;
    IF old_hardware.stock_tracking AND old_res.id IS NULL THEN
      RAISE EXCEPTION 'Paid saving hardware lacks its inventory allocation' USING ERRCODE='23514';
    END IF;
    IF new_hardware.stock_tracking AND new_hardware.stock_count<=new_hardware.reserved_count THEN
      RAISE EXCEPTION 'Saving hardware is out of stock' USING ERRCODE='23514';
    END IF;
    IF old_hardware.stock_tracking THEN
      UPDATE products SET stock_count=stock_count+1 WHERE id=old_hardware.id;
    END IF;
    IF new_hardware.stock_tracking THEN
      UPDATE products SET stock_count=stock_count-1 WHERE id=new_hardware.id;
      IF old_res.id IS NULL THEN
        INSERT INTO saving_inventory_reservations(order_id,hardware_product_id,status,expires_at,allocated_at)
          VALUES(NEW.id,new_hardware.id,'allocated',clock_timestamp(),clock_timestamp());
      ELSE
        UPDATE saving_inventory_reservations SET hardware_product_id=new_hardware.id,
          status='allocated',allocated_at=clock_timestamp(),released_at=NULL WHERE id=old_res.id;
      END IF;
    ELSIF old_res.id IS NOT NULL THEN
      UPDATE saving_inventory_reservations SET hardware_product_id=new_hardware.id,
        status='released',released_at=clock_timestamp(),allocated_at=NULL WHERE id=old_res.id;
    END IF;
    PERFORM audit_saving_inventory(NEW.id,
      (SELECT id FROM saving_inventory_reservations WHERE order_id=NEW.id),'swapped');
    RETURN NEW;
  END IF;
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

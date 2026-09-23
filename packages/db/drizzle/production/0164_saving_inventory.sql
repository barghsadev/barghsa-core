CREATE TABLE "saving_inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"hardware_product_id" uuid NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"allocated_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saving_inventory_reservation_status" CHECK ("saving_inventory_reservations"."status" IN ('reserved','allocated','expired','released'))
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stock_tracking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stock_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reserved_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reservation_minutes" integer DEFAULT 1440 NOT NULL;--> statement-breakpoint
ALTER TABLE "saving_inventory_reservations" ADD CONSTRAINT "saving_inventory_reservations_order_id_saving_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."saving_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_inventory_reservations" ADD CONSTRAINT "saving_inventory_reservations_hardware_product_id_products_id_fk" FOREIGN KEY ("hardware_product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saving_inventory_reservation_order_key" ON "saving_inventory_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "saving_inventory_reservation_expiry_idx" ON "saving_inventory_reservations" USING btree ("status","expires_at");
--> statement-breakpoint
ALTER TABLE products ADD CONSTRAINT hardware_inventory_counts
CHECK (stock_count >= 0 AND reserved_count >= 0 AND reserved_count <= stock_count
  AND reservation_minutes BETWEEN 5 AND 10080
  AND (type='hardware' OR (NOT stock_tracking AND stock_count=0 AND reserved_count=0)));
--> statement-breakpoint
CREATE FUNCTION audit_saving_inventory(target_order uuid, reservation_id uuid, state_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE affected_user text;
BEGIN
  SELECT o.user_id INTO affected_user FROM saving_orders s JOIN orders o ON o.id=s.order_id
    WHERE s.id=target_order;
  INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
    VALUES(uuid_generate_v7()::text,affected_user,'saving.inventory.'||state_name,
      jsonb_build_object('savingOrderId',target_order,'reservationId',reservation_id)::text,
      uuid_generate_v7()::text);
END $$;
--> statement-breakpoint
CREATE FUNCTION reserve_saving_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hardware products%ROWTYPE;
BEGIN
  SELECT * INTO hardware FROM products WHERE id=NEW.hardware_product_id FOR UPDATE;
  IF NOT hardware.stock_tracking THEN RETURN NEW; END IF;
  IF hardware.stock_count <= hardware.reserved_count THEN
    RAISE EXCEPTION 'Saving hardware is out of stock' USING ERRCODE='23514';
  END IF;
  UPDATE products SET reserved_count=reserved_count+1 WHERE id=hardware.id;
  INSERT INTO saving_inventory_reservations(order_id,hardware_product_id,expires_at)
  VALUES(NEW.id,hardware.id,clock_timestamp()+make_interval(mins=>hardware.reservation_minutes));
  PERFORM audit_saving_inventory(NEW.id,
    (SELECT id FROM saving_inventory_reservations WHERE order_id=NEW.id),'reserved');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_inventory_on_order
AFTER INSERT ON saving_orders FOR EACH ROW EXECUTE FUNCTION reserve_saving_inventory();
--> statement-breakpoint
CREATE FUNCTION allocate_saving_inventory(target_order uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE hardware products%ROWTYPE; reservation saving_inventory_reservations%ROWTYPE;
BEGIN
  SELECT p.* INTO hardware FROM saving_orders s JOIN products p ON p.id=s.hardware_product_id
    WHERE s.id=target_order FOR UPDATE OF p;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO reservation FROM saving_inventory_reservations WHERE order_id=target_order FOR UPDATE;
  IF FOUND AND reservation.status='allocated' THEN RETURN; END IF;
  IF FOUND AND reservation.status='reserved' THEN
    IF reservation.expires_at>clock_timestamp() THEN
      UPDATE products SET stock_count=stock_count-1,reserved_count=reserved_count-1 WHERE id=hardware.id;
      UPDATE saving_inventory_reservations SET status='allocated',allocated_at=clock_timestamp()
        WHERE id=reservation.id;
      PERFORM audit_saving_inventory(target_order,reservation.id,'allocated');
      RETURN;
    END IF;
    UPDATE products SET reserved_count=reserved_count-1 WHERE id=hardware.id;
    UPDATE saving_inventory_reservations SET status='expired',released_at=clock_timestamp()
      WHERE id=reservation.id;
    PERFORM audit_saving_inventory(target_order,reservation.id,'expired');
    hardware.reserved_count:=hardware.reserved_count-1;
  END IF;
  IF NOT hardware.stock_tracking THEN RETURN; END IF;
  IF hardware.stock_count <= hardware.reserved_count THEN
    RAISE EXCEPTION 'Saving hardware is out of stock' USING ERRCODE='23514';
  END IF;
  UPDATE products SET stock_count=stock_count-1 WHERE id=hardware.id;
  IF reservation.id IS NULL THEN
    INSERT INTO saving_inventory_reservations(order_id,hardware_product_id,status,expires_at,allocated_at)
      VALUES(target_order,hardware.id,'allocated',clock_timestamp(),clock_timestamp());
  ELSE
    UPDATE saving_inventory_reservations SET status='allocated',allocated_at=clock_timestamp(),released_at=NULL
      WHERE id=reservation.id;
  END IF;
  PERFORM audit_saving_inventory(target_order,
    (SELECT id FROM saving_inventory_reservations WHERE order_id=target_order),'allocated');
END $$;
--> statement-breakpoint
CREATE FUNCTION release_saving_inventory(target_order uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE hardware products%ROWTYPE; reservation saving_inventory_reservations%ROWTYPE;
BEGIN
  SELECT p.* INTO hardware FROM saving_inventory_reservations r JOIN products p ON p.id=r.hardware_product_id
    WHERE r.order_id=target_order FOR UPDATE OF p;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO reservation FROM saving_inventory_reservations WHERE order_id=target_order FOR UPDATE;
  IF reservation.status='reserved' THEN
    UPDATE products SET reserved_count=reserved_count-1 WHERE id=hardware.id;
  ELSIF reservation.status='allocated' THEN
    UPDATE products SET stock_count=stock_count+1 WHERE id=hardware.id;
  ELSE RETURN;
  END IF;
  UPDATE saving_inventory_reservations SET status='released',released_at=clock_timestamp()
    WHERE id=reservation.id;
  PERFORM audit_saving_inventory(target_order,reservation.id,'released');
END $$;
--> statement-breakpoint
CREATE FUNCTION saving_inventory_order_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM allocate_saving_inventory(NEW.id);
  ELSIF NEW.status IN ('rejected','cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM release_saving_inventory(NEW.id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_inventory_on_status
AFTER UPDATE OF status ON saving_orders FOR EACH ROW EXECUTE FUNCTION saving_inventory_order_state();
--> statement-breakpoint
CREATE FUNCTION saving_inventory_invoice_paid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_order uuid;
BEGIN
  IF NEW.state='Paid' AND OLD.state IS DISTINCT FROM NEW.state THEN
    SELECT id INTO target_order FROM saving_orders WHERE order_id=NEW.order_id;
    IF FOUND THEN PERFORM allocate_saving_inventory(target_order); END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_inventory_on_paid_invoice
AFTER UPDATE OF state ON invoices FOR EACH ROW EXECUTE FUNCTION saving_inventory_invoice_paid();
--> statement-breakpoint
CREATE FUNCTION expire_saving_inventory_reservations(batch_size integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; current_status text; expired_count integer:=0;
BEGIN
  FOR item IN SELECT r.id,r.order_id,r.hardware_product_id FROM saving_inventory_reservations r
    WHERE r.status='reserved' AND r.expires_at<=clock_timestamp()
    ORDER BY r.expires_at,r.id LIMIT LEAST(GREATEST(batch_size,1),1000)
  LOOP
    PERFORM 1 FROM products WHERE id=item.hardware_product_id FOR UPDATE;
    SELECT status INTO current_status FROM saving_inventory_reservations WHERE id=item.id FOR UPDATE;
    IF current_status='reserved' AND EXISTS(SELECT 1 FROM saving_inventory_reservations
      WHERE id=item.id AND expires_at<=clock_timestamp()) THEN
      UPDATE products SET reserved_count=reserved_count-1 WHERE id=item.hardware_product_id;
      UPDATE saving_inventory_reservations SET status='expired',released_at=clock_timestamp()
        WHERE id=item.id;
      PERFORM audit_saving_inventory(item.order_id,item.id,'expired');
      expired_count:=expired_count+1;
    END IF;
  END LOOP;
  RETURN expired_count;
END $$;

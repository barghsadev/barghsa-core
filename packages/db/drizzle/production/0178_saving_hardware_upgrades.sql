CREATE TABLE "saving_hardware_upgrade_requests" (
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
	"adjustment_invoice_id" uuid NOT NULL,
	"price_delta_irr" bigint NOT NULL,
	"stock_reserved" boolean NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "saving_hardware_upgrade_positive_delta" CHECK ("saving_hardware_upgrade_requests"."price_delta_irr">0),
	CONSTRAINT "saving_hardware_upgrade_distinct" CHECK ("saving_hardware_upgrade_requests"."previous_hardware_id"<>"saving_hardware_upgrade_requests"."hardware_id"),
	CONSTRAINT "saving_hardware_upgrade_snapshots" CHECK (jsonb_typeof("saving_hardware_upgrade_requests"."previous_snapshot")='object' AND jsonb_typeof("saving_hardware_upgrade_requests"."hardware_snapshot")='object'),
	CONSTRAINT "saving_hardware_upgrade_reason" CHECK (length(trim("saving_hardware_upgrade_requests"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "saving_hardware_upgrade_status" CHECK ("saving_hardware_upgrade_requests"."status" IN ('awaiting_payment','applied','cancelled','expired')),
	CONSTRAINT "saving_hardware_upgrade_terminal_times" CHECK (("saving_hardware_upgrade_requests"."status"='awaiting_payment' AND "saving_hardware_upgrade_requests"."applied_at" IS NULL AND "saving_hardware_upgrade_requests"."closed_at" IS NULL) OR ("saving_hardware_upgrade_requests"."status"='applied' AND "saving_hardware_upgrade_requests"."applied_at" IS NOT NULL AND "saving_hardware_upgrade_requests"."closed_at" IS NULL) OR ("saving_hardware_upgrade_requests"."status" IN ('cancelled','expired') AND "saving_hardware_upgrade_requests"."applied_at" IS NULL AND "saving_hardware_upgrade_requests"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" DROP CONSTRAINT "saving_hardware_amendments_nonpositive_delta";--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" DROP CONSTRAINT "saving_hardware_amendments_adjustment_link";--> statement-breakpoint
ALTER TABLE "saving_hardware_upgrade_requests" ADD CONSTRAINT "saving_hardware_upgrade_requests_order_id_saving_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."saving_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_upgrade_requests" ADD CONSTRAINT "saving_hardware_upgrade_requests_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_upgrade_requests" ADD CONSTRAINT "saving_hardware_upgrade_requests_contract_version_id_contract_versions_id_fk" FOREIGN KEY ("contract_version_id") REFERENCES "public"."contract_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_upgrade_requests" ADD CONSTRAINT "saving_hardware_upgrade_requests_actor_user_id_users_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_upgrade_requests" ADD CONSTRAINT "saving_hardware_upgrade_requests_previous_hardware_id_products_id_fk" FOREIGN KEY ("previous_hardware_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_upgrade_requests" ADD CONSTRAINT "saving_hardware_upgrade_requests_hardware_id_products_id_fk" FOREIGN KEY ("hardware_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_upgrade_requests" ADD CONSTRAINT "saving_hardware_upgrade_requests_original_invoice_id_invoices_id_fk" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_upgrade_requests" ADD CONSTRAINT "saving_hardware_upgrade_requests_adjustment_invoice_id_invoices_id_fk" FOREIGN KEY ("adjustment_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saving_hardware_upgrade_invoice_key" ON "saving_hardware_upgrade_requests" USING btree ("adjustment_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saving_hardware_upgrade_pending_order_key" ON "saving_hardware_upgrade_requests" USING btree ("order_id") WHERE "saving_hardware_upgrade_requests"."status"='awaiting_payment';--> statement-breakpoint
CREATE INDEX "saving_hardware_upgrade_order_idx" ON "saving_hardware_upgrade_requests" USING btree ("order_id","created_at","id");--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_adjustment_link" CHECK (("saving_hardware_amendments"."price_delta_irr"=0 AND "saving_hardware_amendments"."adjustment_invoice_id" IS NULL) OR ("saving_hardware_amendments"."price_delta_irr"<>0 AND "saving_hardware_amendments"."adjustment_invoice_id" IS NOT NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_saving_hardware_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.adjustment_invoice_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM invoices adjustment JOIN invoices original
      ON original.id=NEW.original_invoice_id
      JOIN saving_orders saving ON saving.id=NEW.order_id
    WHERE adjustment.id=NEW.adjustment_invoice_id
      AND adjustment.adjustment_for_invoice_id=original.id
      AND adjustment.accounting_amount=NEW.price_delta_irr
      AND adjustment.order_id=saving.order_id AND original.order_id=saving.order_id
      AND (
        (NEW.price_delta_irr<0 AND adjustment.adjustment_kind='credit'
          AND adjustment.state='Unpaid' AND adjustment.paid_amount=0
          AND adjustment.payable_from IS NULL)
        OR
        (NEW.price_delta_irr>0 AND adjustment.adjustment_kind='charge'
          AND adjustment.state='Paid' AND adjustment.paid_amount=adjustment.total_amount
          AND adjustment.refunded_amount=0 AND EXISTS (
            SELECT 1 FROM saving_hardware_upgrade_requests upgrade
            WHERE upgrade.adjustment_invoice_id=adjustment.id
              AND upgrade.order_id=NEW.order_id
              AND upgrade.contract_id=NEW.contract_id
              AND upgrade.previous_hardware_id=NEW.previous_hardware_id
              AND upgrade.hardware_id=NEW.hardware_id
              AND upgrade.price_delta_irr=NEW.price_delta_irr
              AND upgrade.status='awaiting_payment')))
  ) THEN
    RAISE EXCEPTION 'Saving hardware adjustment must match its linked invoice' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_saving_hardware_upgrade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Saving hardware upgrade history is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'awaiting_payment' OR NEW.status NOT IN ('applied','cancelled','expired')
      OR (to_jsonb(NEW)-'status'-'applied_at'-'closed_at')
         IS DISTINCT FROM (to_jsonb(OLD)-'status'-'applied_at'-'closed_at') THEN
      RAISE EXCEPTION 'Saving hardware upgrade terms are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER saving_hardware_upgrade_guard BEFORE UPDATE OR DELETE ON saving_hardware_upgrade_requests
FOR EACH ROW EXECUTE FUNCTION guard_saving_hardware_upgrade();
--> statement-breakpoint
CREATE FUNCTION validate_saving_hardware_upgrade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM saving_orders saving JOIN contracts contract
      ON contract.id=NEW.contract_id AND contract.order_id=saving.order_id
      JOIN invoices original ON original.id=NEW.original_invoice_id
      JOIN invoices charge ON charge.id=NEW.adjustment_invoice_id
      JOIN products hardware ON hardware.id=NEW.hardware_id
    WHERE saving.id=NEW.order_id
      AND saving.hardware_product_id=NEW.previous_hardware_id
      AND saving.financial_status='paid'
      AND contract.current_version_id=NEW.contract_version_id
      AND original.order_id=saving.order_id AND original.state='Paid'
      AND charge.order_id=saving.order_id
      AND charge.adjustment_for_invoice_id=original.id
      AND charge.adjustment_kind='charge'
      AND charge.accounting_amount=NEW.price_delta_irr
      AND charge.state='Unpaid' AND charge.paid_amount=0
      AND charge.payable_from IS NOT NULL
      AND hardware.stock_tracking=NEW.stock_reserved
  ) THEN
    RAISE EXCEPTION 'Saving hardware upgrade must match the paid order and charge' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER saving_hardware_upgrade_insert_guard BEFORE INSERT ON saving_hardware_upgrade_requests
FOR EACH ROW EXECUTE FUNCTION validate_saving_hardware_upgrade();
--> statement-breakpoint
CREATE FUNCTION settle_saving_hardware_upgrade() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE upgrade saving_hardware_upgrade_requests%ROWTYPE;
DECLARE saving saving_orders%ROWTYPE;
DECLARE recipient text;
BEGIN
  IF NEW.state NOT IN ('Paid','Cancelled','Overdue') OR NEW.state IS NOT DISTINCT FROM OLD.state
    THEN RETURN NEW; END IF;
  SELECT * INTO upgrade FROM saving_hardware_upgrade_requests
    WHERE adjustment_invoice_id=NEW.id FOR UPDATE;
  IF NOT FOUND OR upgrade.status<>'awaiting_payment' THEN RETURN NEW; END IF;
  IF NEW.state='Paid' THEN
    SELECT * INTO saving FROM saving_orders WHERE id=upgrade.order_id FOR UPDATE;
    IF saving.status NOT IN ('approved','in_progress') OR saving.financial_status<>'paid'
      OR saving.hardware_product_id<>upgrade.previous_hardware_id
      OR NEW.paid_amount<>NEW.total_amount OR NEW.refunded_amount<>0
      OR NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id=upgrade.contract_id
        AND c.current_version_id=upgrade.contract_version_id
        AND c.state IN ('AwaitingCustomerAcceptance','Active'))
      OR NOT EXISTS (SELECT 1 FROM saving_fulfillment_stages f
        WHERE f.order_id=upgrade.order_id AND f.stage='product_delivery' AND f.status='in_progress')
      OR EXISTS (SELECT 1 FROM saving_fulfillment_stages f
        WHERE f.order_id=upgrade.order_id
          AND f.stage IN ('installation_and_document_upload','equipment_handover','process_completion')
          AND f.status<>'pending') THEN
      RAISE EXCEPTION 'Saving hardware upgrade can no longer be applied' USING ERRCODE='23514';
    END IF;
    PERFORM id FROM products WHERE id IN (upgrade.previous_hardware_id,upgrade.hardware_id)
      ORDER BY id FOR UPDATE;
    IF upgrade.stock_reserved THEN
      UPDATE products SET reserved_count=reserved_count-1
        WHERE id=upgrade.hardware_id AND stock_tracking AND reserved_count>0;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Saving hardware upgrade reservation is missing' USING ERRCODE='23514';
      END IF;
    END IF;
    INSERT INTO saving_hardware_amendments(
      order_id,contract_id,contract_version_id,actor_user_id,
      previous_hardware_id,hardware_id,previous_snapshot,hardware_snapshot,
      original_invoice_id,adjustment_invoice_id,price_delta_irr,reason)
    VALUES(upgrade.order_id,upgrade.contract_id,upgrade.contract_version_id,upgrade.actor_user_id,
      upgrade.previous_hardware_id,upgrade.hardware_id,upgrade.previous_snapshot,upgrade.hardware_snapshot,
      upgrade.original_invoice_id,upgrade.adjustment_invoice_id,upgrade.price_delta_irr,upgrade.reason);
    UPDATE saving_orders SET hardware_product_id=upgrade.hardware_id,updated_at=clock_timestamp()
      WHERE id=upgrade.order_id;
    UPDATE saving_hardware_upgrade_requests SET status='applied',applied_at=clock_timestamp()
      WHERE id=upgrade.id;
    INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
    VALUES(uuid_generate_v7()::text,upgrade.actor_user_id,'saving.hardware_upgrade_applied',
      jsonb_build_object('savingOrderId',upgrade.order_id,'upgradeId',upgrade.id,
        'chargeInvoiceId',NEW.id,'priceDeltaIrR',upgrade.price_delta_irr)::text,
      uuid_generate_v7()::text);
    SELECT user_id INTO recipient FROM profiles WHERE id=saving.profile_id;
    INSERT INTO in_app_notifications(id,recipient_user_id,profile_id,type,title_i18n_key,
      body_i18n_key,localized_content,link_route,is_read,created_at,delivery_key)
    VALUES(uuid_generate_v7(),recipient,saving.profile_id,'general',
      'notifications.legacy.title','notifications.legacy.body',
      jsonb_build_object('fa',jsonb_build_object('title','سفارش صرفه‌جویی',
        'body','تجهیز جدید سفارش شما پس از پرداخت مبلغ اضافه اعمال شد.'),
        'en',jsonb_build_object('title','Power-saving order',
        'body','Your new equipment was applied after the additional payment.')),
      '/savings/orders/'||upgrade.order_id::text,false,clock_timestamp(),
      'saving-hardware-upgrade-applied:'||upgrade.id::text);
    RETURN NEW;
  END IF;
  IF NEW.paid_amount<>0 THEN RETURN NEW; END IF;
  IF upgrade.stock_reserved THEN
    UPDATE products SET reserved_count=reserved_count-1
      WHERE id=upgrade.hardware_id AND reserved_count>0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Saving hardware upgrade reservation is missing' USING ERRCODE='23514';
    END IF;
  END IF;
  UPDATE saving_hardware_upgrade_requests SET
    status=CASE WHEN NEW.state='Overdue' THEN 'expired' ELSE 'cancelled' END,
    closed_at=clock_timestamp() WHERE id=upgrade.id;
  INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
  VALUES(uuid_generate_v7()::text,upgrade.actor_user_id,'saving.hardware_upgrade_closed',
    jsonb_build_object('savingOrderId',upgrade.order_id,'upgradeId',upgrade.id,
      'chargeInvoiceId',NEW.id,'invoiceState',NEW.state)::text,uuid_generate_v7()::text);
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_saving_hardware_upgrade_state AFTER UPDATE OF state ON invoices
FOR EACH ROW EXECUTE FUNCTION settle_saving_hardware_upgrade();
--> statement-breakpoint
CREATE FUNCTION guard_closed_saving_hardware_upgrade_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.paid_amount>OLD.paid_amount OR (NEW.state='Paid' AND OLD.state IS DISTINCT FROM NEW.state))
    AND EXISTS (SELECT 1 FROM saving_hardware_upgrade_requests r
      WHERE r.adjustment_invoice_id=NEW.id AND r.status IN ('cancelled','expired')) THEN
    RAISE EXCEPTION 'Saving hardware upgrade payment window has closed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_saving_hardware_upgrade_payment_guard
BEFORE UPDATE OF paid_amount,state ON invoices FOR EACH ROW
EXECUTE FUNCTION guard_closed_saving_hardware_upgrade_payment();

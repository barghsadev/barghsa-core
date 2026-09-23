ALTER TABLE "saving_hardware_amendments" DROP CONSTRAINT "saving_hardware_amendments_zero_delta";--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD COLUMN "adjustment_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_adjustment_invoice_id_invoices_id_fk" FOREIGN KEY ("adjustment_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_nonpositive_delta" CHECK ("saving_hardware_amendments"."price_delta_irr"<=0);--> statement-breakpoint
ALTER TABLE "saving_hardware_amendments" ADD CONSTRAINT "saving_hardware_amendments_adjustment_link" CHECK (("saving_hardware_amendments"."price_delta_irr"=0 AND "saving_hardware_amendments"."adjustment_invoice_id" IS NULL) OR ("saving_hardware_amendments"."price_delta_irr"<0 AND "saving_hardware_amendments"."adjustment_invoice_id" IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION validate_saving_hardware_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.adjustment_invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM invoices adjustment JOIN invoices original
      ON original.id=NEW.original_invoice_id
      JOIN saving_orders saving ON saving.id=NEW.order_id
    WHERE adjustment.id=NEW.adjustment_invoice_id
      AND adjustment.adjustment_for_invoice_id=original.id
      AND adjustment.adjustment_kind='credit'
      AND adjustment.accounting_amount=NEW.price_delta_irr
      AND adjustment.state='Unpaid' AND adjustment.paid_amount=0
      AND adjustment.payable_from IS NULL
      AND adjustment.order_id=saving.order_id AND original.order_id=saving.order_id
  ) THEN
    RAISE EXCEPTION 'Saving hardware credit must match its linked invoice' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER saving_hardware_credit_link_guard BEFORE INSERT ON saving_hardware_amendments
FOR EACH ROW EXECUTE FUNCTION validate_saving_hardware_credit();

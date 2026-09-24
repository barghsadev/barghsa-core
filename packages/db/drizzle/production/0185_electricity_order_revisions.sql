DROP INDEX "electricity_order_lines_product_unique";--> statement-breakpoint
DROP INDEX "electricity_order_lines_order_idx";--> statement-breakpoint
ALTER TABLE "electricity_order_lines" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_order_lines_product_unique" ON "electricity_order_lines" USING btree ("order_id","revision","product_id");--> statement-breakpoint
CREATE INDEX "electricity_order_lines_order_idx" ON "electricity_order_lines" USING btree ("order_id","revision");--> statement-breakpoint
ALTER TABLE "electricity_order_lines" ADD CONSTRAINT "electricity_order_lines_revision_positive" CHECK ("electricity_order_lines"."revision" > 0);
--> statement-breakpoint
DROP INDEX "uq_gift_code_redemptions_order_id";
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gift_code_redemptions_order_id"
  ON gift_code_redemptions(order_id) WHERE status='consumed';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_electricity_order_settings_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Electricity order history is retained' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'Submitted electricity orders cannot return to draft' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot THEN
    RAISE EXCEPTION 'Submitted electricity settings are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot OR
    NEW.period_start IS DISTINCT FROM OLD.period_start OR
    NEW.period_end IS DISTINCT FROM OLD.period_end OR
    NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
  ) AND NOT (
    OLD.status='changes_requested' AND NEW.status='changes_requested' AND
    EXISTS (
      SELECT 1 FROM contracts c
      JOIN electricity_contracts ec ON ec.contract_id=c.id
      JOIN contract_versions v ON v.id=c.current_version_id
      JOIN contract_activation_requirements ar ON ar.version_id=v.id
      JOIN invoices i ON i.id=ar.initial_invoice_id
      WHERE ec.order_id=OLD.id AND c.state='ChangesRequested'
        AND NOT EXISTS(SELECT 1 FROM contract_publications p WHERE p.version_id=v.id)
        AND v.content->'pricing'=OLD.pricing_snapshot
        AND i.state IN ('Draft','Unpaid','Overdue') AND i.paid_amount=0
        AND NOT EXISTS(SELECT 1 FROM bank_receipts r WHERE r.invoice_id=i.id
          AND r.state IN ('Submitted','UnderReview'))
    )
  ) THEN
    RAISE EXCEPTION 'Submitted electricity snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('draft', 'cancelled') AND (
    NEW.period_start IS NULL OR NEW.period_end IS NULL OR
    NEW.submitted_at IS NULL OR NEW.pricing_snapshot IS NULL OR
    NEW.period_end <= NEW.period_start
  ) THEN
    RAISE EXCEPTION 'Submitted electricity order needs period and pricing snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

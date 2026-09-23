ALTER TABLE "electricity_quantity_increase_requests" ADD COLUMN "signature_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD COLUMN "adjustment_amount" bigint;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD COLUMN "adjustment_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD COLUMN "effective_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD CONSTRAINT "electricity_quantity_increase_requests_adjustment_invoice_id_invoices_id_fk" FOREIGN KEY ("adjustment_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_quantity_increase_invoice_id_key" ON "electricity_quantity_increase_requests" USING btree ("adjustment_invoice_id");--> statement-breakpoint
ALTER TABLE "electricity_quantity_increase_requests" ADD CONSTRAINT "electricity_quantity_increase_signature_check" CHECK (("electricity_quantity_increase_requests"."status" IN ('pending','rejected','awaiting_signature') AND "electricity_quantity_increase_requests"."signature_evidence" IS NULL AND "electricity_quantity_increase_requests"."signed_at" IS NULL AND "electricity_quantity_increase_requests"."pricing_snapshot" IS NULL AND "electricity_quantity_increase_requests"."adjustment_amount" IS NULL AND "electricity_quantity_increase_requests"."adjustment_invoice_id" IS NULL AND "electricity_quantity_increase_requests"."effective_at" IS NULL) OR ("electricity_quantity_increase_requests"."status" IN ('awaiting_payment','effective') AND "electricity_quantity_increase_requests"."signature_evidence" IS NOT NULL AND "electricity_quantity_increase_requests"."signed_at" IS NOT NULL AND "electricity_quantity_increase_requests"."pricing_snapshot" IS NOT NULL AND "electricity_quantity_increase_requests"."adjustment_amount">0 AND "electricity_quantity_increase_requests"."adjustment_invoice_id" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE electricity_quantity_increase_requests ADD CONSTRAINT electricity_increase_effective_at_check
 CHECK ((status='effective') = (effective_at IS NOT NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_electricity_increase_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Electricity increase history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF OLD.status <> 'pending' AND (
    NEW.amendment_document IS DISTINCT FROM OLD.amendment_document OR
    NEW.amendment_sha256 IS DISTINCT FROM OLD.amendment_sha256 OR
    NEW.effective_from IS DISTINCT FROM OLD.effective_from OR
    NEW.original_kwh IS DISTINCT FROM OLD.original_kwh OR
    NEW.requested_kwh IS DISTINCT FROM OLD.requested_kwh OR
    NEW.period_end IS DISTINCT FROM OLD.period_end OR
    NEW.version_id IS DISTINCT FROM OLD.version_id OR
    NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR
    NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
  ) THEN
    RAISE EXCEPTION 'Reviewed electricity increase terms are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.signed_at IS NOT NULL AND (
    NEW.signature_evidence IS DISTINCT FROM OLD.signature_evidence OR
    NEW.signed_at IS DISTINCT FROM OLD.signed_at OR
    NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot OR
    NEW.adjustment_amount IS DISTINCT FROM OLD.adjustment_amount OR
    NEW.adjustment_invoice_id IS DISTINCT FROM OLD.adjustment_invoice_id
  ) THEN
    RAISE EXCEPTION 'Signed electricity increase and invoice are immutable' USING ERRCODE='23514';
  END IF;
  IF (OLD.status='rejected' OR OLD.status='effective') AND NEW.status<>OLD.status THEN
    RAISE EXCEPTION 'Final electricity increase status is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='awaiting_signature' AND NEW.status NOT IN ('awaiting_signature','awaiting_payment') THEN
    RAISE EXCEPTION 'Amendment must be signed before payment' USING ERRCODE='23514';
  END IF;
  IF OLD.status='awaiting_payment' AND NEW.status NOT IN ('awaiting_payment','effective') THEN
    RAISE EXCEPTION 'Adjustment payment is required' USING ERRCODE='23514';
  END IF;
  IF NEW.status='awaiting_payment' AND OLD.status='awaiting_signature' AND NOT EXISTS (
    SELECT 1 FROM invoices i JOIN contract_activation_requirements ar ON ar.version_id=NEW.version_id
    WHERE i.id=NEW.adjustment_invoice_id AND i.adjustment_for_invoice_id=ar.initial_invoice_id
      AND i.contract_id=NEW.contract_id::text AND i.order_id=NEW.order_id
      AND i.adjustment_kind='charge' AND i.total_amount=NEW.adjustment_amount
      AND i.state='Unpaid'
  ) THEN
    RAISE EXCEPTION 'Increase adjustment invoice does not match signed amendment' USING ERRCODE='23514';
  END IF;
  IF NEW.status='effective' AND OLD.status='awaiting_payment' AND NOT EXISTS (
    SELECT 1 FROM invoices i WHERE i.id=NEW.adjustment_invoice_id AND i.state='Paid'
      AND i.paid_amount>=i.total_amount AND i.refunded_amount=0
  ) THEN
    RAISE EXCEPTION 'Increase requires full adjustment payment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION finalize_paid_electricity_increase(p_request_id uuid, p_now timestamptz DEFAULT clock_timestamp()) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r electricity_quantity_increase_requests%ROWTYPE;
DECLARE recipient text;
BEGIN
  SELECT * INTO r FROM electricity_quantity_increase_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status<>'awaiting_payment' OR r.effective_from>p_now
     OR r.period_end<=p_now OR NOT EXISTS (
       SELECT 1 FROM invoices i JOIN contracts c ON c.id=r.contract_id
       WHERE i.id=r.adjustment_invoice_id AND i.state='Paid'
         AND i.paid_amount>=i.total_amount AND i.refunded_amount=0 AND c.state='Active'
     ) THEN RETURN false; END IF;
  UPDATE electricity_quantity_increase_requests
     SET status='effective',effective_at=p_now WHERE id=r.id;
  INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
    VALUES(uuid_generate_v7()::text,r.requested_by,'electricity.increase_effective',
      jsonb_build_object('requestId',r.id,'contractId',r.contract_id,
        'orderId',r.order_id,'invoiceId',r.adjustment_invoice_id,
        'originalKwh',r.original_kwh,'requestedKwh',r.requested_kwh)::text,
      uuid_generate_v7()::text);
  SELECT user_id INTO recipient FROM profiles WHERE id=r.profile_id;
  INSERT INTO in_app_notifications(id,recipient_user_id,profile_id,type,title_i18n_key,
    body_i18n_key,localized_content,link_route,is_read,created_at,delivery_key)
  VALUES(uuid_generate_v7(),recipient,r.profile_id,'general',
    'notifications.legacy.title','notifications.legacy.body',
    jsonb_build_object('fa',jsonb_build_object('title','قرارداد',
      'body','افزایش مقدار برق پس از پرداخت کامل اعمال شد.'),
      'en',jsonb_build_object('title','Contract',
      'body','Your electricity quantity increase is now effective after full payment.')),
    '/electricity/orders/'||r.order_id::text,false,p_now,
    'electricity-increase-effective:'||r.id::text);
  RETURN true;
END $$;
--> statement-breakpoint
CREATE FUNCTION apply_paid_electricity_increase() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_id uuid;
BEGIN
  IF NEW.state='Paid' AND OLD.state IS DISTINCT FROM NEW.state THEN
    SELECT id INTO request_id FROM electricity_quantity_increase_requests
      WHERE adjustment_invoice_id=NEW.id;
    IF request_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM electricity_quantity_increase_requests
                 WHERE id=request_id AND period_end<=clock_timestamp()) THEN
        RAISE EXCEPTION 'Electricity increase delivery period has ended' USING ERRCODE='23514';
      END IF;
      PERFORM finalize_paid_electricity_increase(request_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_electricity_increase_paid
 AFTER UPDATE OF state ON invoices FOR EACH ROW EXECUTE FUNCTION apply_paid_electricity_increase();
--> statement-breakpoint
CREATE FUNCTION guard_expired_electricity_increase_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.paid_amount>OLD.paid_amount OR (NEW.state='Paid' AND OLD.state IS DISTINCT FROM NEW.state))
     AND EXISTS (SELECT 1 FROM electricity_quantity_increase_requests r
                 WHERE r.adjustment_invoice_id=NEW.id AND r.period_end<=clock_timestamp()) THEN
    RAISE EXCEPTION 'Electricity increase delivery period has ended' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_electricity_increase_expiry_guard
 BEFORE UPDATE OF paid_amount,state ON invoices
 FOR EACH ROW EXECUTE FUNCTION guard_expired_electricity_increase_payment();

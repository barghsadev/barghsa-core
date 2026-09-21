CREATE TABLE "contract_cancellation_intents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"refund_decision" jsonb NOT NULL,
	"financial_snapshot" jsonb NOT NULL,
	"financial_fingerprint" text NOT NULL,
	"financial_impact_amount" bigint NOT NULL,
	"approval_policy" jsonb NOT NULL,
	"approval_request_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_intents_reason" CHECK (length(trim("contract_cancellation_intents"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "cancellation_intents_fingerprint" CHECK ("contract_cancellation_intents"."financial_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "cancellation_intents_impact" CHECK ("contract_cancellation_intents"."financial_impact_amount" >= 0),
	CONSTRAINT "cancellation_intents_snapshot_objects" CHECK (jsonb_typeof("contract_cancellation_intents"."refund_decision")='object' AND jsonb_typeof("contract_cancellation_intents"."financial_snapshot")='object' AND jsonb_typeof("contract_cancellation_intents"."approval_policy")='object')
);
--> statement-breakpoint
CREATE TABLE "contract_cancellations" (
	"contract_id" uuid PRIMARY KEY NOT NULL,
	"intent_id" uuid NOT NULL,
	"executed_by" text NOT NULL,
	"cancelled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_refund_obligations" (
	"refund_id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_cancellation_intents" ADD CONSTRAINT "contract_cancellation_intents_actor_id_users_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_cancellation_intents" ADD CONSTRAINT "contract_cancellation_intents_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_cancellation_intents" ADD CONSTRAINT "cancellation_intents_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_cancellations" ADD CONSTRAINT "contract_cancellations_executed_by_users_user_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_intents_identity_unique" ON "contract_cancellation_intents" USING btree ("contract_id","id");--> statement-breakpoint
ALTER TABLE "contract_cancellations" ADD CONSTRAINT "contract_cancellations_intent_fk" FOREIGN KEY ("contract_id","intent_id") REFERENCES "public"."contract_cancellation_intents"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_refund_obligations" ADD CONSTRAINT "contract_refund_obligations_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_refund_obligations" ADD CONSTRAINT "contract_refund_obligations_contract_id_contract_cancellations_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract_cancellations"("contract_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_refund_obligations" ADD CONSTRAINT "contract_refund_obligations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_intents_idempotency_unique" ON "contract_cancellation_intents" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_intents_approval_unique" ON "contract_cancellation_intents" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "cancellation_intents_contract_created_idx" ON "contract_cancellation_intents" USING btree ("contract_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_cancellations_intent_unique" ON "contract_cancellations" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_refund_obligations_invoice_unique" ON "contract_refund_obligations" USING btree ("contract_id","invoice_id");--> statement-breakpoint
CREATE INDEX "contract_refund_obligations_contract_idx" ON "contract_refund_obligations" USING btree ("contract_id");
--> statement-breakpoint
ALTER TABLE approval_requests DROP CONSTRAINT chk_ar_action_type;
ALTER TABLE approval_requests ADD CONSTRAINT chk_ar_action_type CHECK (action_type IN ('refund','manual_adjustment','bank_payment_confirmation','contract_cancellation'));
--> statement-breakpoint
CREATE FUNCTION guard_contract_cancellation_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; approval approval_requests%ROWTYPE; profile_archived boolean; line jsonb; requested numeric:=0;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cancellation decisions are immutable' USING ERRCODE='23514'; END IF;
 SELECT p.archived INTO profile_archived FROM contracts c JOIN profiles p ON p.id=c.profile_id WHERE c.id=NEW.contract_id FOR SHARE OF p NOWAIT;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE NOWAIT;
 IF parent.id IS NULL OR profile_archived IS DISTINCT FROM false OR parent.state IN ('Completed','Cancelled') OR parent.current_version_id<>NEW.version_id
 THEN RAISE EXCEPTION 'Cancellation decision requires the current available nonterminal version' USING ERRCODE='23514'; END IF;
 IF NEW.financial_snapshot->>'contractId' IS DISTINCT FROM parent.id::text
  OR NEW.financial_snapshot->>'versionId' IS DISTINCT FROM parent.current_version_id::text
  OR NEW.financial_snapshot->>'profileId' IS DISTINCT FROM parent.profile_id::text
  OR NEW.financial_snapshot->>'state' IS DISTINCT FROM parent.state::text
  OR jsonb_typeof(NEW.financial_snapshot->'invoices') IS DISTINCT FROM 'array'
  OR NEW.financial_snapshot->>'refundableAmount' IS DISTINCT FROM NEW.financial_impact_amount::text
  OR jsonb_typeof(NEW.refund_decision->'refunds') IS DISTINCT FROM 'array'
  OR jsonb_typeof(NEW.approval_policy->'enabled') IS DISTINCT FROM 'boolean'
 THEN RAISE EXCEPTION 'Cancellation decision must bind the financial and policy snapshot' USING ERRCODE='23514'; END IF;
 IF NEW.approval_policy->>'enabled'='true' THEN
  IF COALESCE(NEW.approval_policy->>'thresholdIrR','') !~ '^[1-9][0-9]{0,18}$'
  THEN RAISE EXCEPTION 'Cancellation approval threshold is invalid' USING ERRCODE='23514'; END IF;
  IF (NEW.approval_policy->>'thresholdIrR')::numeric>9223372036854775807
  THEN RAISE EXCEPTION 'Cancellation approval threshold is invalid' USING ERRCODE='23514'; END IF;
  IF NEW.financial_impact_amount >= (NEW.approval_policy->>'thresholdIrR')::bigint AND NEW.approval_request_id IS NULL
  THEN RAISE EXCEPTION 'Cancellation requires a bound financial approval' USING ERRCODE='23514'; END IF;
 END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(NEW.refund_decision->'refunds') LOOP
  IF COALESCE(line->>'invoiceId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR COALESCE(line->>'amount','') !~ '^[1-9][0-9]{0,18}$'
   OR COALESCE(line->>'destination','') NOT IN ('wallet','external_bank')
  THEN RAISE EXCEPTION 'Cancellation refund decision is invalid' USING ERRCODE='23514'; END IF;
  IF (line->>'amount')::numeric>9223372036854775807
  THEN RAISE EXCEPTION 'Cancellation refund amount exceeds int8' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.financial_snapshot->'invoices') i WHERE i->>'id'=line->>'invoiceId')
  THEN RAISE EXCEPTION 'Cancellation refund invoice is outside the snapshot' USING ERRCODE='23514'; END IF;
  requested:=requested+(line->>'amount')::bigint;
  IF parent.service_type='electricity' AND line->>'destination'<>'wallet'
  THEN RAISE EXCEPTION 'Electricity cancellation returns funds to the wallet' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT value->>'invoiceId') FROM jsonb_array_elements(NEW.refund_decision->'refunds'))
  OR requested>NEW.financial_impact_amount OR (parent.service_type='electricity' AND requested<>NEW.financial_impact_amount)
 THEN RAISE EXCEPTION 'Cancellation refund decision does not match its financial impact' USING ERRCODE='23514'; END IF;
 IF NEW.approval_request_id IS NOT NULL THEN
  SELECT * INTO approval FROM approval_requests WHERE id=NEW.approval_request_id FOR SHARE NOWAIT;
  IF approval.id IS NULL OR approval.action_type<>'contract_cancellation' OR approval.initiator_id<>NEW.actor_id
   OR approval.amount_irr<>NEW.financial_impact_amount OR approval.status<>'pending'
   OR approval.details->>'intentId' IS DISTINCT FROM NEW.id::text
   OR approval.details->>'contractId' IS DISTINCT FROM NEW.contract_id::text
   OR approval.details->>'versionId' IS DISTINCT FROM NEW.version_id::text
   OR approval.details->>'financialFingerprint' IS DISTINCT FROM NEW.financial_fingerprint
  THEN RAISE EXCEPTION 'Cancellation approval must bind the exact decision' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.created_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER contract_cancellation_intents_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_cancellation_intents
 FOR EACH ROW EXECUTE FUNCTION guard_contract_cancellation_intent();
--> statement-breakpoint
CREATE FUNCTION guard_contract_cancellation_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; intent contract_cancellation_intents%ROWTYPE; approval approval_requests%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cancellation evidence is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE NOWAIT;
 SELECT * INTO intent FROM contract_cancellation_intents WHERE id=NEW.intent_id AND contract_id=NEW.contract_id;
 IF parent.id IS NULL OR intent.id IS NULL OR parent.state<>'Cancelled' OR parent.cancelled_at IS NULL OR parent.current_version_id<>intent.version_id
 THEN RAISE EXCEPTION 'Cancellation evidence must match the cancelled contract version' USING ERRCODE='23514'; END IF;
 IF intent.approval_request_id IS NOT NULL THEN
  SELECT * INTO approval FROM approval_requests WHERE id=intent.approval_request_id FOR SHARE NOWAIT;
  IF approval.id IS NULL OR approval.status<>'approved' OR approval.reviewer_id IS NULL OR approval.reviewer_id=approval.initiator_id
   OR approval.action_type<>'contract_cancellation' OR approval.initiator_id<>intent.actor_id OR approval.amount_irr<>intent.financial_impact_amount
   OR approval.details->>'intentId' IS DISTINCT FROM intent.id::text
   OR approval.details->>'contractId' IS DISTINCT FROM NEW.contract_id::text
   OR approval.details->>'versionId' IS DISTINCT FROM intent.version_id::text
   OR approval.details->>'financialFingerprint' IS DISTINCT FROM intent.financial_fingerprint
  THEN RAISE EXCEPTION 'Cancellation approval is not valid for execution' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.cancelled_at:=parent.cancelled_at;
 RETURN NEW;
END $$;
CREATE TRIGGER contract_cancellations_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_cancellations
 FOR EACH ROW EXECUTE FUNCTION guard_contract_cancellation_record();
--> statement-breakpoint
CREATE FUNCTION guard_contract_refund_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; invoice invoices%ROWTYPE; refund refunds%ROWTYPE; decision jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Contract refund obligations are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id;
 SELECT * INTO invoice FROM invoices WHERE id=NEW.invoice_id FOR UPDATE NOWAIT;
 SELECT * INTO refund FROM refunds WHERE id=NEW.refund_id FOR UPDATE NOWAIT;
 SELECT i.refund_decision INTO decision FROM contract_cancellations c JOIN contract_cancellation_intents i ON i.id=c.intent_id WHERE c.contract_id=NEW.contract_id;
 IF parent.id IS NULL OR parent.state<>'Cancelled' OR invoice.id IS NULL OR refund.id IS NULL
  OR invoice.profile_id<>parent.profile_id OR refund.invoice_id<>invoice.id OR refund.profile_id<>parent.profile_id
  OR refund.state<>'Requested' OR refund.staff_id IS NOT NULL
  OR NOT COALESCE((invoice.contract_id IS NOT DISTINCT FROM parent.id::text OR (parent.order_id IS NOT NULL AND invoice.order_id=parent.order_id AND invoice.contract_id IS NULL)),false)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(decision->'refunds') d WHERE d->>'invoiceId'=invoice.id::text AND d->>'amount'=refund.amount::text AND d->>'destination'=refund.destination::text)
 THEN RAISE EXCEPTION 'Contract refund obligation must bind the recorded decision and invoice' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER contract_refund_obligations_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_refund_obligations
 FOR EACH ROW EXECUTE FUNCTION guard_contract_refund_obligation();
--> statement-breakpoint
CREATE FUNCTION guard_mandatory_contract_refund() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state IN ('Rejected','Cancelled') AND EXISTS(SELECT 1 FROM contract_refund_obligations WHERE refund_id=NEW.id)
 THEN RAISE EXCEPTION 'Contract refund obligations cannot be dismissed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER refunds_contract_obligation_guard BEFORE UPDATE ON refunds
 FOR EACH ROW EXECUTE FUNCTION guard_mandatory_contract_refund();

--> statement-breakpoint
-- Deferred so the command can update the parent and insert all evidence atomically.
-- Existing terminal rows are not rewritten or assigned fabricated evidence.
CREATE FUNCTION enforce_contract_cancellation_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intent contract_cancellation_intents%ROWTYPE; actual_impact numeric; parent contracts%ROWTYPE;
BEGIN
 IF NEW.state<>'Cancelled' THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND OLD.state='Cancelled' THEN RETURN NULL; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.id;
 SELECT i.* INTO intent FROM contract_cancellations c JOIN contract_cancellation_intents i ON i.id=c.intent_id WHERE c.contract_id=NEW.id;
 IF intent.id IS NULL OR parent.state<>'Cancelled' OR parent.current_version_id<>intent.version_id
 THEN RAISE EXCEPTION 'Cancellation requires immutable execution evidence' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(intent.refund_decision->'refunds') line
   WHERE NOT EXISTS(SELECT 1 FROM contract_refund_obligations o JOIN refunds r ON r.id=o.refund_id
     WHERE o.contract_id=NEW.id AND o.invoice_id::text=line->>'invoiceId'
       AND r.amount::text=line->>'amount' AND r.destination::text=line->>'destination'))
 THEN RAISE EXCEPTION 'Cancellation requires every recorded refund obligation' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(i.paid_amount-i.refunded_amount),0) INTO actual_impact FROM invoices i
 WHERE i.profile_id=parent.profile_id AND i.adjustment_kind IS DISTINCT FROM 'credit'
   AND (i.contract_id=parent.id::text OR (parent.order_id IS NOT NULL AND i.order_id=parent.order_id AND i.contract_id IS NULL));
 IF contract_has_pending_payments(parent.id)
 THEN RAISE EXCEPTION 'Cancellation requires payment reconciliation' USING ERRCODE='23514'; END IF;
 IF actual_impact<>intent.financial_impact_amount
 THEN RAISE EXCEPTION 'Cancellation financial facts changed' USING ERRCODE='23514'; END IF;
 IF parent.service_type='electricity' AND EXISTS(SELECT 1 FROM invoices i
   WHERE i.profile_id=parent.profile_id AND i.adjustment_kind IS DISTINCT FROM 'credit'
     AND (i.contract_id=parent.id::text OR (parent.order_id IS NOT NULL AND i.order_id=parent.order_id AND i.contract_id IS NULL))
     AND i.paid_amount>i.refunded_amount
     AND NOT EXISTS(SELECT 1 FROM contract_refund_obligations o JOIN refunds r ON r.id=o.refund_id
       WHERE o.contract_id=parent.id AND o.invoice_id=i.id AND r.destination='wallet' AND r.amount=i.paid_amount-i.refunded_amount))
 THEN RAISE EXCEPTION 'Electricity cancellation requires the full outstanding wallet return' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER contracts_cancellation_complete AFTER INSERT OR UPDATE ON contracts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_contract_cancellation_complete();

--> statement-breakpoint
CREATE FUNCTION contract_has_pending_payments(contract_uuid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM contracts c JOIN invoices i ON i.profile_id=c.profile_id
   AND (i.contract_id=c.id::text OR (c.order_id IS NOT NULL AND i.order_id=c.order_id AND i.contract_id IS NULL))
 WHERE c.id=contract_uuid AND (
   EXISTS(SELECT 1 FROM bank_receipts r WHERE r.invoice_id=i.id AND r.state IN ('Submitted','UnderReview'))
   OR EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.wallet_id=i.profile_id AND lower(w.ref_id)=i.id::text
     AND w.type='payment' AND w.state IN ('Pending','Reserved'))));
$$;
--> statement-breakpoint
CREATE FUNCTION guard_cancelled_contract_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE;
BEGIN
 -- Matching both old and new associations prevents removing an invoice from terminal history.
 FOR parent IN SELECT c.* FROM contracts c WHERE
   c.id::text=NEW.contract_id OR (c.order_id=NEW.order_id AND NEW.contract_id IS NULL)
   OR (TG_OP IN ('UPDATE','DELETE') AND (c.id::text=OLD.contract_id OR (c.order_id=OLD.order_id AND OLD.contract_id IS NULL)))
   ORDER BY c.id FOR SHARE NOWAIT LOOP
  IF parent.state='Cancelled' THEN
   IF TG_OP IN ('INSERT','DELETE') THEN
    RAISE EXCEPTION 'Cancelled contract invoice history cannot be added or deleted' USING ERRCODE='23514';
   END IF;
   IF ROW(NEW.profile_id,NEW.contract_id,NEW.order_id,NEW.total_amount,NEW.paid_amount)
      IS DISTINCT FROM ROW(OLD.profile_id,OLD.contract_id,OLD.order_id,OLD.total_amount,OLD.paid_amount)
      OR (NEW.state<>OLD.state AND NEW.state NOT IN ('Cancelled','Refunded','PartiallyRefunded'))
   THEN RAISE EXCEPTION 'Cancelled contract invoices cannot be reassigned or paid' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoices_cancelled_contract_guard BEFORE INSERT OR UPDATE OR DELETE ON invoices
 FOR EACH ROW EXECUTE FUNCTION guard_cancelled_contract_invoice();
--> statement-breakpoint
CREATE FUNCTION assert_contract_invoice_payment_allowed(invoice_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE invoice invoices%ROWTYPE; parent contracts%ROWTYPE;
BEGIN
 SELECT * INTO invoice FROM invoices WHERE id=invoice_uuid FOR UPDATE NOWAIT;
 IF invoice.id IS NULL THEN RETURN; END IF;
 FOR parent IN SELECT c.* FROM contracts c WHERE c.id::text=invoice.contract_id
   OR (c.order_id=invoice.order_id AND invoice.contract_id IS NULL) ORDER BY c.id FOR SHARE NOWAIT LOOP
  IF parent.state='Cancelled'
  THEN RAISE EXCEPTION 'Cancelled contracts cannot receive payments' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION guard_cancelled_contract_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state IN ('Submitted','UnderReview','Confirmed')
    AND (TG_OP='INSERT' OR ROW(NEW.invoice_id,NEW.state,NEW.amount) IS DISTINCT FROM ROW(OLD.invoice_id,OLD.state,OLD.amount))
 THEN PERFORM assert_contract_invoice_payment_allowed(NEW.invoice_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bank_receipts_cancelled_contract_guard BEFORE INSERT OR UPDATE ON bank_receipts
 FOR EACH ROW EXECUTE FUNCTION guard_cancelled_contract_receipt();
CREATE FUNCTION guard_cancelled_contract_wallet_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type='payment' AND NEW.state IN ('Pending','Reserved','Completed')
    AND (TG_OP='INSERT' OR ROW(NEW.ref_id,NEW.state,NEW.amount) IS DISTINCT FROM ROW(OLD.ref_id,OLD.state,OLD.amount))
    AND NEW.ref_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 THEN PERFORM assert_contract_invoice_payment_allowed(NEW.ref_id::uuid); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wallet_transactions_cancelled_contract_guard BEFORE INSERT OR UPDATE ON wallet_transactions
 FOR EACH ROW EXECUTE FUNCTION guard_cancelled_contract_wallet_payment();

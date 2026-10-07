-- Preserve the linked-order uniqueness contract; genuine orphan closure may
-- owe one immutable obligation for each existing invoice.
DROP INDEX refund_obligations_order_unique;
CREATE UNIQUE INDEX refund_obligations_order_unique ON refund_obligations(order_id) WHERE contract_id IS NOT NULL;
CREATE UNIQUE INDEX refund_obligations_orphan_invoice_unique ON refund_obligations(order_id,invoice_id) WHERE contract_id IS NULL;

--> statement-breakpoint
CREATE TABLE electricity_draft_terminations (
 order_id uuid PRIMARY KEY CONSTRAINT electricity_draft_terminations_order_id_electricity_orders_id_fk REFERENCES electricity_orders(id) ON DELETE RESTRICT,
 profile_id uuid NOT NULL CONSTRAINT electricity_draft_terminations_profile_id_profiles_id_fk REFERENCES profiles(id) ON DELETE RESTRICT,
 executed_by text NOT NULL CONSTRAINT electricity_draft_terminations_executed_by_users_user_id_fk REFERENCES users(user_id) ON DELETE RESTRICT,
 action text NOT NULL,
 reason text NOT NULL,
 review_hash text NOT NULL,
 financial_review jsonb NOT NULL,
 approval_request_id uuid CONSTRAINT electricity_draft_terminations_approval_request_id_approval_requests_id_fk REFERENCES approval_requests(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT electricity_draft_termination_action CHECK(action IN ('reject','cancel')),
 CONSTRAINT electricity_draft_termination_reason CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
 CONSTRAINT electricity_draft_termination_hash CHECK(review_hash ~ '^[0-9a-f]{64}$'),
 CONSTRAINT electricity_draft_termination_review CHECK(jsonb_typeof(financial_review)='object')
);

--> statement-breakpoint
CREATE FUNCTION guard_electricity_draft_termination() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e electricity_orders%ROWTYPE; root orders%ROWTYPE; approval approval_requests%ROWTYPE; facts jsonb; line jsonb; amount numeric:=0; config jsonb; threshold numeric:=0;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Draft terminal authority is immutable' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM profiles WHERE id=NEW.profile_id AND NOT archived FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft profile unavailable' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM invoices WHERE order_id=NEW.order_id ORDER BY id FOR UPDATE NOWAIT;
 SELECT * INTO e FROM electricity_orders WHERE id=NEW.order_id FOR UPDATE NOWAIT;
 SELECT * INTO root FROM orders WHERE id=NEW.order_id FOR UPDATE NOWAIT;
 facts:=NEW.financial_review->'data';
 IF e.id IS NULL OR e.profile_id<>NEW.profile_id OR root.profile_id<>NEW.profile_id OR root.order_type<>'electricity' OR root.status NOT IN ('DRAFT','PENDING') OR e.status<>'draft' OR e.submitted_at IS NOT NULL OR e.submitted_by IS NOT NULL
  OR EXISTS(SELECT 1 FROM contracts WHERE order_id=e.id) OR EXISTS(SELECT 1 FROM electricity_contracts WHERE order_id=e.id) OR EXISTS(SELECT 1 FROM electricity_order_submissions WHERE order_id=e.id)
  OR NOT raw_electricity_draft_gift_consistent(e.id,e.profile_id,root.gift_code_id)
  OR EXISTS(SELECT 1 FROM wallet_transactions WHERE type='payment' AND lower(ref_id)=e.id::text)
  OR NEW.financial_review->>'hash' IS DISTINCT FROM NEW.review_hash
  OR NEW.financial_review->>'schemaVersion' IS DISTINCT FROM '1'
  OR NEW.financial_review->'scope'->>'resourceId' IS DISTINCT FROM NEW.order_id::text
  OR NEW.financial_review->'scope'->>'profileId' IS DISTINCT FROM NEW.profile_id::text
  OR NEW.financial_review->'scope'->>'action' IS DISTINCT FROM 'electricity.draft-terminal.'||NEW.action
  OR facts->>'action' IS DISTINCT FROM NEW.action OR facts->>'reason' IS DISTINCT FROM NEW.reason
  OR facts->>'fromState' IS DISTINCT FROM 'draft' OR facts->>'toState' IS DISTINCT FROM (CASE WHEN NEW.action='reject' THEN 'rejected' ELSE 'cancelled' END)
  OR jsonb_typeof(facts->'invoices') IS DISTINCT FROM 'array' OR facts->>'createsContract' IS DISTINCT FROM 'false' OR facts->>'createsInvoice' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Draft terminal authority must bind the existing order' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM invoices WHERE order_id=e.id)<>(SELECT count(*) FROM jsonb_array_elements(facts->'invoices'))
  OR (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(facts->'invoices'))
 THEN RAISE EXCEPTION 'Every orphan invoice must be captured exactly once' USING ERRCODE='23514'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(facts->'invoices') LOOP
  IF NOT EXISTS(SELECT 1 FROM invoices i WHERE i.id::text=line->>'id' AND i.order_id=e.id AND i.profile_id=e.profile_id AND i.contract_id IS NULL AND i.adjustment_kind IS DISTINCT FROM 'credit' AND (i.total_amount>0 OR (i.total_amount=0 AND i.paid_amount=0 AND i.refunded_amount=0 AND i.state IN ('Cancelled','Refunded')))
    AND i.state::text=line->>'state' AND i.paid_amount::text=line->>'paidAmount' AND i.refunded_amount::text=line->>'refundedAmount' AND i.total_amount::text=line->>'totalAmount'
    AND (i.paid_amount-i.refunded_amount)::text=line->>'refundableAmount'
    AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.invoice_id=i.id AND r.state NOT IN ('Completed','Rejected','Cancelled'))
    AND NOT EXISTS(SELECT 1 FROM bank_receipts b WHERE b.invoice_id=i.id AND b.state IN ('Submitted','UnderReview'))
    AND NOT EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.wallet_id=i.profile_id AND lower(w.ref_id)=i.id::text AND w.type='payment' AND w.state IN ('Pending','Reserved')))
  THEN RAISE EXCEPTION 'Orphan financial facts changed or require reconciliation' USING ERRCODE='23514'; END IF;
  amount:=amount+(line->>'refundableAmount')::numeric;
 END LOOP;
 IF amount<0 OR amount>9223372036854775807 OR amount::text IS DISTINCT FROM facts->>'refundAmount'
 THEN RAISE EXCEPTION 'Exact full wallet return required' USING ERRCODE='23514'; END IF;
 SELECT value INTO config FROM app_config WHERE key='finance.dual_approval_threshold';
 IF FOUND THEN
  IF jsonb_typeof(config)<>'object' OR jsonb_typeof(COALESCE(config->'threshold_irr',config->'thresholdIrR')) IS DISTINCT FROM 'number' OR COALESCE(config->>'threshold_irr',config->>'thresholdIrR','') !~ '^[0-9]+(\.0+)?$'
  THEN RAISE EXCEPTION 'Financial approval policy corrupt' USING ERRCODE='23514'; END IF;
  threshold:=COALESCE(config->>'threshold_irr',config->>'thresholdIrR')::numeric;
  IF threshold>9007199254740991 THEN RAISE EXCEPTION 'Financial approval policy corrupt' USING ERRCODE='23514'; END IF;
 END IF;
 IF facts->'approvalPolicy' IS DISTINCT FROM (CASE WHEN threshold>0 THEN jsonb_build_object('enabled',true,'thresholdIrR',trunc(threshold)::text) ELSE jsonb_build_object('enabled',false) END)
 THEN RAISE EXCEPTION 'Financial approval policy changed' USING ERRCODE='23514'; END IF;
 IF threshold>0 AND amount>=threshold THEN
  SELECT * INTO approval FROM approval_requests WHERE id=NEW.approval_request_id FOR SHARE NOWAIT;
  IF approval.id IS NULL OR approval.status<>'approved' OR approval.reviewer_id IS NULL OR approval.reviewer_id=approval.initiator_id OR approval.action_type<>'contract_cancellation' OR approval.amount_irr<>amount
    OR approval.details->>'entityType' IS DISTINCT FROM 'electricity_order_termination' OR approval.details->>'orderId' IS DISTINCT FROM NEW.order_id::text OR approval.details->>'profileId' IS DISTINCT FROM NEW.profile_id::text OR approval.details->>'terminalAction' IS DISTINCT FROM NEW.action OR approval.details->>'reviewHash' IS DISTINCT FROM NEW.review_hash OR approval.details->'financialReview' IS DISTINCT FROM NEW.financial_review
  THEN RAISE EXCEPTION 'Exact second approval required' USING ERRCODE='23514'; END IF;
 ELSIF NEW.approval_request_id IS NOT NULL THEN RAISE EXCEPTION 'Approval policy changed' USING ERRCODE='23514';
 END IF;
 NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER electricity_draft_terminations_guard BEFORE INSERT OR UPDATE OR DELETE ON electricity_draft_terminations FOR EACH ROW EXECUTE FUNCTION guard_electricity_draft_termination();

--> statement-breakpoint
CREATE FUNCTION enforce_electricity_draft_termination_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line jsonb; facts jsonb:=NEW.financial_review->'data';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM electricity_orders e JOIN orders o ON o.id=e.id WHERE e.id=NEW.order_id AND e.profile_id=NEW.profile_id AND o.profile_id=NEW.profile_id AND o.status='CANCELLED' AND e.status=CASE WHEN NEW.action='reject' THEN 'rejected' ELSE 'cancelled' END)
  OR NOT EXISTS(SELECT 1 FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=NEW.order_id::text AND metadata::jsonb->>'reviewHash'=NEW.review_hash AND user_id=NEW.executed_by AND metadata::jsonb->'financialReview'=NEW.financial_review)
 THEN RAISE EXCEPTION 'Orphan termination requires retained terminal state and audit' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM contracts WHERE order_id=NEW.order_id) OR EXISTS(SELECT 1 FROM electricity_contracts WHERE order_id=NEW.order_id) OR EXISTS(SELECT 1 FROM electricity_order_submissions WHERE order_id=NEW.order_id)
 THEN RAISE EXCEPTION 'Orphan termination cannot fabricate contract or submission history' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM invoices WHERE order_id=NEW.order_id)<>(SELECT count(*) FROM jsonb_array_elements(facts->'invoices')) THEN RAISE EXCEPTION 'Orphan invoice set changed' USING ERRCODE='23514'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(facts->'invoices') LOOP
  IF (line->>'refundableAmount')::bigint>0 AND NOT EXISTS(SELECT 1 FROM refund_obligations o JOIN refunds r ON r.id=o.refund_id JOIN refund_retry_jobs j ON j.refund_id=r.id WHERE o.order_id=NEW.order_id AND o.invoice_id::text=line->>'id' AND o.contract_id IS NULL AND o.profile_id=NEW.profile_id AND o.authorized_by=NEW.executed_by AND j.executor_user_id=NEW.executed_by AND o.total_paid_amount::text=line->>'paidAmount' AND o.completed_refund_amount::text=line->>'refundedAmount' AND o.reason=NEW.reason AND r.invoice_id=o.invoice_id AND r.profile_id=o.profile_id AND r.destination='wallet' AND r.staff_id IS NULL AND r.amount::text=line->>'refundableAmount' AND r.state='Processing')
  THEN RAISE EXCEPTION 'Every full wallet obligation must commit atomically' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM invoices i WHERE i.id::text=line->>'id' AND i.order_id=NEW.order_id AND i.profile_id=NEW.profile_id AND i.contract_id IS NULL AND i.total_amount::text=line->>'totalAmount' AND i.paid_amount::text=line->>'paidAmount' AND i.refunded_amount::text=line->>'refundedAmount' AND (i.paid_amount>0 OR i.state IN ('Cancelled','Refunded')))
  THEN RAISE EXCEPTION 'Orphan invoice balances or unpaid closure changed' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER electricity_draft_termination_complete AFTER INSERT ON electricity_draft_terminations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_electricity_draft_termination_complete();

--> statement-breakpoint
CREATE FUNCTION guard_orphan_terminal_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authority electricity_draft_terminations%ROWTYPE;
BEGIN
 IF NEW.contract_id IS NOT NULL THEN RETURN NEW; END IF;
 SELECT * INTO authority FROM electricity_draft_terminations WHERE order_id=NEW.order_id;
 IF authority.order_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.idempotency_key='electricity-end:'||OLD.order_id::text THEN RETURN NEW; END IF;
 IF NEW.profile_id<>authority.profile_id OR NEW.authorized_by<>authority.executed_by OR NEW.reason<>authority.reason
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(authority.financial_review->'data'->'invoices') i WHERE i->>'id'=NEW.invoice_id::text AND i->>'paidAmount'=NEW.total_paid_amount::text AND (TG_OP='UPDATE' OR i->>'refundedAmount'=NEW.completed_refund_amount::text))
 THEN RAISE EXCEPTION 'Orphan refund must bind its immutable terminal authority' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER refund_obligations_orphan_terminal_guard BEFORE INSERT OR UPDATE ON refund_obligations FOR EACH ROW EXECUTE FUNCTION guard_orphan_terminal_refund();

--> statement-breakpoint
-- The existing association/history guards remain in force. A financial record
-- exists before the guarded terminal update and is checked again at commit.
CREATE FUNCTION guard_orphan_terminal_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
 IF EXISTS(SELECT 1 FROM electricity_draft_terminations t JOIN electricity_orders e ON e.id=t.order_id WHERE t.order_id=target AND e.status IN ('rejected','cancelled')) OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM electricity_draft_terminations t JOIN electricity_orders e ON e.id=t.order_id WHERE t.order_id=OLD.order_id AND e.status IN ('rejected','cancelled'))) THEN
  -- Stored generated columns are not populated in NEW before UPDATE. Their
  -- immutable source fields remain part of the complete comparison.
  IF TG_OP<>'UPDATE' OR (to_jsonb(NEW)-'state'-'refunded_amount'-'updated_at'-'accounting_amount') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'refunded_amount'-'updated_at'-'accounting_amount') OR NEW.refunded_amount<OLD.refunded_amount
   OR (NEW.state IS DISTINCT FROM OLD.state AND NOT (
     (NEW.state='Refunded' AND NEW.refunded_amount=NEW.paid_amount)
     OR (NEW.state='PartiallyRefunded' AND NEW.refunded_amount>0 AND NEW.refunded_amount<NEW.paid_amount)
     OR (NEW.state='Cancelled' AND NEW.refunded_amount=NEW.paid_amount)))
  THEN RAISE EXCEPTION 'Orphan terminal invoice history is retained' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER invoices_orphan_terminal_guard BEFORE INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION guard_orphan_terminal_invoice();


--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_electricity_order_settings_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Electricity order history is retained' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('rejected','cancelled') AND (EXISTS(
    SELECT 1 FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=OLD.id::text
  ) OR has_reviewed_electricity_rejection(OLD.id)) AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN
    RAISE EXCEPTION 'Terminated raw electricity draft history is retained' USING ERRCODE='23514';
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
  -- Contractless financial closure retains an exact immutable authority.
  IF OLD.status='draft' AND NEW.status='rejected'
   AND (to_jsonb(NEW)-'status'-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at')
   AND EXISTS(SELECT 1 FROM electricity_draft_terminations t JOIN orders o ON o.id=t.order_id WHERE t.order_id=OLD.id AND t.profile_id=OLD.profile_id AND t.action='reject' AND o.profile_id=OLD.profile_id AND o.order_type='electricity' AND o.status='CANCELLED')
  THEN RETURN NEW; END IF;
  -- Linked incomplete drafts use the same reviewed immutable terminal engine.
  IF OLD.status='draft' AND NEW.status='rejected'
   AND (to_jsonb(NEW)-'status'-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at')
   AND EXISTS(SELECT 1 FROM contracts c JOIN contract_cancellations x ON x.contract_id=c.id JOIN contract_cancellation_intents n ON n.id=x.intent_id JOIN orders o ON o.id=OLD.id
     WHERE c.order_id=OLD.id AND c.profile_id=OLD.profile_id AND c.state='Rejected' AND c.current_version_id=n.version_id
       AND n.financial_snapshot->>'terminalAction'='reject' AND n.financial_snapshot->'electricityOrder'->>'commercialStatus'='draft'
       AND o.profile_id=OLD.profile_id AND o.order_type='electricity' AND o.status='CANCELLED')
  THEN RETURN NEW; END IF;
  -- An unlinked, unfunded raw draft can end without fabricated submission data.
  IF TG_OP='UPDATE' AND OLD.status='draft' AND NEW.status='rejected'
    AND (to_jsonb(NEW)-'status'-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at')
    AND EXISTS(SELECT 1 FROM orders o WHERE o.id=OLD.id AND o.profile_id=OLD.profile_id AND o.order_type='electricity' AND o.status='CANCELLED' AND raw_electricity_draft_gift_consistent(o.id,o.profile_id,o.gift_code_id))
    AND NOT EXISTS(SELECT 1 FROM contracts WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM electricity_contracts WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM invoices WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM refund_obligations WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM electricity_order_submissions WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE type='payment' AND lower(ref_id)=OLD.id::text)
    AND OLD.submitted_at IS NULL AND OLD.submitted_by IS NULL
  THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('draft', 'cancelled') AND (
    NEW.period_start IS NULL OR NEW.period_end IS NULL OR
    NEW.submitted_at IS NULL OR NEW.pricing_snapshot IS NULL OR
    NEW.period_end <= NEW.period_start
  ) THEN
    RAISE EXCEPTION 'Submitted electricity order needs period and pricing snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION has_reviewed_electricity_rejection(order_uuid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM contracts c JOIN contract_cancellations x ON x.contract_id=c.id JOIN contract_cancellation_intents n ON n.id=x.intent_id JOIN electricity_orders e ON e.id=c.order_id
 WHERE c.order_id=order_uuid AND c.state='Rejected' AND c.service_type='electricity' AND c.profile_id=e.profile_id AND c.current_version_id=n.version_id AND n.financial_snapshot->>'terminalAction'='reject');
$$;
--> statement-breakpoint
-- Expand the existing immutable terminal/refund engine with a captured
-- pre-active electricity rejection action. Existing cancellation snapshots and
-- their fingerprints retain their original shape and meaning.
CREATE FUNCTION electricity_rejection_order_snapshot(contract_uuid uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('orderId',e.id,'profileId',e.profile_id,'rootProfileId',o.profile_id,
   'rootType',o.order_type,'rootStatus',o.status,'commercialStatus',e.status,
   'linkConflict',EXISTS(SELECT 1 FROM electricity_contracts ec WHERE ec.order_id=e.id AND ec.contract_id<>c.id),
   'stateFingerprint',encode(sha256(convert_to((to_jsonb(e)||jsonb_build_object('order',to_jsonb(o),
     'lines',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM electricity_order_lines l WHERE l.order_id=e.id),'[]'::jsonb)))::text,'UTF8')),'hex'))
 FROM contracts c JOIN electricity_orders e ON e.id=c.order_id JOIN orders o ON o.id=e.id WHERE c.id=contract_uuid;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_contract_cancellation_intent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; approval approval_requests%ROWTYPE; profile_archived boolean; line jsonb; requested numeric:=0;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cancellation decisions are immutable' USING ERRCODE='23514'; END IF;
 SELECT p.archived INTO profile_archived FROM contracts c JOIN profiles p ON p.id=c.profile_id WHERE c.id=NEW.contract_id FOR SHARE OF p NOWAIT;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE NOWAIT;
 IF parent.id IS NULL OR profile_archived IS DISTINCT FROM false OR parent.state IN ('Completed','Cancelled') OR parent.current_version_id<>NEW.version_id
 THEN RAISE EXCEPTION 'Cancellation decision requires the current available nonterminal version' USING ERRCODE='23514'; END IF;
 IF NEW.financial_snapshot ? 'terminalAction' AND NEW.financial_snapshot->>'terminalAction' IS DISTINCT FROM 'reject'
 THEN RAISE EXCEPTION 'Invalid captured terminal action' USING ERRCODE='23514'; END IF;
 IF NEW.financial_snapshot->>'terminalAction'='reject' THEN
  IF parent.service_type<>'electricity' OR NEW.customer_request_id IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM electricity_orders e JOIN orders o ON o.id=e.id WHERE e.id=parent.order_id
    AND e.profile_id=parent.profile_id AND o.profile_id=e.profile_id AND o.order_type='electricity' AND o.status<>'CANCELLED'
    AND ((e.status='draft' AND parent.state='Draft') OR (e.status IN ('submitted','awaiting_staff_review') AND parent.state='AwaitingStaffReview')
      OR (e.status='changes_requested' AND parent.state='ChangesRequested') OR (e.status='approved' AND parent.state IN ('AwaitingCustomerAcceptance','Accepted','AwaitingSignature','Signed'))))
   OR NEW.financial_snapshot->'electricityOrder'->>'linkConflict' IS DISTINCT FROM 'false'
   OR NEW.financial_snapshot->'electricityOrder' IS DISTINCT FROM electricity_rejection_order_snapshot(parent.id)
  THEN RAISE EXCEPTION 'Rejection must bind a current pre-active electricity order' USING ERRCODE='23514'; END IF;
  IF NEW.approval_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM approval_requests a WHERE a.id=NEW.approval_request_id AND a.details->>'terminalAction'='reject')
  THEN RAISE EXCEPTION 'Rejection approval must identify the captured action' USING ERRCODE='23514'; END IF;
 END IF;
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_contract_cancellation_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; intent contract_cancellation_intents%ROWTYPE; approval approval_requests%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cancellation evidence is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE NOWAIT;
 SELECT * INTO intent FROM contract_cancellation_intents WHERE id=NEW.intent_id AND contract_id=NEW.contract_id;
 IF parent.id IS NULL OR intent.id IS NULL OR ((intent.financial_snapshot->>'terminalAction'='reject' AND (parent.state<>'Rejected' OR parent.service_type<>'electricity')) OR (COALESCE(intent.financial_snapshot->>'terminalAction','cancel')='cancel' AND (parent.state<>'Cancelled' OR parent.cancelled_at IS NULL))) OR parent.current_version_id<>intent.version_id
 THEN RAISE EXCEPTION 'Cancellation evidence must match the cancelled contract version' USING ERRCODE='23514'; END IF;
 IF intent.financial_snapshot->>'terminalAction'='reject' AND (intent.customer_request_id IS NOT NULL OR (intent.approval_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM approval_requests a WHERE a.id=intent.approval_request_id AND a.details->>'terminalAction'='reject'))) THEN RAISE EXCEPTION 'Rejection execution must retain its action and approval' USING ERRCODE='23514'; END IF;
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
 NEW.cancelled_at:=CASE WHEN intent.financial_snapshot->>'terminalAction'='reject' THEN clock_timestamp() ELSE parent.cancelled_at END;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_contract_refund_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; invoice invoices%ROWTYPE; refund refunds%ROWTYPE; decision jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Contract refund obligations are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id;
 SELECT * INTO invoice FROM invoices WHERE id=NEW.invoice_id FOR UPDATE NOWAIT;
 SELECT * INTO refund FROM refunds WHERE id=NEW.refund_id FOR UPDATE NOWAIT;
 SELECT i.refund_decision INTO decision FROM contract_cancellations c JOIN contract_cancellation_intents i ON i.id=c.intent_id WHERE c.contract_id=NEW.contract_id;
 IF parent.id IS NULL OR NOT (parent.state='Cancelled' OR (parent.state='Rejected' AND parent.service_type='electricity' AND EXISTS(SELECT 1 FROM contract_cancellations x JOIN contract_cancellation_intents n ON n.id=x.intent_id WHERE x.contract_id=parent.id AND n.financial_snapshot->>'terminalAction'='reject'))) OR invoice.id IS NULL OR refund.id IS NULL
  OR invoice.profile_id<>parent.profile_id OR refund.invoice_id<>invoice.id OR refund.profile_id<>parent.profile_id
  OR refund.state<>'Requested' OR refund.staff_id IS NOT NULL
  OR NOT COALESCE((invoice.contract_id IS NOT DISTINCT FROM parent.id::text OR (parent.order_id IS NOT NULL AND invoice.order_id=parent.order_id AND invoice.contract_id IS NULL)),false)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(decision->'refunds') d WHERE d->>'invoiceId'=invoice.id::text AND d->>'amount'=refund.amount::text AND d->>'destination'=refund.destination::text)
 THEN RAISE EXCEPTION 'Contract refund obligation must bind the recorded decision and invoice' USING ERRCODE='23514'; END IF;
 NEW.created_at:=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_contract_cancellation_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intent contract_cancellation_intents%ROWTYPE; actual_impact numeric; parent contracts%ROWTYPE;
BEGIN
 IF NEW.state NOT IN ('Cancelled','Rejected') THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND OLD.state=NEW.state THEN RETURN NULL; END IF;
 -- Direct single-invoice rejection keeps its existing guarded obligation path.
 IF NEW.state='Rejected' AND NOT EXISTS(SELECT 1 FROM contract_cancellations x JOIN contract_cancellation_intents n ON n.id=x.intent_id WHERE x.contract_id=NEW.id AND n.financial_snapshot->>'terminalAction'='reject') THEN RETURN NULL; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.id;
 SELECT i.* INTO intent FROM contract_cancellations c JOIN contract_cancellation_intents i ON i.id=c.intent_id WHERE c.contract_id=NEW.id;
 IF intent.id IS NULL OR parent.state::text<>(CASE WHEN intent.financial_snapshot->>'terminalAction'='reject' THEN 'Rejected' ELSE 'Cancelled' END) OR parent.current_version_id<>intent.version_id
 THEN RAISE EXCEPTION 'Cancellation requires immutable execution evidence' USING ERRCODE='23514'; END IF;
 IF intent.financial_snapshot->>'terminalAction'='reject' AND NOT EXISTS(SELECT 1 FROM electricity_orders e JOIN orders o ON o.id=e.id WHERE e.id=parent.order_id AND e.profile_id=parent.profile_id AND e.status='rejected' AND o.status='CANCELLED' AND o.profile_id=e.profile_id AND o.order_type='electricity') THEN RAISE EXCEPTION 'Rejection requires consistent retained order state' USING ERRCODE='23514'; END IF;
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_cancelled_contract_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE;
BEGIN
 -- Matching both old and new associations prevents removing an invoice from terminal history.
 FOR parent IN SELECT c.* FROM contracts c WHERE
   c.id::text=NEW.contract_id OR (c.order_id=NEW.order_id AND NEW.contract_id IS NULL)
   OR (TG_OP IN ('UPDATE','DELETE') AND (c.id::text=OLD.contract_id OR (c.order_id=OLD.order_id AND OLD.contract_id IS NULL)))
   ORDER BY c.id FOR SHARE NOWAIT LOOP
  IF (parent.state='Cancelled' OR (parent.state='Rejected' AND EXISTS(SELECT 1 FROM contract_cancellations x JOIN contract_cancellation_intents n ON n.id=x.intent_id WHERE x.contract_id=parent.id AND n.financial_snapshot->>'terminalAction'='reject'))) THEN
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_contract_invoice_payment_allowed(invoice_uuid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE invoice invoices%ROWTYPE; parent contracts%ROWTYPE;
BEGIN
 SELECT * INTO invoice FROM invoices WHERE id=invoice_uuid FOR UPDATE NOWAIT;
 IF invoice.id IS NULL THEN RETURN; END IF;
 FOR parent IN SELECT c.* FROM contracts c WHERE c.id::text=invoice.contract_id
   OR (c.order_id=invoice.order_id AND invoice.contract_id IS NULL) ORDER BY c.id FOR SHARE NOWAIT LOOP
  IF (parent.state='Cancelled' OR (parent.state='Rejected' AND EXISTS(SELECT 1 FROM contract_cancellations x JOIN contract_cancellation_intents n ON n.id=x.intent_id WHERE x.contract_id=parent.id AND n.financial_snapshot->>'terminalAction'='reject')))
  THEN RAISE EXCEPTION 'Cancelled contracts cannot receive payments' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
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
    AND EXISTS(SELECT 1 FROM orders o WHERE o.id=OLD.id AND o.profile_id=OLD.profile_id AND o.order_type='electricity' AND o.status='CANCELLED' AND o.gift_code_id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM contracts WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM electricity_contracts WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM invoices WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM gift_code_redemptions WHERE order_id=OLD.id)
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_raw_electricity_link_allowed(target_order uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target_profile uuid; target_status text;
BEGIN
 SELECT profile_id INTO target_profile FROM electricity_orders WHERE id=target_order;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM 1 FROM profiles WHERE id=target_profile FOR KEY SHARE NOWAIT;
 SELECT status INTO target_status FROM electricity_orders WHERE id=target_order FOR SHARE NOWAIT;
 IF target_status IN ('rejected','cancelled') AND (EXISTS(
   SELECT 1 FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=target_order::text
 ) OR has_reviewed_electricity_rejection(target_order)) THEN RAISE EXCEPTION 'Terminated raw electricity drafts cannot acquire business associations' USING ERRCODE='23514'; END IF;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_raw_electricity_terminal_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM electricity_orders e WHERE e.id=OLD.id AND e.status IN ('rejected','cancelled')) AND (EXISTS(
   SELECT 1 FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=OLD.id::text
 ) OR has_reviewed_electricity_rejection(OLD.id)) THEN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at')
  THEN RAISE EXCEPTION 'Terminated raw electricity order history is retained' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

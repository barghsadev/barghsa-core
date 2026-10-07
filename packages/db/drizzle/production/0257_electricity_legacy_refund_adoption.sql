-- Existing full-wallet debt may be adopted without changing its identity,
-- principal, original author or retry budget. No historical row is rewritten.
CREATE FUNCTION electricity_draft_existing_return(target_order uuid, target_profile uuid, target_invoice uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('refundId',r.id,'invoiceId',i.id,'amount',r.amount::text,
  'authorizedBy',o.authorized_by,'reason',o.reason,'idempotencyKey',o.idempotency_key,
  'totalPaidAmount',o.total_paid_amount::text,'completedRefundAmount',o.completed_refund_amount::text,
  'status',o.status,'refundState',r.state,
  'job',CASE WHEN j.refund_id IS NULL THEN NULL ELSE jsonb_build_object('executorUserId',j.executor_user_id,'attempts',j.attempts,'maxAttempts',j.max_attempts,'exhausted',j.exhausted_at IS NOT NULL,'nextAttemptAt',j.next_attempt_at) END)
 FROM refund_obligations o JOIN refunds r ON r.id=o.refund_id JOIN invoices i ON i.id=o.invoice_id
 LEFT JOIN refund_retry_jobs j ON j.refund_id=r.id
 WHERE o.order_id=target_order AND o.profile_id=target_profile AND o.invoice_id=target_invoice AND o.contract_id IS NULL
  AND o.idempotency_key='electricity-end:'||target_order::text
  AND i.order_id=target_order AND i.profile_id=target_profile AND i.contract_id IS NULL
  AND r.invoice_id=i.id AND r.profile_id=target_profile AND r.destination='wallet' AND r.staff_id IS NULL
  AND o.total_paid_amount=i.paid_amount AND o.completed_refund_amount=i.refunded_amount
  AND r.amount=i.paid_amount-i.refunded_amount AND r.amount>0
  AND ((o.status='pending' AND r.state IN ('Requested','Approved')) OR (o.status='processing' AND r.state='Processing') OR (o.status='failed' AND r.state='Failed'))
  AND (j.refund_id IS NULL AND r.state IN ('Requested','Approved') OR j.executor_user_id=o.authorized_by AND j.completed_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM refunds other WHERE other.invoice_id=i.id AND other.id<>r.id AND other.state NOT IN ('Completed','Rejected','Cancelled'))
$$;

--> statement-breakpoint
CREATE FUNCTION electricity_draft_return_matches(target_order uuid,target_profile uuid,line jsonb,claim jsonb,phase text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(EXISTS(
  SELECT 1 FROM refund_obligations o JOIN refunds r ON r.id=o.refund_id LEFT JOIN refund_retry_jobs j ON j.refund_id=r.id
  WHERE o.order_id=target_order AND o.profile_id=target_profile AND o.contract_id IS NULL
   AND o.invoice_id::text=line->>'id' AND o.refund_id::text=claim->>'refundId' AND claim->>'invoiceId'=line->>'id'
   AND o.authorized_by=claim->>'authorizedBy' AND o.reason=claim->>'reason' AND o.idempotency_key=claim->>'idempotencyKey'
   AND o.total_paid_amount::text=claim->>'totalPaidAmount' AND o.total_paid_amount::text=line->>'paidAmount'
   AND claim->>'completedRefundAmount'=line->>'refundedAmount'
   AND r.invoice_id=o.invoice_id AND r.profile_id=target_profile AND r.destination='wallet' AND r.staff_id IS NULL
   AND r.amount::text=claim->>'amount' AND r.amount::text=line->>'refundableAmount'
   AND (CASE phase
    WHEN 'prepare' THEN claim=electricity_draft_existing_return(target_order,target_profile,o.invoice_id)
    WHEN 'complete' THEN j.executor_user_id=o.authorized_by AND j.completed_at IS NULL
      AND o.completed_refund_amount::text=claim->>'completedRefundAmount'
      AND ((r.state='Processing' AND o.status='processing') OR (r.state='Failed' AND o.status='failed'))
      AND (CASE WHEN claim->'job'='null'::jsonb THEN j.attempts=0 AND j.exhausted_at IS NULL ELSE
       j.attempts::text=claim->'job'->>'attempts' AND j.max_attempts::text=claim->'job'->>'maxAttempts'
       AND (j.exhausted_at IS NOT NULL)::text=claim->'job'->>'exhausted'
       AND COALESCE(to_jsonb(j.next_attempt_at),'null'::jsonb) IS NOT DISTINCT FROM claim->'job'->'nextAttemptAt' END)
    WHEN 'authorized' THEN j.executor_user_id=o.authorized_by
      AND o.status IN ('processing','failed','completed') AND r.state IN ('Processing','Failed','Completed')
    ELSE false END)
 ),false)
$$;


--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_electricity_draft_termination() RETURNS trigger LANGUAGE plpgsql AS $$
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
    AND ((NOT EXISTS(SELECT 1 FROM refunds r WHERE r.invoice_id=i.id AND r.state NOT IN ('Completed','Rejected','Cancelled'))
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(facts->'existingReturns','[]'::jsonb)) claim WHERE claim->>'invoiceId'=i.id::text))
      OR ((SELECT count(*) FROM jsonb_array_elements(COALESCE(facts->'existingReturns','[]'::jsonb)) claim WHERE claim->>'invoiceId'=i.id::text)=1
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(facts->'existingReturns') claim WHERE claim->>'invoiceId'=i.id::text AND electricity_draft_return_matches(e.id,e.profile_id,line,claim,'prepare'))))
    AND NOT EXISTS(SELECT 1 FROM bank_receipts b WHERE b.invoice_id=i.id AND b.state IN ('Submitted','UnderReview'))
    AND NOT EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.wallet_id=i.profile_id AND lower(w.ref_id)=i.id::text AND w.type='payment' AND w.state IN ('Pending','Reserved')))
  THEN RAISE EXCEPTION 'Orphan financial facts changed or require reconciliation' USING ERRCODE='23514'; END IF;
  amount:=amount+(line->>'refundableAmount')::numeric;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(facts->'existingReturns','[]'::jsonb)) claim WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(facts->'invoices') i WHERE i->>'id'=claim->>'invoiceId')) THEN RAISE EXCEPTION 'Adopted refund outside captured invoices' USING ERRCODE='23514'; END IF;
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_electricity_draft_termination_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line jsonb; facts jsonb:=NEW.financial_review->'data';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM electricity_orders e JOIN orders o ON o.id=e.id WHERE e.id=NEW.order_id AND e.profile_id=NEW.profile_id AND o.profile_id=NEW.profile_id AND o.status='CANCELLED' AND e.status=CASE WHEN NEW.action='reject' THEN 'rejected' ELSE 'cancelled' END)
  OR NOT EXISTS(SELECT 1 FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=NEW.order_id::text AND metadata::jsonb->>'reviewHash'=NEW.review_hash AND user_id=NEW.executed_by AND metadata::jsonb->'financialReview'=NEW.financial_review)
 THEN RAISE EXCEPTION 'Orphan termination requires retained terminal state and audit' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM contracts WHERE order_id=NEW.order_id) OR EXISTS(SELECT 1 FROM electricity_contracts WHERE order_id=NEW.order_id) OR EXISTS(SELECT 1 FROM electricity_order_submissions WHERE order_id=NEW.order_id)
 THEN RAISE EXCEPTION 'Orphan termination cannot fabricate contract or submission history' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM invoices WHERE order_id=NEW.order_id)<>(SELECT count(*) FROM jsonb_array_elements(facts->'invoices')) THEN RAISE EXCEPTION 'Orphan invoice set changed' USING ERRCODE='23514'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(facts->'invoices') LOOP
  IF (line->>'refundableAmount')::bigint>0 AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(facts->'existingReturns','[]'::jsonb)) claim WHERE claim->>'invoiceId'=line->>'id') THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(facts->'existingReturns') claim WHERE claim->>'invoiceId'=line->>'id' AND electricity_draft_return_matches(NEW.order_id,NEW.profile_id,line,claim,'complete')
    AND EXISTS(SELECT 1 FROM audit_log a WHERE a.event='refund.obligation_adopted' AND a.metadata::jsonb->>'entityId'=claim->>'refundId' AND a.metadata::jsonb->>'reviewHash'=NEW.review_hash AND a.user_id=NEW.executed_by))
   THEN RAISE EXCEPTION 'Adopted full wallet obligation and unchanged retry budget must commit atomically' USING ERRCODE='23514'; END IF;
  ELSE
  IF (line->>'refundableAmount')::bigint>0 AND NOT EXISTS(SELECT 1 FROM refund_obligations o JOIN refunds r ON r.id=o.refund_id JOIN refund_retry_jobs j ON j.refund_id=r.id WHERE o.order_id=NEW.order_id AND o.invoice_id::text=line->>'id' AND o.contract_id IS NULL AND o.profile_id=NEW.profile_id AND o.authorized_by=NEW.executed_by AND j.executor_user_id=NEW.executed_by AND o.total_paid_amount::text=line->>'paidAmount' AND o.completed_refund_amount::text=line->>'refundedAmount' AND o.reason=NEW.reason AND r.invoice_id=o.invoice_id AND r.profile_id=o.profile_id AND r.destination='wallet' AND r.staff_id IS NULL AND r.amount::text=line->>'refundableAmount' AND r.state='Processing')
  THEN RAISE EXCEPTION 'Every full wallet obligation must commit atomically' USING ERRCODE='23514'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM invoices i WHERE i.id::text=line->>'id' AND i.order_id=NEW.order_id AND i.profile_id=NEW.profile_id AND i.contract_id IS NULL AND i.total_amount::text=line->>'totalAmount' AND i.paid_amount::text=line->>'paidAmount' AND i.refunded_amount::text=line->>'refundedAmount' AND (i.paid_amount>0 OR i.state IN ('Cancelled','Refunded')))
  THEN RAISE EXCEPTION 'Orphan invoice balances or unpaid closure changed' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;

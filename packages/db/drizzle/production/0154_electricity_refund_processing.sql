-- Existing paid rejections were recorded as Requested before the worker was
-- connected. Queue them without creating a second refund or wallet credit.
UPDATE refunds r SET state='Approved'
FROM refund_obligations o
WHERE o.refund_id=r.id AND o.status='pending' AND r.state='Requested';
--> statement-breakpoint
UPDATE refunds r SET state='Processing'
FROM refund_obligations o
WHERE o.refund_id=r.id AND o.status='pending' AND r.state='Approved';
--> statement-breakpoint
INSERT INTO refund_retry_jobs(refund_id,executor_user_id)
SELECT o.refund_id,o.authorized_by FROM refund_obligations o
JOIN refunds r ON r.id=o.refund_id
WHERE o.status='pending' AND r.state IN ('Processing','Failed')
ON CONFLICT(refund_id) DO NOTHING;
--> statement-breakpoint
UPDATE refund_obligations o SET status='processing',updated_at=clock_timestamp()
FROM refunds r WHERE r.id=o.refund_id AND o.status='pending' AND r.state='Processing';
--> statement-breakpoint
UPDATE refund_obligations o SET status='failed',updated_at=clock_timestamp()
FROM refunds r WHERE r.id=o.refund_id AND o.status='pending' AND r.state='Failed';
--> statement-breakpoint
UPDATE refund_obligations o SET status='completed',
  completed_refund_amount=o.total_paid_amount,updated_at=clock_timestamp()
FROM refunds r JOIN wallet_transactions w
  ON w.idempotency_key='refund-wallet-credit:'||r.id::text
WHERE r.id=o.refund_id AND o.status='pending' AND r.state='Completed'
  AND w.wallet_id=o.profile_id AND w.amount=r.amount AND w.type='refund'
  AND w.state='Completed' AND w.ref_id=r.id::text;
--> statement-breakpoint
CREATE FUNCTION guard_electricity_refund_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refund_row refunds%ROWTYPE; prior_completed bigint;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Electricity refund obligations cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.order_id,NEW.contract_id,NEW.invoice_id,
      NEW.profile_id,NEW.refund_id,NEW.total_paid_amount,NEW.idempotency_key,
      NEW.authorized_by,NEW.reason,NEW.created_at) IS DISTINCT FROM
      ROW(OLD.id,OLD.order_id,OLD.contract_id,OLD.invoice_id,
      OLD.profile_id,OLD.refund_id,OLD.total_paid_amount,OLD.idempotency_key,
      OLD.authorized_by,OLD.reason,OLD.created_at) THEN
    RAISE EXCEPTION 'Electricity refund obligation identity is immutable' USING ERRCODE='23514';
  END IF;
  prior_completed:=CASE WHEN TG_OP='INSERT' THEN NEW.completed_refund_amount
    ELSE OLD.completed_refund_amount END;
  SELECT * INTO refund_row FROM refunds WHERE id=NEW.refund_id;
  IF refund_row.id IS NULL OR refund_row.invoice_id<>NEW.invoice_id
     OR refund_row.profile_id<>NEW.profile_id OR refund_row.destination<>'wallet'
     OR refund_row.staff_id IS NOT NULL OR
     (TG_OP='INSERT' AND refund_row.amount<>NEW.total_paid_amount-NEW.completed_refund_amount)
  THEN RAISE EXCEPTION 'Electricity refund obligation must match its refund' USING ERRCODE='23514'; END IF;
  IF (NEW.status='pending' AND refund_row.state<>'Requested')
     OR (NEW.status='processing' AND refund_row.state<>'Processing')
     OR (NEW.status='failed' AND refund_row.state<>'Failed')
     OR (NEW.status='completed' AND refund_row.state<>'Completed')
  THEN RAISE EXCEPTION 'Electricity refund obligation state must match its refund' USING ERRCODE='23514'; END IF;
  IF NEW.status='completed' THEN
    IF refund_row.state<>'Completed' OR NEW.completed_refund_amount<>NEW.total_paid_amount
       OR NOT EXISTS(SELECT 1 FROM wallet_transactions w
         WHERE w.idempotency_key='refund-wallet-credit:'||NEW.refund_id::text
           AND w.wallet_id=NEW.profile_id AND w.amount=refund_row.amount
           AND w.type='refund' AND w.state='Completed' AND w.ref_id=NEW.refund_id::text)
    THEN RAISE EXCEPTION 'Completed obligation requires its posted wallet credit' USING ERRCODE='23514'; END IF;
  ELSIF NEW.completed_refund_amount IS DISTINCT FROM prior_completed THEN
    RAISE EXCEPTION 'Incomplete obligation cannot claim a refund' USING ERRCODE='23514';
  END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER electricity_refund_obligation_guard
BEFORE INSERT OR UPDATE OR DELETE ON refund_obligations
FOR EACH ROW EXECUTE FUNCTION guard_electricity_refund_obligation();
--> statement-breakpoint
CREATE FUNCTION synchronize_electricity_refund_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('Rejected','Cancelled') AND EXISTS(
    SELECT 1 FROM refund_obligations WHERE refund_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'Required electricity refunds cannot be dismissed' USING ERRCODE='23514';
  END IF;
  IF NEW.state<>OLD.state THEN
    UPDATE refund_obligations SET
      status=CASE NEW.state WHEN 'Completed' THEN 'completed'
        WHEN 'Failed' THEN 'failed' WHEN 'Processing' THEN 'processing' ELSE status END,
      completed_refund_amount=CASE WHEN NEW.state='Completed' THEN total_paid_amount
        ELSE completed_refund_amount END,
      updated_at=clock_timestamp()
    WHERE refund_id=NEW.id AND NEW.state IN ('Completed','Failed','Processing');
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER refunds_electricity_obligation_sync AFTER UPDATE ON refunds
FOR EACH ROW EXECUTE FUNCTION synchronize_electricity_refund_obligation();
--> statement-breakpoint
-- Contract cancellation already owns the mandatory refund and retry job.
-- Reflect that terminal commercial outcome in the electricity surfaces.
CREATE FUNCTION synchronize_electricity_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='Cancelled' AND OLD.state<>'Cancelled' AND EXISTS(
    SELECT 1 FROM electricity_contracts ec WHERE ec.contract_id=NEW.id
  ) THEN
    UPDATE electricity_orders SET status='cancelled',updated_at=clock_timestamp()
      WHERE id=NEW.order_id AND status NOT IN ('cancelled','rejected','completed');
    UPDATE electricity_contracts SET status='cancelled',updated_at=clock_timestamp()
      WHERE contract_id=NEW.id;
    UPDATE orders SET status='CANCELLED',updated_at=clock_timestamp()
      WHERE id=NEW.order_id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER contracts_electricity_cancellation AFTER UPDATE OF state ON contracts
FOR EACH ROW EXECUTE FUNCTION synchronize_electricity_cancellation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_rejected_electricity_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='Rejected' AND NEW.state<>'Rejected' THEN
    RAISE EXCEPTION 'Rejected electricity contracts are terminal' USING ERRCODE='23514';
  END IF;
  IF NEW.state='Rejected' AND OLD.state<>'Rejected' AND (
    NEW.service_type<>'electricity' OR OLD.state NOT IN ('AwaitingStaffReview','ChangesRequested')
    OR EXISTS(SELECT 1 FROM contract_publications WHERE contract_id=NEW.id)
  ) THEN
    RAISE EXCEPTION 'Only unpublished electricity contracts can be ended' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

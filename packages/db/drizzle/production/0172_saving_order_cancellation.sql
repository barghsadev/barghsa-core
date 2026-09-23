-- A saving order exists before its contract is published. Allow its owner to
-- request staff cancellation at that stage while keeping the generic contract
-- request and decision evidence.
CREATE OR REPLACE FUNCTION guard_contract_cancellation_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c contracts%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancellation requests are retained' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM contracts WHERE id=NEW.contract_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract missing' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'Pending' OR c.state IN ('Cancelled','Completed','Rejected') OR c.current_version_id<>NEW.version_id
      OR EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=c.order_id
        AND s.status IN ('completed','rejected','cancelled'))
      OR NOT (EXISTS(SELECT 1 FROM contract_publications WHERE contract_id=c.id AND version_id=NEW.version_id)
        OR (c.service_type='savings' AND c.state='AwaitingStaffReview'
          AND EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=c.order_id)))
      OR EXISTS(SELECT 1 FROM profiles WHERE id=c.profile_id AND archived)
    THEN RAISE EXCEPTION 'Request requires a current available nonterminal contract' USING ERRCODE='23514'; END IF;
    NEW.created_at:=now();
  ELSE
    IF OLD.status<>'Pending' OR NEW.status NOT IN ('Rejected','Fulfilled') OR
      (to_jsonb(NEW)-ARRAY['status','resolved_by','resolution_reason','resolved_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','resolved_by','resolution_reason','resolved_at'])
    THEN RAISE EXCEPTION 'Only a pending request can be resolved; request evidence is immutable' USING ERRCODE='23514'; END IF;
    IF NEW.status='Rejected' AND c.state IN ('Cancelled','Completed','Rejected') THEN
      RAISE EXCEPTION 'Terminal contract requests cannot be rejected' USING ERRCODE='23514';
    END IF;
    IF NEW.status='Fulfilled' AND NOT EXISTS (
      SELECT 1 FROM contract_cancellations e JOIN contract_cancellation_intents i ON i.id=e.intent_id
      WHERE e.contract_id=NEW.contract_id AND i.customer_request_id=NEW.id
        AND e.executed_by=NEW.resolved_by AND i.reason=NEW.resolution_reason
    ) THEN RAISE EXCEPTION 'Fulfillment requires the bound executed cancellation' USING ERRCODE='23514'; END IF;
    NEW.resolved_at:=now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- The generic cancellation command owns contract, invoice, and refund changes.
-- Mirror its commercial outcome so saving fulfillment and inventory stop together.
CREATE FUNCTION synchronize_saving_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.service_type='savings' AND NEW.state='Cancelled' AND OLD.state<>'Cancelled' THEN
    IF EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=NEW.order_id
      AND s.status IN ('completed','rejected')) THEN
      RAISE EXCEPTION 'Completed or rejected saving orders cannot be cancelled' USING ERRCODE='23514';
    END IF;
    UPDATE saving_orders SET status='cancelled',
      financial_status=CASE WHEN EXISTS (
        SELECT 1 FROM invoices i WHERE i.order_id=NEW.order_id AND i.paid_amount>i.refunded_amount
      ) THEN 'refund_pending' WHEN EXISTS (
        SELECT 1 FROM invoices i WHERE i.order_id=NEW.order_id AND i.paid_amount>0
      ) THEN 'refunded' ELSE 'unpaid' END,
      updated_at=clock_timestamp()
      WHERE order_id=NEW.order_id AND status NOT IN ('cancelled','rejected','completed');
    UPDATE orders SET status='CANCELLED',updated_at=clock_timestamp()
      WHERE id=NEW.order_id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER contracts_saving_cancellation AFTER UPDATE OF state ON contracts
FOR EACH ROW EXECUTE FUNCTION synchronize_saving_cancellation();

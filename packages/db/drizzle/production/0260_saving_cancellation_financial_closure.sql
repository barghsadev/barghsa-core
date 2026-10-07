-- Expand a derived status reader. The chosen cancellation return, rather than
-- the full original price, determines whether its refund work is complete.
CREATE FUNCTION refresh_saving_cancellation_financial_status(order_key uuid) RETURNS void LANGUAGE sql AS $$
  WITH facts AS (
    SELECT s.id,
      jsonb_array_length(n.refund_decision->'refunds') AS expected_returns,
      contract_has_pending_payments(c.id) OR EXISTS (
        SELECT 1 FROM invoices i JOIN refunds r ON r.invoice_id=i.id
        WHERE i.profile_id=c.profile_id
          AND (i.contract_id=c.id::text OR (i.order_id=c.order_id AND i.contract_id IS NULL))
          AND r.state NOT IN ('Completed','Rejected','Cancelled')
          AND NOT EXISTS (SELECT 1 FROM contract_refund_obligations o WHERE o.refund_id=r.id AND o.contract_id=c.id)
      ) AS unsettled,
      (SELECT count(*) FROM contract_refund_obligations o WHERE o.contract_id=c.id) AS recorded_returns,
      EXISTS (
        SELECT 1 FROM contract_refund_obligations o JOIN refunds r ON r.id=o.refund_id
        LEFT JOIN refund_transactions t ON t.refund_id=r.id
        WHERE o.contract_id=c.id AND (r.state<>'Completed' OR t.state IS DISTINCT FROM 'Completed')
      ) AS unfinished_returns,
      EXISTS (SELECT 1 FROM invoices i WHERE i.order_id=c.order_id AND i.paid_amount>0) AS has_payment
    FROM saving_orders s JOIN contracts c ON c.order_id=s.order_id AND c.profile_id=s.profile_id
      AND c.service_type='savings' AND c.state='Cancelled'
    JOIN contract_cancellations x ON x.contract_id=c.id
    JOIN contract_cancellation_intents n ON n.id=x.intent_id
    WHERE s.order_id=order_key AND s.status='cancelled'
  ), outcomes AS (
    SELECT id,CASE
      WHEN unsettled OR expected_returns<>recorded_returns OR unfinished_returns THEN 'refund_pending'
      WHEN expected_returns>0 THEN 'refunded'
      WHEN has_payment THEN 'paid'
      ELSE 'unpaid' END AS financial_status
    FROM facts
  )
  UPDATE saving_orders s SET financial_status=o.financial_status,updated_at=clock_timestamp()
    FROM outcomes o WHERE s.id=o.id AND s.financial_status IS DISTINCT FROM o.financial_status;
$$;
--> statement-breakpoint
-- Keep the existing non-cancellation invoice mapping unchanged.
CREATE OR REPLACE FUNCTION sync_saving_order_financial_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id IS NOT NULL AND NEW.type='auto' THEN
    IF EXISTS (SELECT 1 FROM saving_orders s JOIN contracts c ON c.order_id=s.order_id
      JOIN contract_cancellations x ON x.contract_id=c.id
      WHERE s.order_id=NEW.order_id AND s.status='cancelled' AND c.service_type='savings') THEN
      PERFORM refresh_saving_cancellation_financial_status(NEW.order_id);
    ELSE
      UPDATE saving_orders SET financial_status=CASE NEW.state
        WHEN 'Paid' THEN 'paid' WHEN 'PartiallyRefunded' THEN 'refund_pending'
        WHEN 'Refunded' THEN 'refunded' ELSE 'unpaid' END,updated_at=NOW()
        WHERE order_id=NEW.order_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION sync_saving_cancellation_return() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_key uuid;
BEGIN
  IF TG_TABLE_NAME IN ('contract_cancellations','contract_refund_obligations') THEN
    SELECT order_id INTO order_key FROM contracts WHERE id=NEW.contract_id;
  ELSIF TG_TABLE_NAME='refunds' THEN
    SELECT c.order_id INTO order_key FROM invoices i JOIN contracts c
      ON c.id::text=i.contract_id OR (c.order_id=i.order_id AND i.contract_id IS NULL)
      WHERE i.id=NEW.invoice_id AND c.service_type='savings';
  ELSE
    SELECT c.order_id INTO order_key FROM refunds r JOIN invoices i ON i.id=r.invoice_id
      JOIN contracts c ON c.id::text=i.contract_id OR (c.order_id=i.order_id AND i.contract_id IS NULL)
      WHERE r.id=NEW.refund_id AND c.service_type='savings';
  END IF;
  IF order_key IS NOT NULL THEN PERFORM refresh_saving_cancellation_financial_status(order_key); END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_cancellation_financial_sync AFTER INSERT ON contract_cancellations
FOR EACH ROW EXECUTE FUNCTION sync_saving_cancellation_return();
--> statement-breakpoint
CREATE TRIGGER saving_cancellation_obligation_sync AFTER INSERT ON contract_refund_obligations
FOR EACH ROW EXECUTE FUNCTION sync_saving_cancellation_return();
--> statement-breakpoint
CREATE TRIGGER saving_cancellation_refund_sync AFTER INSERT OR UPDATE OF state ON refunds
FOR EACH ROW EXECUTE FUNCTION sync_saving_cancellation_return();
--> statement-breakpoint
CREATE TRIGGER saving_cancellation_transaction_sync AFTER INSERT OR UPDATE OF state ON refund_transactions
FOR EACH ROW EXECUTE FUNCTION sync_saving_cancellation_return();
--> statement-breakpoint
-- Migrate already settled cancellation statuses without changing financial history.
DO $$ DECLARE row record; BEGIN
  FOR row IN SELECT s.order_id FROM saving_orders s JOIN contracts c ON c.order_id=s.order_id
    JOIN contract_cancellations x ON x.contract_id=c.id WHERE s.status='cancelled' AND c.service_type='savings'
  LOOP PERFORM refresh_saving_cancellation_financial_status(row.order_id); END LOOP;
END $$;

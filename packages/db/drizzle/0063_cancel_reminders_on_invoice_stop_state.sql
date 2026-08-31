-- Migration 0063: cancel future invoice reminders on stop state (T-04.1.04.06)
--
-- S-04.1.04: stop payment reminders immediately when an invoice enters
-- Paid, Cancelled, or Refunded. Remaining `scheduled` rows (unsent —
-- including already-due rows the sender has not claimed) become
-- `cancelled`. Already-`sent` rows are left unchanged.
--
-- Guarantees:
--   - `cancel_future_invoice_reminders(invoice_id)` is the single UPDATE
--     used by the trigger and by application catch-up;
--   - AFTER UPDATE OF state on invoices fires only when state actually
--     changes into a stop state;
--   - a one-shot backfill cancels leftover `scheduled` rows for invoices
--     that already sit in a stop state (pre-trigger data).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_cancel_invoice_reminders_on_stop_state ON invoices;
--   DROP FUNCTION IF EXISTS trg_fn_cancel_invoice_reminders_on_stop_state();
--   DROP FUNCTION IF EXISTS cancel_future_invoice_reminders(UUID);

CREATE OR REPLACE FUNCTION cancel_future_invoice_reminders(p_invoice_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  cancelled_count INTEGER;
BEGIN
  UPDATE invoice_reminder_schedule
     SET status = 'cancelled'
   WHERE invoice_id = p_invoice_id
     AND status = 'scheduled';
  GET DIAGNOSTICS cancelled_count = ROW_COUNT;
  RETURN cancelled_count;
END;
$$;

CREATE OR REPLACE FUNCTION trg_fn_cancel_invoice_reminders_on_stop_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM cancel_future_invoice_reminders(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_invoice_reminders_on_stop_state ON invoices;

CREATE TRIGGER trg_cancel_invoice_reminders_on_stop_state
  AFTER UPDATE OF state ON invoices
  FOR EACH ROW
  WHEN (
    NEW.state = ANY (ARRAY['Paid', 'Cancelled', 'Refunded']::invoice_state[])
    AND OLD.state IS DISTINCT FROM NEW.state
  )
  EXECUTE FUNCTION trg_fn_cancel_invoice_reminders_on_stop_state();

-- Catch-up for invoices that already reached a stop state before this
-- trigger existed. Idempotent: only `scheduled` rows are rewritten.
UPDATE invoice_reminder_schedule AS s
   SET status = 'cancelled'
  FROM invoices AS i
 WHERE s.invoice_id = i.id
   AND s.status = 'scheduled'
   AND i.state = ANY (ARRAY['Paid', 'Cancelled', 'Refunded']::invoice_state[]);

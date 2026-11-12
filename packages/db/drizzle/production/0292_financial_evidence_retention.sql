-- Preserve existing financial history and retry identities. Current business
-- writers still insert rows, advance states, and issue compensating entries.
CREATE FUNCTION reject_retained_financial_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financial evidence retention forbids % on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE='55000';
END $$;
--> statement-breakpoint
-- Run after existing refund and invoice guards so their specific errors survive.
CREATE TRIGGER zzz_financial_evidence_delete BEFORE DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER zzz_financial_evidence_delete BEFORE DELETE ON invoices
  FOR EACH ROW
  WHEN (OLD.state <> 'Draft' OR OLD.issued_at IS NOT NULL OR OLD.paid_amount <> 0 OR OLD.refunded_amount <> 0)
  EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER zzz_financial_evidence_delete BEFORE DELETE ON bank_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER zzz_financial_evidence_mutation BEFORE UPDATE OR DELETE ON bank_receipt_status_events
  FOR EACH ROW EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER zzz_financial_evidence_delete BEFORE DELETE ON wallet_topup_callback_events
  FOR EACH ROW EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER zzz_financial_evidence_delete BEFORE DELETE ON wallet_chargeback_events
  FOR EACH ROW EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER financial_evidence_truncate BEFORE TRUNCATE ON wallet_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER financial_evidence_truncate BEFORE TRUNCATE ON invoices
  FOR EACH STATEMENT EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER financial_evidence_truncate BEFORE TRUNCATE ON bank_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER financial_evidence_truncate BEFORE TRUNCATE ON bank_receipt_status_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER financial_evidence_truncate BEFORE TRUNCATE ON wallet_topup_callback_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER financial_evidence_truncate BEFORE TRUNCATE ON wallet_chargeback_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER financial_evidence_truncate BEFORE TRUNCATE ON refunds
  FOR EACH STATEMENT EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER financial_evidence_truncate BEFORE TRUNCATE ON refund_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_retained_financial_evidence_mutation();
CREATE TRIGGER financial_evidence_truncate BEFORE TRUNCATE ON refund_retry_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION reject_retained_financial_evidence_mutation();

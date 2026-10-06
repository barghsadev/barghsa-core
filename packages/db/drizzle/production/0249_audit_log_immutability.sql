-- Expand-only protection for existing audit rows and all current writers.
-- Application rollback retains this protection; no historical row is rewritten.
CREATE FUNCTION reject_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE='55000';
END $$;
--> statement-breakpoint
-- Run after the existing context guard so its 23514 contract is preserved.
CREATE TRIGGER zzz_audit_log_immutable_row BEFORE UPDATE OR DELETE ON audit_log
 FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_immutable_truncate BEFORE TRUNCATE ON audit_log
 FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_mutation();

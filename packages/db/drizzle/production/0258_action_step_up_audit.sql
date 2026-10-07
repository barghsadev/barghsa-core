-- Expand-only audit provenance. No historical row is rewritten. Older callers
-- without transaction-local proof retain their existing metadata on rollback.
CREATE FUNCTION capture_audit_step_up_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor text:=nullif(current_setting('barghsa.step_up_actor',true),'');
 verified text:=nullif(current_setting('barghsa.step_up_verified_at',true),'');
 expires text:=nullif(current_setting('barghsa.step_up_expires_at',true),'');
BEGIN
 IF actor=NEW.user_id AND actor=nullif(current_setting('barghsa.actor_user_id',true),'')
  AND nullif(current_setting('barghsa.step_up_session_id',true),'')=nullif(current_setting('barghsa.actor_session_id',true),'')
  AND verified IS NOT NULL AND expires IS NOT NULL
  AND verified::timestamptz<=clock_timestamp() AND expires::timestamptz>clock_timestamp() THEN
  IF NEW.metadata IS NOT NULL AND jsonb_typeof(NEW.metadata::jsonb)<>'object'
  THEN RAISE EXCEPTION 'Step-up action audit requires object metadata' USING ERRCODE='23514'; END IF;
  NEW.metadata:=(COALESCE(NEW.metadata::jsonb,'{}'::jsonb)||jsonb_build_object(
    'stepUpVerified',true,'stepUpVerifiedAt',verified))::text;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_capture_step_up BEFORE INSERT ON audit_log
 FOR EACH ROW EXECUTE FUNCTION capture_audit_step_up_proof();

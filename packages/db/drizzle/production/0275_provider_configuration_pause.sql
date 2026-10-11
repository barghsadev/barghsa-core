-- A configuration pause is resolved by a tested replacement version. Fence older
-- application code from clearing it or claiming an automatic recovery probe.
CREATE FUNCTION guard_provider_configuration_pause() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.degraded_reason = 'provider_configuration_pause' AND
     (NOT NEW.degraded OR NEW.degraded_reason IS DISTINCT FROM OLD.degraded_reason OR
      NEW.cooldown_until IS NOT NULL) THEN
    RAISE EXCEPTION 'Provider configuration pause requires a replacement version';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_provider_configuration_pause_guard
  BEFORE UPDATE ON email_provider_configs FOR EACH ROW
  EXECUTE FUNCTION guard_provider_configuration_pause();
--> statement-breakpoint
CREATE TRIGGER sms_provider_configuration_pause_guard
  BEFORE UPDATE ON sms_provider_configs FOR EACH ROW
  EXECUTE FUNCTION guard_provider_configuration_pause();

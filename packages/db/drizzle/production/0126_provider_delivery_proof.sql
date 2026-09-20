ALTER TABLE "email_provider_configs" ADD COLUMN "delivery_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_provider_configs" ADD COLUMN "delivery_config_hash" text;
--> statement-breakpoint
-- SMS provider configs remain SQL-managed (0081), outside the Drizzle snapshot.
ALTER TABLE sms_provider_configs ADD COLUMN delivery_verified_at timestamptz,
  ADD COLUMN delivery_config_hash text;
--> statement-breakpoint
CREATE FUNCTION require_provider_delivery_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Preserve already-active legacy providers during an additive rollout. A new
  -- activation or a change to active credentials/configuration needs fresh proof.
  IF NEW.status = 'active' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'active' AND NEW.config IS NOT DISTINCT FROM OLD.config
         AND NEW.transport IS NOT DISTINCT FROM OLD.transport THEN
        RETURN NEW;
      END IF;
    END IF;
    IF NOT COALESCE(
      NEW.last_test_status = 'passed'
      AND NEW.delivery_verified_at = NEW.last_test_at
      AND NEW.delivery_config_hash = encode(sha256(convert_to(jsonb_build_array(NEW.transport, NEW.config)::text, 'UTF8')), 'hex'),
      false
    ) THEN
      RAISE EXCEPTION 'Provider activation requires verified delivery for the current configuration'
        USING ERRCODE = '23514', CONSTRAINT = 'provider_delivery_proof_required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_provider_delivery_proof BEFORE INSERT OR UPDATE ON email_provider_configs
  FOR EACH ROW EXECUTE FUNCTION require_provider_delivery_proof();
--> statement-breakpoint
CREATE TRIGGER sms_provider_delivery_proof BEFORE INSERT OR UPDATE ON sms_provider_configs
  FOR EACH ROW EXECUTE FUNCTION require_provider_delivery_proof();

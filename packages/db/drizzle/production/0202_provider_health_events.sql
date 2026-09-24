CREATE TABLE provider_health_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  provider_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('circuit_open','circuit_recovered')),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX idx_phe_provider_created ON provider_health_events (channel, provider_id, created_at);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_provider_health_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO provider_health_events(channel,provider_id,kind)
  VALUES (TG_ARGV[0],NEW.id,CASE WHEN NEW.degraded THEN 'circuit_open' ELSE 'circuit_recovered' END);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_provider_health_transition
  AFTER UPDATE OF degraded ON email_provider_configs
  FOR EACH ROW WHEN (OLD.degraded IS DISTINCT FROM NEW.degraded)
  EXECUTE FUNCTION record_provider_health_transition('email');
--> statement-breakpoint
CREATE TRIGGER sms_provider_health_transition
  AFTER UPDATE OF degraded ON sms_provider_configs
  FOR EACH ROW WHEN (OLD.degraded IS DISTINCT FROM NEW.degraded)
  EXECUTE FUNCTION record_provider_health_transition('sms');

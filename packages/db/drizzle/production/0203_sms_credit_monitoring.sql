ALTER TABLE sms_provider_configs
  ADD COLUMN low_credit_balance numeric(20, 2),
  ADD COLUMN credit_checked_at timestamptz,
  ADD COLUMN credit_next_check_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN credit_check_lease_until timestamptz,
  ADD COLUMN credit_check_lease_token uuid,
  ADD COLUMN low_credit_alert_active boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT chk_sms_credit_balance CHECK (low_credit_balance IS NULL OR low_credit_balance >= 0);
--> statement-breakpoint
ALTER TABLE provider_health_events DROP CONSTRAINT provider_health_events_kind_check;
--> statement-breakpoint
ALTER TABLE provider_health_events RENAME CONSTRAINT provider_health_events_channel_check TO chk_phe_channel;
--> statement-breakpoint
ALTER TABLE provider_health_events ADD CONSTRAINT chk_phe_kind
  CHECK (kind IN ('circuit_open','circuit_recovered','low_credit','credit_recovered'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_sms_credit_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO provider_health_events(channel,provider_id,kind)
  VALUES ('sms',NEW.id,CASE WHEN NEW.low_credit_alert_active THEN 'low_credit' ELSE 'credit_recovered' END);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sms_provider_credit_transition
  AFTER UPDATE OF low_credit_alert_active ON sms_provider_configs
  FOR EACH ROW WHEN (OLD.low_credit_alert_active IS DISTINCT FROM NEW.low_credit_alert_active)
  EXECUTE FUNCTION record_sms_credit_transition();

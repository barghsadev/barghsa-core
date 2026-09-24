-- Additive, durable SMS provider health state. Lifecycle status remains admin-owned.
ALTER TABLE sms_provider_configs
  ADD COLUMN degraded boolean NOT NULL DEFAULT false,
  ADD COLUMN degraded_reason text,
  ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN window_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN recent_failure_times timestamptz[] NOT NULL DEFAULT '{}'::timestamptz[],
  ADD COLUMN window_started_at timestamptz,
  ADD COLUMN last_failure_at timestamptz,
  ADD COLUMN opened_at timestamptz,
  ADD COLUMN cooldown_until timestamptz;

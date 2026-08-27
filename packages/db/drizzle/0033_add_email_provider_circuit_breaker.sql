-- Migration 0033: Email provider circuit breaker state (T-05.06.06)
--
-- Adds the durable health/failure-tracking columns behind the per-provider
-- email circuit breaker. The breaker tracks consecutive transient failures
-- per provider (threshold 5 within a rolling 5-minute window). When tripped
-- the provider is marked `degraded`, the send path refuses new sends through
-- it, and an ops alert is raised. After a configurable cooldown (60s) the
-- breaker opens a HALF_OPEN probe window: one test-send is allowed; success
-- resets the breaker to healthy, failure keeps it open.
--
-- Design notes:
--   - State is persisted (not in-memory) so a worker/API restart preserves a
--     tripped breaker and multiple worker replicas agree on the same degraded
--     status. Consecutive failure windows are derived from the stored
--     last_failure_at timestamps rather than an O(n) history table.
--   - `degraded` is deliberately a SEPARATE column from `status`. The lifecycle
--     status (draft/active/superseded/disabled) is admin-controlled; health is
--     runtime-controlled. A provider can be `active` + `degraded`.
--   - Columns are additive and nullable-safe for a rolling `ALTER TABLE`.
--
-- Row layout added:
--   degraded              BOOLEAN  NOT NULL DEFAULT FALSE   (health flag)
--   degraded_reason       TEXT     last cause that tripped the breaker
--   consecutive_failures  INTEGER  current consecutive-failure run (0..n)
--   window_failures       INTEGER  failures inside the current 5-min window
--   first_failure_at      TIMESTAMPTZ   start of the current failure window
--   last_failure_at       TIMESTAMPTZ   most recent failure (drives cooldown)
--   opened_at             TIMESTAMPTZ   when the breaker tripped (degraded)
--   cooldown_until        TIMESTAMPTZ   when HALF_OPEN probe may run
--
-- Rollback:
--   ALTER TABLE email_provider_configs
--     DROP COLUMN IF EXISTS degraded,
--     DROP COLUMN IF EXISTS degraded_reason,
--     DROP COLUMN IF EXISTS consecutive_failures,
--     DROP COLUMN IF EXISTS window_failures,
--     DROP COLUMN IF EXISTS window_started_at,
--     DROP COLUMN IF EXISTS last_failure_at,
--     DROP COLUMN IF EXISTS opened_at,
--     DROP COLUMN IF EXISTS cooldown_until;

ALTER TABLE email_provider_configs
  ADD COLUMN IF NOT EXISTS degraded             BOOLEAN NOT NULL DEFAULT 'false',
  ADD COLUMN IF NOT EXISTS degraded_reason      TEXT,
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_failures      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_started_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_failure_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cooldown_until       TIMESTAMPTZ;
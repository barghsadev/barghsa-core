-- Migration 0041: Background job failure ledger (T-09.09.02)
--
-- The admin "Failed jobs dashboard" of S-09.09 lets an admin/staff user view
-- background jobs that failed, retry them, and resolve them. The *worker*
-- (apps/worker) writes one row per retryable failure of a recurring task (a
-- named scan/loop execution); this migration lays down the durable ledger the
-- admin review surface reads and the worker produces.
--
-- Row layout:
--   id             UUID PK (uuidv7, DB-generated via uuid_generate_v7())
--   job_type       stable worker task key, e.g. 'service_breach_scan',
--                  'service_escalation_scan', 'notification_outbox_poll' —
--                  must stay in sync with BACKGROUND_JOB_TYPES in
--                  packages/shared/src/admin/background-jobs.ts
--   status         'failed' | 'retrying' | 'dead_letter' | 'resolved'
--                  (default 'failed')
--   error          sanitized last error message (never raw secrets)
--   error_category 'transient' | 'permanent' | 'provider' (default 'transient');
--                  a permanent error is not auto-retried to avoid hot loops
--   attempts       how many times this failure has been observed
--   max_attempts   retry budget before the job is dead-lettered
--   payload        JSONB masked job context (audit copy for triage)
--   first_failed_at first time this failure was recorded
--   last_run_at    most recent attempt time
--   next_run_at    back-off time after which a 'retrying' job may be re-run
--   resolved_by    admin user id who resolved the job (audit)
--   resolved_at    when the job was resolved
--   created_at / updated_at  base columns (createTable contract)
--
-- Semantics (enforced by the service layer, T-09.09.02):
--   - the worker upserts a *current* failure row per job_type: an active
--     'failed'/'retrying' row is incremented, otherwise a new row is created;
--   - 'retrying'      admin requested a retry (attempts reset by the worker
--                     on the next successful re-run, or the row resolves);
--   - 'dead_letter'   attempts reached max_attempts; quarantined for triage;
--   - 'resolved'      terminal; the worker cleared it on success or an admin
--                     resolved it manually.
--
-- All constraints are declared inline in CREATE TABLE so the migration is
-- safely re-appliable. The composite index doubles as the admin list view's
-- default ordering path (status first, newest failure first).
--
-- Rollback:
--   DROP TABLE IF EXISTS background_jobs;

CREATE TABLE IF NOT EXISTS background_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  job_type        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'failed',
  error           TEXT,
  error_category  TEXT NOT NULL DEFAULT 'transient',
  attempts        INTEGER NOT NULL DEFAULT 1,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_run_at     TIMESTAMPTZ,
  resolved_by_id  TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_bj_status
    CHECK (status IN ('failed', 'retrying', 'dead_letter', 'resolved')),
  CONSTRAINT chk_bj_error_category
    CHECK (error_category IN ('transient', 'permanent', 'provider')),
  CONSTRAINT chk_bj_attempts_ge_1
    CHECK (attempts >= 1),
  CONSTRAINT chk_bj_max_attempts_ge_1
    CHECK (max_attempts >= 1),

  CONSTRAINT fk_bj_resolved_by
    FOREIGN KEY (resolved_by_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Admin dashboard default query (active failures newest-first).
CREATE INDEX IF NOT EXISTS idx_background_jobs_status_first_failed_at
  ON background_jobs (status, first_failed_at DESC);

-- Lookup the current active failure row for a job type (worker upsert path).
CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_active_per_type
  ON background_jobs (job_type)
  WHERE status IN ('failed', 'retrying', 'dead_letter');

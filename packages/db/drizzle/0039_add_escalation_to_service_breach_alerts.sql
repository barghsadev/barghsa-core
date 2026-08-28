-- Migration 0039: Escalation state on the service breach ledger (T-09.08.03)
--
-- The T-09.08.01 breach scanner records an episode per (service_type, item_id)
-- in service_breach_alerts and alerts the *assigned* staff — the level-1
-- tier of the escalation model. T-09.08.03 adds the two deeper tiers (team
-- lead, admin) that the escalation worker drives. Those tiers must remember,
-- per episode, how far up the ladder escalation has already climbed and when,
-- so the worker can:
--   - escalate level 1 → 2 (assigned → team lead) once
--     alerted_at + level2.delayHours has elapsed;
--   - then escalate level 2 → 3 (team lead → admin) once
--     escalated_at + level3.delayHours has elapsed;
--   - never re-emit an escalation it already emitted (at-most-once per tier).
--
-- These are ADDITIVE columns (expand step): existing rows get
-- escalation_level = 1 (admin escalation disabled on backfill, since only
-- the page-holder breach was seen) and escalated_at = NULL (meaning "treat
-- alerted_at as the tier-1 baseline" until a level-2 escalation fires).
--
-- Row layout additions:
--   escalation_level  highest escalation tier actually alerted for this
--                     episode: 1 = assigned (the breach alert, default),
--                     2 = team lead alerted, 3 = admin alerted. 3 is the
--                     terminal tier (no further escalation).
--   escalated_at      when the current tier ('escalation_level') was
--                     emitted; NULL until the first (level-2) escalation,
--                     at which point it becomes the delay baseline for the
--                     next tier.
--
-- Constraints are declared with IF NOT EXISTS / a distinct name so the
-- migration is safely re-appliable (no duplicate-constraint aborts).
--
-- Rollback:
--   ALTER TABLE service_breach_alerts DROP COLUMN IF EXISTS escalated_at;
--   ALTER TABLE service_breach_alerts DROP COLUMN IF EXISTS escalation_level;

ALTER TABLE service_breach_alerts
  ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 1;

ALTER TABLE service_breach_alerts
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

-- Escalation tiers are 1 (assigned) .. 3 (admin); anything else is corrupt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_sba_escalation_level' AND conrelid = 'service_breach_alerts'::regclass
  ) THEN
    ALTER TABLE service_breach_alerts
      ADD CONSTRAINT chk_sba_escalation_level
      CHECK (escalation_level BETWEEN 1 AND 3);
  END IF;
END $$;
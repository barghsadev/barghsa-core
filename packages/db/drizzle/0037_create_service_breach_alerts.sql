-- Migration 0037: Service breach alert ledger (T-09.08.01)
--
-- The worker breach scan (apps/worker service-targets/breach-scanner) checks
-- open service items — tickets and verification cases — against the
-- admin-configured response targets (T-09.08.01, app_config key
-- admin.service_response_targets). When an open item exceeds its target the
-- scan records it here and enqueues an in-app staff alert.
--
-- This table is the dedup ledger that guarantees at-most-once alerting per
-- breach episode:
--   - UNIQUE (service_type, item_id): the scan inserts with
--     ON CONFLICT DO NOTHING and only alerts for rows it actually inserted,
--     so the same item is never re-alerted on every scan.
--   - Pruning: when an item leaves the breached set (resolved, closed, or
--     the target is raised past its age) the scan deletes its row, so a
--     later re-breach starts a fresh episode and alerts again.
--
-- Row layout:
--   id            UUID PK (uuidv7, DB-generated to keep the worker simple)
--   service_type  'ticket' | 'verification_case' — must stay in sync with
--                 SERVICE_RESPONSE_TARGET_TYPES in @barghsa/shared/admin
--   item_id       the open item's id (tickets.id / verification_cases.id)
--   target_hours  snapshot of the target that was breached (for the audit
--                 trail when the target is later changed)
--   alerted_at    when the alert for this episode was recorded
--
-- Notes:
--   - All constraints are defined inline in CREATE TABLE so the migration
--     is safely re-appliable (no separate ALTER TABLE steps that would
--     abort with duplicate-constraint errors on a re-run).
--   - The UNIQUE constraint doubles as the lookup index for the scan's
--     ON CONFLICT (service_type, item_id) DO NOTHING insert.
--
-- Rollback:
--   DROP TABLE IF EXISTS service_breach_alerts;

CREATE TABLE IF NOT EXISTS service_breach_alerts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_type TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  target_hours INTEGER NOT NULL,
  alerted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Service types with open items today (mirror SERVICE_RESPONSE_TARGET_TYPES
  -- in packages/shared/src/admin/service-response-targets.ts).
  CONSTRAINT chk_sba_service_type
    CHECK (service_type IN ('ticket', 'verification_case')),

  -- Targets are always positive hours; a 0/negative value is corrupt.
  CONSTRAINT chk_sba_target_hours
    CHECK (target_hours > 0),

  -- One alert per breach episode per item.
  CONSTRAINT uq_sba_item
    UNIQUE (service_type, item_id)
);

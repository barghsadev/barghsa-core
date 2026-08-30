-- Migration 0059: service_due_periods admin config (T-04.1.03.01)
--
-- Versioned default invoice due periods administered per service type
-- (S-04.1.03). `dueAt` is later computed as issuedAt + default_days
-- (T-04.1.03.02); this migration only adds the config table.
--
-- service_due_periods (one row = one versioned period):
--   id               UUIDv7 PK
--   service_type     TEXT — canonical key:
--                      electricity | saving_plan | consultation | manual
--   default_days     INTEGER — days after issuedAt, CHECK 1..365
--   effective_from   TIMESTAMPTZ — window start (inclusive)
--   effective_until  TIMESTAMPTZ — window end (exclusive), null = open
--   created_by       TEXT FK users.user_id ON DELETE RESTRICT
--   created_at / updated_at (base columns)
--
-- Guarantees:
--   - service_type is one of the four canonical keys;
--   - default_days within 1..365;
--   - effective_until null or strictly after effective_from;
--   - GIST EXCLUDE: no overlapping windows per service_type (at most
--     one open row per type);
--   - updated_at maintained by trigger.
--
-- Rollback:
--   DROP TABLE IF EXISTS service_due_periods CASCADE;
--   DROP FUNCTION IF EXISTS update_service_due_periods_updated_at();

-- btree_gist may already exist (migration 0047 / test bootstrap).
-- Skip CREATE when present so parallel migrate() ticks do not race
-- on pg_extension; still handle the leftover unique_violation race.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    CREATE EXTENSION btree_gist;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN unique_violation THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS service_due_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_type TEXT NOT NULL
    CONSTRAINT chk_service_due_periods_service_type
      CHECK (service_type IN ('electricity', 'saving_plan', 'consultation', 'manual')),
  default_days INTEGER NOT NULL
    CONSTRAINT chk_service_due_periods_default_days
      CHECK (default_days BETWEEN 1 AND 365),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ
    CONSTRAINT chk_service_due_periods_effective_range
      CHECK (effective_until IS NULL OR effective_from < effective_until),
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT excl_service_due_periods_no_overlap
    EXCLUDE USING GIST (
      service_type WITH =,
      tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS idx_service_due_periods_service_type
  ON service_due_periods (service_type);
CREATE INDEX IF NOT EXISTS idx_service_due_periods_effective_from
  ON service_due_periods (effective_from);
CREATE INDEX IF NOT EXISTS idx_service_due_periods_effective_until
  ON service_due_periods (effective_until);

CREATE OR REPLACE FUNCTION update_service_due_periods_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_due_periods_updated_at ON service_due_periods;

CREATE TRIGGER trg_service_due_periods_updated_at
  BEFORE UPDATE ON service_due_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_service_due_periods_updated_at();

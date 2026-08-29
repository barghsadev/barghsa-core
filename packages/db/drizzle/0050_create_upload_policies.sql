-- Migration 0050: Upload policies (T-09.12.05)
--
-- Admin-managed file upload policies: per category, the allowed file
-- formats (extension whitelist) and the maximum file size. Categories
-- are the canonical admin set (documents, images, videos); policies are
-- versioned with effective windows, mirroring VAT configuration.
--
-- upload_policies:
--   id                 UUIDv7 PK
--   category           TEXT — canonical admin category key
--                      ('document' | 'image' | 'video'; canonical set in
--                      @barghsa/shared/admin UPLOAD_POLICY_CATEGORIES)
--   allowed_extensions TEXT[] — lowercase '.ext' whitelist (1..50
--                      entries, each matching ^\.[a-z0-9]{1,10}$).
--                      The admin API further bounds the whitelist to the
--                      deployment-level extension set (see
--                      apps/api/src/upload/upload.config.ts) so a policy
--                      can never permit a format the deployment does not
--                      trust.
--   max_size_bytes     BIGINT — maximum file size in bytes, CHECK within
--                      [1, 100 MB]. The admin API bounds it to the
--                      deployment-level per-category cap (the effective
--                      limit at upload time is min(DB, deployment)).
--   effective_from     TIMESTAMPTZ — window start (inclusive)
--   effective_until    TIMESTAMPTZ — window end (exclusive), null = open
--   created_by         TEXT FK users.user_id ON DELETE RESTRICT
--   created_at / updated_at (base columns)
--
-- Guarantees:
--   - category restricted to the canonical admin set;
--   - extension whitelist non-empty, ≤ 50 entries, each a lowercase
--     '.ext' token — never a path, wildcard, or empty string;
--   - max size within deployment-safe bounds (1 B .. 100 MB hard cap;
--     per-category deployment caps are enforced by the admin service);
--   - effective_until null or strictly after effective_from;
--   - GIST EXCLUDE: no overlapping windows per category — at most one
--     open policy per category at any time;
--   - updated_at maintained by trigger.
--
-- Deployment-level limits (the "hard floor") live in the application
-- config (apps/api/src/upload/upload.config.ts), NOT in the database:
-- the upload path enforces min(DB policy, deployment config), so a
-- misconfigured or absent DB policy can never widen what the
-- deployment allows.
--
-- Idempotency: fully re-runnable (CREATE TABLE IF NOT EXISTS with inline
-- CHECKs, CREATE EXTENSION IF NOT EXISTS, DROP TRIGGER IF EXISTS),
-- mirroring migration 0049.
--
-- Rollback:
--   DROP TABLE IF EXISTS upload_policies CASCADE;

-- ---------------------------------------------------------------------------
-- upload_policies
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS upload_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  category TEXT NOT NULL
    CONSTRAINT chk_upload_policies_category CHECK (category IN ('document', 'image', 'video')),
  allowed_extensions TEXT[] NOT NULL
    CONSTRAINT chk_upload_policies_extensions
      CHECK (
        array_length(allowed_extensions, 1) BETWEEN 1 AND 50
        AND NOT EXISTS (
          SELECT 1 FROM unnest(allowed_extensions) AS e
          WHERE e !~ '^\.[a-z0-9]{1,10}$'
        )
      ),
  max_size_bytes BIGINT NOT NULL
    CONSTRAINT chk_upload_policies_max_size CHECK (max_size_bytes BETWEEN 1 AND 104857600),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ
    CONSTRAINT chk_upload_policies_effective_range
      CHECK (effective_until IS NULL OR effective_from < effective_until),
  created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT excl_upload_policies_no_overlap
    EXCLUDE USING GIST (
      category WITH =,
      tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS idx_upload_policies_category
  ON upload_policies (category);
CREATE INDEX IF NOT EXISTS idx_upload_policies_effective_from
  ON upload_policies (effective_from);
CREATE INDEX IF NOT EXISTS idx_upload_policies_effective_until
  ON upload_policies (effective_until);

-- ---------------------------------------------------------------------------
-- updated_at trigger (idempotent — DROP IF EXISTS first)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_upload_policies_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_upload_policies_updated_at ON upload_policies;

CREATE TRIGGER trg_upload_policies_updated_at
  BEFORE UPDATE ON upload_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_upload_policies_updated_at();
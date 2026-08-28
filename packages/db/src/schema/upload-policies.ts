import { sql } from 'drizzle-orm'
import { bigint, text } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table'
import { timestamptz } from '../types'
import { users } from './users'

/**
 * Upload policies (T-09.12.05) — admin-managed file upload policies.
 *
 * One row is ONE versioned policy: `allowed_extensions` whitelists the
 * acceptable file formats (lowercase `.ext` tokens) and `max_size_bytes`
 * caps the file size, both per category (`document` | `image` | `video`).
 * Each row carries an effective window (`effective_from` inclusive,
 * `effective_until` exclusive; null = open). Adding a new policy for a
 * category appends a row and the admin service closes the previously-open
 * one at the new effective_from; policies are never mutated or
 * hard-deleted — they are end-dated instead, preserving full history.
 *
 * Deployment-safe boundaries: the admin API bounds every write to the
 * deployment-level limits in `apps/api/src/upload/upload.config.ts`
 * (extension superset + per-category size cap), and the upload path
 * enforces min(DB policy, deployment config). This table therefore only
 * ever *narrows* what the deployment allows, never widens it.
 *
 * The migration (0050) also declares:
 *   - category CHECK (canonical admin set);
 *   - extension whitelist CHECK (1..50 entries, each ^\.[a-z0-9]{1,10}$);
 *   - max_size_bytes CHECK (1 B .. 100 MB hard cap);
 *   - a CHECK that `effective_until` is null or after `effective_from`;
 *   - a GIST EXCLUDE constraint forbidding overlapping effective windows
 *     for the same category (at most one open policy per category);
 *   - the `updated_at` trigger.
 */
export const uploadPolicies = createTable('upload_policies', {
  /** Canonical admin category key ('document' | 'image' | 'video'). */
  category: text('category').notNull(),

  /** Lowercase '.ext' whitelist (1..50 entries) — CHECK in migration 0050. */
  allowedExtensions: text('allowed_extensions').array().notNull(),

  /** Maximum file size in bytes (1 B .. 100 MB) — CHECK in migration 0050. */
  maxSizeBytes: bigint('max_size_bytes', { mode: 'number' }).notNull(),

  /** Window start (inclusive). */
  effectiveFrom: timestamptz('effective_from').notNull(),

  /** Window end (exclusive); null = open/current. */
  effectiveUntil: timestamptz('effective_until'),

  /** Admin who recorded this policy. */
  createdBy: text('created_by')
    .notNull()
    .references(() => users.userId, { onDelete: 'restrict' }),
})

/** SQL to create the upload_policies table (migration 0050 source). */
export const createUploadPoliciesTable = sql`
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
            WHERE e !~ '^\\.[a-z0-9]{1,10}$'
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
`
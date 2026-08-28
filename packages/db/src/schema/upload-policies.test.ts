import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { uploadPolicies } from './upload-policies.js'

/**
 * Drift guard for the upload_policies table (T-09.12.05).
 *
 * The category CHECK, the extension-whitelist CHECK, the max-size CHECK,
 * the effective-window CHECK, the GIST EXCLUDE no-overlap constraint and
 * the `updated_at` trigger all live in the hand-written migration 0050
 * (Drizzle v0.40's column builder has no `.check()`/`.exclude()`). This
 * test asserts the migration still declares them and that the drizzle
 * schema matches the service layer's expectations: the admin API and the
 * upload enforcement path rely on at most one open policy per category
 * and on the canonical extension/size bounds.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0050_create_upload_policies.sql'),
  'utf8',
)

describe('Upload policy schema (T-09.12.05)', () => {
  it('upload_policies declares the domain columns expected by the service layer', () => {
    const columns = Object.keys(uploadPolicies)
    for (const column of [
      'category',
      'allowedExtensions',
      'maxSizeBytes',
      'effectiveFrom',
      'effectiveUntil',
      'createdBy',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('migration 0050 still declares the constraints the service relies on', () => {
    // Canonical admin category set (documents, images, videos).
    expect(MIGRATION).toContain("CHECK (category IN ('document', 'image', 'video'))")
    // Extension whitelist: 1..50 lowercase .ext tokens.
    expect(MIGRATION).toContain('array_length(allowed_extensions, 1) BETWEEN 1 AND 50')
    expect(MIGRATION).toContain("e !~ '^\\.[a-z0-9]{1,10}$'")
    // Max size within deployment-safe bounds (1 B .. 100 MB).
    expect(MIGRATION).toContain('max_size_bytes BETWEEN 1 AND 104857600')
    // Effective window sanity + no-overlap per category (at most one open policy).
    expect(MIGRATION).toContain('effective_until IS NULL OR effective_from < effective_until')
    expect(MIGRATION).toContain('EXCLUDE USING GIST')
    expect(MIGRATION).toContain('tstzrange(effective_from, COALESCE(effective_until')
    expect(MIGRATION).toContain('ON DELETE RESTRICT')
    expect(MIGRATION).toContain('trg_upload_policies_updated_at')
  })

  it('migration 0050 is idempotent (matching sibling migrations)', () => {
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS upload_policies')
    expect(MIGRATION).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist')
    expect(MIGRATION).toContain('DROP TRIGGER IF EXISTS trg_upload_policies_updated_at')
  })
})
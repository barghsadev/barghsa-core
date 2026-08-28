import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  contractTemplates,
  contractTemplateVersions,
  contractTypeTemplates,
} from './contract-templates.js'

/**
 * Drift guard for the contract template tables (T-09.12.04).
 *
 * The status/name CHECKs, the case-insensitive UNIQUE name index, the
 * UNIQUE storage_key / (template_id, version_number) indexes and the
 * `updated_at` trigger live in the hand-written migration 0049 (Drizzle
 * v0.40's column builder has no `.check()` and the no-delete seam must
 * stay declarative). This test asserts the migration still declares
 * them and that the drizzle schema matches the service layer's
 * expectations. If a future `drizzle-kit generate` ever rewrites the
 * migration and drops a constraint, this test fails instead of silently
 * loosening the template/contract-type deletion posture.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0049_create_contract_templates.sql'),
  'utf8',
)

describe('Contract template schema (T-09.12.04)', () => {
  it('contract_templates declares the domain columns expected by the service layer', () => {
    const columns = Object.keys(contractTemplates)
    for (const column of ['name', 'description', 'status', 'createdBy']) {
      expect(columns).toContain(column)
    }
  })

  it('contract_template_versions declares version + storage + placeholder columns', () => {
    const columns = Object.keys(contractTemplateVersions)
    for (const column of [
      'templateId',
      'versionNumber',
      'storageKey',
      'fileName',
      'contentType',
      'fileSize',
      'placeholders',
      'createdBy',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('contract_type_templates declares the no-delete seam (template_id RESTRICT)', () => {
    const columns = Object.keys(contractTypeTemplates)
    expect(columns).toContain('contractTypeId')
    expect(columns).toContain('templateId')

    // Drizzle metadata: the FK must exist on template_id.
    const config = getTableConfig(contractTypeTemplates)
    const fks = config.foreignKeys
    expect(fks.some((fk) => fk.reference().foreignTable === contractTemplates)).toBe(true)
    const templateFk = fks.find((fk) => fk.reference().foreignTable === contractTemplates)
    expect(templateFk!.onDelete).toBe('restrict')
  })

  it('migration 0049 still declares the constraints the service relies on', () => {
    expect(MIGRATION).toContain('chk_contract_templates_status')
    expect(MIGRATION).toContain("CHECK (status IN ('active', 'inactive'))")
    expect(MIGRATION).toContain('uq_contract_templates_name_lower')
    expect(MIGRATION).toContain('uq_contract_template_versions_storage_key')
    expect(MIGRATION).toContain('uq_contract_template_versions_template_ver')
    expect(MIGRATION).toContain('ON DELETE RESTRICT')
    expect(MIGRATION).toContain('trg_contract_templates_updated_at')
    // No hard-delete of versioned templates: versions FK RESTRICT.
    expect(MIGRATION).toContain('REFERENCES contract_templates(id) ON DELETE RESTRICT')
    // The seam table must exist WITHOUT a FK to contract_types (not built yet).
    expect(MIGRATION).toContain('CREATE TABLE IF NOT EXISTS contract_type_templates')
    expect(MIGRATION).toContain('PRIMARY KEY (contract_type_id, template_id)')
  })
})

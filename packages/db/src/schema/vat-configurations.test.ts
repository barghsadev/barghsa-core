import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { vatConfigurations, productVatOverrides } from './vat-configurations.js'
import { products } from './products.js'
import { users } from './users.js'

/**
 * Drift guard for the VAT configuration tables (T-09.12.02).
 *
 * The rate-range CHECK, effective-window CHECK, GIST EXCLUDE no-overlap
 * constraints, and the `updated_at` triggers live in the hand-written
 * migration 0047 (Drizzle v0.40's column builder has no `.check()`).
 * This test asserts the migration still declares them and that the
 * drizzle schema matches the service layer's expectations. If a future
 * `drizzle-kit generate` ever rewrites the migration and drops a
 * constraint, this test fails instead of silently loosening the VAT
 * configuration posture (rates are financial data).
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0047_create_vat_configurations.sql'),
  'utf8',
)

describe('VAT configuration schema (T-09.12.02)', () => {
  it('vat_configurations declares the domain columns expected by the service layer', () => {
    const columns = Object.keys(vatConfigurations)
    for (const column of ['category', 'rate', 'effectiveFrom', 'effectiveUntil', 'createdBy']) {
      expect(columns).toContain(column)
    }
  })

  it('product_vat_overrides declares the domain columns', () => {
    const columns = Object.keys(productVatOverrides)
    for (const column of ['productId', 'vatConfigId', 'effectiveFrom', 'effectiveUntil', 'createdBy']) {
      expect(columns).toContain(column)
    }
  })

  it('product_vat_overrides.product_id references products with RESTRICT', () => {
    const fks = getTableConfig(productVatOverrides).foreignKeys
    const productFk = fks.find((fk) => fk.reference().foreignTable === products)
    expect(productFk).toBeDefined()
    expect(productFk!.onDelete).toBe('restrict')
  })

  it('created_by references users with RESTRICT', () => {
    const fks = getTableConfig(vatConfigurations).foreignKeys
    const userFk = fks.find((fk) => fk.reference().foreignTable === users)
    expect(userFk).toBeDefined()
    expect(userFk!.onDelete).toBe('restrict')
  })

  it('migration 0047 creates both tables', () => {
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS vat_configurations/)
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS product_vat_overrides/)
  })

  it('migration 0047 keeps the 0..10000 basis-point rate CHECK', () => {
    expect(MIGRATION).toMatch(
      /chk_vat_configurations_rate_range[\s\S]*CHECK \(rate BETWEEN 0 AND 10000\)/,
    )
  })

  it('migration 0047 keeps the effective-window CHECKs', () => {
    expect(MIGRATION).toMatch(/chk_vat_configurations_effective_range/)
    expect(MIGRATION).toMatch(/chk_product_vat_overrides_effective_range/)
  })

  it('migration 0047 forbids overlapping windows per category and per product', () => {
    expect(MIGRATION).toMatch(/excl_vat_configurations_no_overlap/)
    expect(MIGRATION).toMatch(/category WITH =/)
    expect(MIGRATION).toMatch(/excl_product_vat_overrides_no_overlap/)
    expect(MIGRATION).toMatch(/product_id WITH =/)
  })

  it('migration 0047 keeps the updated_at triggers', () => {
    expect(MIGRATION).toMatch(/trg_vat_configurations_updated_at/)
    expect(MIGRATION).toMatch(/trg_product_vat_overrides_updated_at/)
  })

  it('migration 0047 indexes effective_until for window scans', () => {
    expect(MIGRATION).toMatch(/idx_vat_configurations_effective_until/)
  })
})

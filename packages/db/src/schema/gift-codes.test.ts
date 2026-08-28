import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { giftCodes, giftCodeProfiles, giftCodeRedemptions } from './gift-codes.js'
import { orders } from './orders.js'

/**
 * Drift guard for the gift code tables (T-09.12.03).
 *
 * The discount CHECKs (percentage requires a cap, fixed forbids it),
 * the window/limit CHECKs, the UNIQUE normalized-code index and the
 * `updated_at` triggers live in the hand-written migration 0048
 * (Drizzle v0.40's column builder has no `.check()`). This test asserts
 * the migration still declares them and that the drizzle schema matches
 * the service layer's expectations. If a future `drizzle-kit generate`
 * ever rewrites the migration and drops a constraint, this test fails
 * instead of silently loosening the gift-code posture (promotions are
 * financial data).
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0048_create_gift_codes.sql'),
  'utf8',
)

describe('Gift code schema (T-09.12.03)', () => {
  it('gift_codes declares the domain columns expected by the service layer', () => {
    const columns = Object.keys(giftCodes)
    for (const column of [
      'code',
      'discountType',
      'discountValue',
      'maxCapIrr',
      'eligibility',
      'totalLimit',
      'perProfileLimit',
      'validFrom',
      'validUntil',
      'minOrderAmount',
      'categories',
      'status',
      'createdBy',
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('gift_code_profiles declares the composite scope', () => {
    const columns = Object.keys(giftCodeProfiles)
    expect(columns).toContain('giftCodeId')
    expect(columns).toContain('profileId')
  })

  it('gift_code_redemptions declares the ledger columns', () => {
    const columns = Object.keys(giftCodeRedemptions)
    for (const column of ['giftCodeId', 'profileId', 'orderId', 'discountAmount', 'status']) {
      expect(columns).toContain(column)
    }
  })

  it('gift_code_redemptions.order_id references orders with RESTRICT', () => {
    const fks = getTableConfig(giftCodeRedemptions).foreignKeys
    const orderFk = fks.find((fk) => fk.reference().foreignTable === orders)
    expect(orderFk).toBeDefined()
    expect(orderFk!.onDelete).toBe('restrict')
  })

  it('created_by references users with RESTRICT via migration', () => {
    expect(MIGRATION).toContain('created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT')
  })

  it('migration declares the discount CHECKs (percentage requires cap, fixed forbids it)', () => {
    expect(MIGRATION).toContain("discount_type IN ('fixed_irr', 'percentage')")
    expect(MIGRATION).toContain('chk_gift_codes_discount_value')
    expect(MIGRATION).toContain("discount_type = 'fixed_irr' AND max_cap_irr IS NULL")
    expect(MIGRATION).toContain('AND discount_value <= 10000')
    expect(MIGRATION).toContain('AND max_cap_irr IS NOT NULL')
  })

  it('migration declares the window and limit CHECKs', () => {
    expect(MIGRATION).toContain('chk_gift_codes_window')
    expect(MIGRATION).toContain('chk_gift_codes_limits')
    expect(MIGRATION).toContain('chk_gift_codes_min_order')
  })

  it('migration declares the UNIQUE normalized code index and one-per-order ledger', () => {
    expect(MIGRATION).toContain('uq_gift_codes_code')
    expect(MIGRATION).toContain('uq_gift_code_redemptions_order_id')
  })

  it('migration declares updated_at triggers', () => {
    expect(MIGRATION).toContain('trg_gift_codes_updated_at')
  })

  it('migration adds the gift-code mirror columns to orders (schema/service contract)', () => {
    // OrdersService.createOrder writes gift_code_id / gift_discount_amount;
    // the Drizzle schema declares them (schema/orders.ts) — the migration
    // MUST add them or every gift-code order fails with 42703 on a real DB.
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS gift_code_id UUID')
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS gift_discount_amount BIGINT')
    expect(MIGRATION).toContain('idx_orders_gift_code_id')
  })
})

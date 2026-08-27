import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceBreachAlerts } from './service-breach-alerts.js'

/**
 * Drift guard for the service_breach_alerts table (T-09.08.01).
 *
 * The CHECK / UNIQUE constraints for this table live in migration 0037
 * (Drizzle v0.40's column builder has no `.check()`), so this test asserts
 * the migration still declares them and that the service-type CHECK stays in
 * sync with the domains the worker breach scan actually checks. If a future
 * `drizzle-kit generate` ever rewrites the migration and drops a constraint,
 * or the dedup guarantee is loosened, this test fails instead of silently
 * allowing duplicate breach alerts.
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0037_create_service_breach_alerts.sql'),
  'utf8',
)

describe('service_breach_alerts schema (T-09.08.01)', () => {
  it('declares the domain columns expected by the worker scan', () => {
    const columns = Object.keys(serviceBreachAlerts)
    for (const column of ['serviceType', 'itemId', 'targetHours', 'alertedAt']) {
      expect(columns).toContain(column)
    }
  })

  it('migration 0037 keeps the service-type CHECK constraint (ticket, verification_case)', () => {
    expect(MIGRATION).toMatch(
      /chk_sba_service_type[\s\S]*CHECK \(service_type IN \('ticket', 'verification_case'\)\)/,
    )
  })

  it('migration 0037 keeps the positive target-hours CHECK constraint', () => {
    expect(MIGRATION).toMatch(/chk_sba_target_hours[\s\S]*CHECK \(target_hours > 0\)/)
  })

  it('migration 0037 keeps the per-item dedup UNIQUE constraint', () => {
    expect(MIGRATION).toMatch(/uq_sba_item[\s\S]*UNIQUE \(service_type, item_id\)/)
  })
})

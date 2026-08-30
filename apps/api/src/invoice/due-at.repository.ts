/**
 * Due-at calculation repository (T-04.1.03.02).
 *
 * Data access for the admin `service_due_periods` row that is active at
 * an invoice's `issuedAt`. The pure `issuedAt + config_days` (or staff
 * override) math lives in `@barghsa/shared/finance`; THIS module owns
 * the SQL that loads `default_days`.
 *
 * Runs against any DB executor — the shared pool OR a caller-owned
 * transaction client — so invoice issuance can snapshot the period
 * inside the same transaction that creates the invoice.
 */

import { Injectable } from '@nestjs/common'
import type { ServiceDuePeriodType } from '@barghsa/shared/finance'
import type { DbExecutor } from './vat-calculation.repository.js'

/** One active due-period row at a point in time. */
export interface ActiveDuePeriod {
  id: string
  serviceType: ServiceDuePeriodType
  defaultDays: number
}

@Injectable()
export class DueAtCalculationRepository {
  /**
   * Load the `service_due_periods` row whose effective window covers
   * `at` for `serviceType`. Windows are `[effective_from, effective_until)`
   * (null until = open), matching VAT config semantics.
   *
   * Returns null when no row is active so callers can fall back to
   * {@link DEFAULT_SERVICE_DUE_DAYS}.
   */
  async findActive(
    executor: DbExecutor,
    serviceType: ServiceDuePeriodType,
    at: Date,
  ): Promise<ActiveDuePeriod | null> {
    const result = await executor.query<{
      id: string
      service_type: ServiceDuePeriodType
      default_days: number
    }>(
      `SELECT id, service_type, default_days
         FROM service_due_periods
        WHERE service_type = $1
          AND effective_from <= $2
          AND (effective_until IS NULL OR effective_until > $2)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [serviceType, at],
    )
    const row = result.rows[0]
    if (row === undefined) return null
    return {
      id: row.id,
      serviceType: row.service_type,
      defaultDays: row.default_days,
    }
  }
}

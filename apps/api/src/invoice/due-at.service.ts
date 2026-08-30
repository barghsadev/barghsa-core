/**
 * Due-at calculation service (T-04.1.03.02).
 *
 * First-class, injectable service that resolves an invoice `dueAt`:
 *   1. staff override (when supplied) wins;
 *   2. else `issuedAt + default_days` from the active
 *      `service_due_periods` row for the invoice's service type;
 *   3. else `issuedAt + DEFAULT_SERVICE_DUE_DAYS` (no active row, or
 *      a product type with no matching due-period key).
 *
 * Resolution can run on the shared pool or a caller-owned transaction
 * client so issuance snapshots the period inside the same transaction
 * that creates the invoice.
 *
 * Staff-override permission + customer-visible reason are T-04.1.03.03;
 * this module only computes the instant.
 */

import { Injectable } from '@nestjs/common'
import {
  resolveDueAt,
  type DueAtSource,
  type ServiceDuePeriodType,
} from '@barghsa/shared/finance'
import type { DbExecutor } from './vat-calculation.repository.js'
import { DueAtCalculationRepository } from './due-at.repository.js'

/** Input to {@link DueAtCalculationService.resolve}. */
export interface ResolveInvoiceDueAtInput {
  /**
   * Canonical due-period service type. Null skips the config lookup
   * (unknown product types such as `hardware`) and uses the fallback.
   */
  serviceType: ServiceDuePeriodType | null
  /** Invoice issue instant (`issuedAt`). */
  issuedAt: Date
  /** Explicit staff due date; when set it wins over config days. */
  staffOverride?: Date
}

/** One resolved invoice due instant plus the rule that produced it. */
export interface ResolvedInvoiceDueAt {
  dueAt: Date
  source: DueAtSource
  /** Days applied for `config` / `fallback`; null for staff override. */
  configDays: number | null
  /** Active period row id when `source === 'config'`; otherwise null. */
  periodId: string | null
  /** Service type consulted (null when no canonical mapping existed). */
  serviceType: ServiceDuePeriodType | null
}

@Injectable()
export class DueAtCalculationService {
  constructor(private readonly repository: DueAtCalculationRepository) {}

  /**
   * Resolve `dueAt` for an invoice being issued.
   *
   * @param executor the pool or in-transaction client to query on.
   */
  async resolve(
    executor: DbExecutor,
    input: ResolveInvoiceDueAtInput,
  ): Promise<ResolvedInvoiceDueAt> {
    if (input.staffOverride !== undefined) {
      const resolved = resolveDueAt({
        issuedAt: input.issuedAt,
        staffOverride: input.staffOverride,
      })
      return {
        ...resolved,
        periodId: null,
        serviceType: input.serviceType,
      }
    }

    const period =
      input.serviceType === null
        ? null
        : await this.repository.findActive(
            executor,
            input.serviceType,
            input.issuedAt,
          )

    const resolved = resolveDueAt({
      issuedAt: input.issuedAt,
      configDays: period?.defaultDays ?? null,
    })
    return {
      ...resolved,
      periodId: period?.id ?? null,
      serviceType: input.serviceType,
    }
  }
}

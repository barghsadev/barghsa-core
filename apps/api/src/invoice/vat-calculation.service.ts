/**
 * VAT calculation service (T-04.1.02.04).
 *
 * First-class, injectable service that resolves the effective VAT rate
 * for a product/category at a point in time (product override → category
 * default → 0%) and computes the VAT amount on a net taxable line.
 *
 * It composes two concerns:
 *   1. Resolution — delegates SQL to {@link VatCalculationRepository} and
 *      returns the resolved rate + the rule that produced it.
 *   2. Money math — `vatAmount` round-half-up to the nearest IRR on the
 *      NET taxable amount (discounts applied before VAT), integer-only.
 *
 * The resolution can run on the shared pool or a caller-owned
 * transaction client (see `DbExecutor`), so invoice generation snapshots
 * the rate inside the same transaction that creates the invoice
 * (S-04.1.02, README atomicity rule). AutoInvoiceService resolves rates
 * through this module instead of embedding its own lookup logic;
 * consolidating the per-line rounding calls in the pure calculation
 * modules (`*.calculation.ts`) onto `vatAmount()` is a follow-up so the
 * math stays dependency-free there.
 */

import { Injectable } from '@nestjs/common'
import {
  VatCalculationRepository,
  type DbExecutor,
  type ResolveVatRateInput,
  type ResolvedVatRate,
} from './vat-calculation.repository.js'
import { roundHalfUpDiv } from './manual-invoice.calculation.js'

/** Error messages for the money-math surface. */
export const VAT_CALC_ERRORS = {
  NEGATIVE_NET: () => 'VAT net base cannot be negative',
  BAD_RATE: () => 'VAT rate must be an integer in basis points between 0 and 10000 (0%..100%)',
} as const

@Injectable()
export class VatCalculationService {
  constructor(private readonly repository: VatCalculationRepository) {}

  /**
   * Resolve the effective VAT rate at a point in time.
   *
   * Precedence (T-09.12.02): active product override → category default
   * → 0% (fallback). Result carries the rule that produced the rate so
   * callers can snapshot it (metadata `vat.source`).
   */
  resolveRate(
    executor: DbExecutor,
    input: ResolveVatRateInput = {},
  ): Promise<ResolvedVatRate> {
    return this.repository.resolveRate(executor, input)
  }

  /**
   * Compute the VAT amount on a net taxable base, round-half-up to the
   * nearest IRR. Floating point is forbidden; all math is integer BigInt.
   *
   * `vat = roundHalfUpDiv(netAmount × rateBasisPoints, 10000)` when the
   * line is taxable; 0 for a non-taxable line (mirrors the DB CHECK
   * `is_taxable OR vat_amount = 0`).
   *
   * @throws RangeError when `netAmount` is negative or `rateBasisPoints`
   *   is outside 0..10000.
   */
  vatAmount(netAmount: bigint, rateBasisPoints: number, isTaxable = true): bigint {
    if (netAmount < 0n) {
      throw new RangeError(VAT_CALC_ERRORS.NEGATIVE_NET())
    }
    if (
      !Number.isInteger(rateBasisPoints) ||
      rateBasisPoints < 0 ||
      rateBasisPoints > 10_000
    ) {
      throw new RangeError(VAT_CALC_ERRORS.BAD_RATE())
    }
    if (!isTaxable) return 0n
    return roundHalfUpDiv(netAmount * BigInt(rateBasisPoints), 10_000n)
  }
}

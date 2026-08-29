/**
 * VAT calculation repository (T-04.1.02.04).
 *
 * Data access for resolving the effective VAT rate at a point in time:
 *   - an active per-product override, OR
 *   - the product's charge-category default, OR
 *   - 0% (fallback).
 *
 * The resolution rules and the `resolveVatRate` pure decision live in
 * `@barghsa/shared/finance` (vat-config); THIS module owns the SQL that
 * loads the active rows. It runs against any DB executor — the shared
 * pool OR a caller-owned transaction client — so invoice generation can
 * resolve (and snapshot) the rate inside the same transaction that
 * creates the invoice (S-04.1.02 "Snapshots", README atomicity rule).
 *
 * WHY a dedicated module: T-04.1.02.03 parked an inline `resolveVatRateAt`
 * private method on AutoInvoiceService as a seam. This task promotes it
 * into a first-class, injectable, table-drivable module that manual,
 * auto and scheduled invoice paths share, and moves the SQL out of the
 * service.
 */

import { Injectable } from '@nestjs/common'
import { resolveVatRate } from '@barghsa/shared/finance'

/** Minimal query executor shared by the pool and a transactional client. */
export type DbExecutor = {
  query: <T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
}

/**
 * One resolved VAT rate at a point in time: the rate plus the rule
 * that produced it. Sources match `@barghsa/shared/finance`:
 * `product_override` | `category` | `fallback_zero`.
 */
export interface ResolvedVatRate {
  /** Rate in basis points (0..10000 = 0%..100%). */
  rateBasisPoints: number
  /** Which rule produced the rate. */
  source: 'product_override' | 'category' | 'fallback_zero'
}

/** Input to {@link VatCalculationRepository.resolveRate}. */
export interface ResolveVatRateInput {
  /**
   * Product whose override+category to resolve. When present, the
   * product's own charge category (products.type) is used as the
   * category fallback unless an explicit `category` is given.
   */
  productId?: string
  /**
   * Explicit charge-category key. Defaults to the product's type when
   * only `productId` is given; omitted entirely → no category look-up
   * (a bare explicit-rate resolution).
   */
  category?: string
  /** Point in time the rate must be active at (defaults to now). */
  at?: Date
}

@Injectable()
export class VatCalculationRepository {
  /**
   * Load the active override + category rates at `at` and resolve them.
   *
   * Precedence (T-09.12.02 / shared `resolveVatRate`): active product
   * override wins; else the category's active rate; else 0%.
   *
   * @param executor the pool or in-transaction client to query on.
   */
  async resolveRate(
    executor: DbExecutor,
    input: ResolveVatRateInput = {},
  ): Promise<ResolvedVatRate> {
    const at = input.at ?? new Date()

    // Precedence: active product override wins outright. Only fall back
    // to the category when no override applies — deriving the category
    // costs a products round-trip, so skip it when the override resolves.
    const override = await this.findActiveOverrideRate(
      executor,
      input.productId,
      at,
    )
    if (override !== null) {
      return resolveVatRate(override, null)
    }

    let derivedCategory: string | undefined
    if (input.productId !== undefined && input.category === undefined) {
      // Derive the product's charge category from its type so the
      // category-default rule is reachable with productId alone.
      const product = await executor.query<{ type: string }>(
        'SELECT type FROM products WHERE id = $1',
        [input.productId],
      )
      if (product.rows.length > 0 && product.rows[0] !== undefined) {
        derivedCategory = product.rows[0].type
      }
    }

    const categoryRate = await this.findActiveCategoryRate(
      executor,
      input.category ?? derivedCategory,
      at,
    )

    return resolveVatRate(null, categoryRate)
  }

  /** Active product-override rate (bps) at `at`, or null when none. */
  private async findActiveOverrideRate(
    executor: DbExecutor,
    productId: string | undefined,
    at: Date,
  ): Promise<number | null> {
    if (productId === undefined) return null
    const override = await executor.query<{ rate: number }>(
      `SELECT vc.rate
         FROM product_vat_overrides pvo
         JOIN vat_configurations vc ON vc.id = pvo.vat_config_id
        WHERE pvo.product_id = $1
          AND pvo.effective_from <= $2
          AND (pvo.effective_until IS NULL OR pvo.effective_until > $2)
        ORDER BY pvo.effective_from DESC
        LIMIT 1`,
      [productId, at],
    )
    return override.rows[0]?.rate ?? null
  }

  /** Active category rate (bps) at `at`, or null when none. */
  private async findActiveCategoryRate(
    executor: DbExecutor,
    category: string | undefined,
    at: Date,
  ): Promise<number | null> {
    if (category === undefined) return null
    const config = await executor.query<{ rate: number }>(
      `SELECT rate
         FROM vat_configurations
        WHERE category = $1
          AND effective_from <= $2
          AND (effective_until IS NULL OR effective_until > $2)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [category, at],
    )
    return config.rows[0]?.rate ?? null
  }
}

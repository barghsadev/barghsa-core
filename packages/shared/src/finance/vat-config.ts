/**
 * VAT configuration contract (T-09.12.02, shared between the admin API
 * and the finance domain).
 *
 * VAT rates are administered per **charge category** (the canonical
 * category set mirrors the product catalogue keys), with an optional
 * per-product override. Resolution order (T-09.12.02 / T-03.02.05.03):
 *
 *   1. product has an active override  → the override's rate
 *   2. charge category has an active rate → the category rate
 *   3. otherwise                        → 0 (fallback)
 *
 * Rates are stored as integer **basis points** (900 = 9.00%) for exact
 * integer arithmetic — floating point is forbidden for financial values.
 * Validation gate: 0 ≤ rate ≤ 100% (0..10000 bps).
 *
 * All rate rows are versioned with effective windows:
 *   - `effective_from` (inclusive)
 *   - `effective_until` (exclusive; null = open/current)
 * At most one open (null effective_until) row exists per category and per
 * product override at any time, enforced by DB EXCLUDE constraints
 * (migration 0047) and the admin service's window logic.
 *
 * @module finance
 */

/** Canonical charge category keys (mirror product typology/categories). */
export const CHARGE_CATEGORIES = [
  // Product types
  'consultation',
  'electricity',
  'hardware',
  'saving_plan',
  // Consultation categories
  'electricity_generation_station_consultation',
  'electricity_saving_certificate_consultation',
  // Electricity categories
  'thermal_electricity',
  'green_electricity',
  'free_market_electricity',
  'energy_saving_electricity',
] as const

export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number]

/** Whether a raw value is a known charge category key. */
export function isChargeCategory(raw: unknown): raw is ChargeCategory {
  return typeof raw === 'string' && (CHARGE_CATEGORIES as readonly string[]).includes(raw)
}

/** Maximum VAT rate in basis points: 100% = 10 000 bps. */
export const MAX_VAT_BASIS_POINTS = 10_000

/** Minimum VAT rate in basis points: 0%. */
export const MIN_VAT_BASIS_POINTS = 0

/**
 * Whether a raw value is a valid VAT rate in basis points:
 * an integer within [0, 10000] (0%..100%).
 */
export function isValidVatBasisPoints(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= MIN_VAT_BASIS_POINTS &&
    raw <= MAX_VAT_BASIS_POINTS
  )
}

/** Convert basis points to a percent value (e.g. 900 -> 9). */
export function vatBasisPointsToPercent(bps: number): number {
  return bps / 100
}

/** Convert a percent value to basis points (e.g. 9 -> 900). */
export function vatPercentToBasisPoints(percent: number): number {
  return Math.round(percent * 100)
}

/**
 * A versioned VAT rate row as stored in `vat_configurations` and exposed
 * by the admin API.
 */
export interface VatConfigDto {
  id: string
  /** Charge category key this rate applies to. */
  category: ChargeCategory | string
  /** Rate in basis points (0..10000). */
  rateBasisPoints: number
  /** Effective window — `effectiveFrom` inclusive. */
  effectiveFrom: string
  /** Effective window end — exclusive; null = open/current. */
  effectiveUntil: string | null
  /** Admin who recorded this rate. */
  createdBy: string
  createdAt: string
  updatedAt: string
  /**
   * Derived status for admin UI/table:
   * - `current` — active now
   * - `scheduled` — future effective date (not yet active)
   * - `expired` — ended in the past
   */
  status: 'current' | 'scheduled' | 'expired'
}

/** A product VAT override row as stored in `product_vat_overrides`. */
export interface VatProductOverrideDto {
  id: string
  productId: string
  /** The vat_configurations row whose rate the override applies. */
  vatConfigId: string
  /** Rate of the referenced configuration (basis points), denormalized for display. */
  rateBasisPoints: number
  category: ChargeCategory | string
  /** Effective window — `effectiveFrom` inclusive. */
  effectiveFrom: string
  /** Effective window end — exclusive; null = open/current. */
  effectiveUntil: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

/**
 * Derive the display status of a versioned window at `at` (default now).
 */
export function vatWindowStatus(
  effectiveFrom: Date | string,
  effectiveUntil: Date | string | null,
  at: Date = new Date(),
): 'current' | 'scheduled' | 'expired' {
  const from = effectiveFrom instanceof Date ? effectiveFrom : new Date(effectiveFrom)
  const until = effectiveUntil == null ? null : effectiveUntil instanceof Date ? effectiveUntil : new Date(effectiveUntil)
  if (from.getTime() > at.getTime()) return 'scheduled'
  if (until !== null && until.getTime() <= at.getTime()) return 'expired'
  return 'current'
}

/** One resolved VAT decision: the rate plus the rule that produced it. */
export interface VatResolution {
  /** Rate in basis points (0..10000). */
  rateBasisPoints: number
  /** Which rule produced the rate. */
  source: 'product_override' | 'category' | 'fallback_zero'
}

/**
 * Resolve a VAT rate at a point in time. Pure function — the admin API
 * and the invoice snapshot seam (T-03.02.05.03) call this with the
 * active rows fetched from the DB.
 *
 * @param activeProductOverrideRate - rate (bps) of the product's active
 *   override at `at`, or null when none.
 * @param activeCategoryRate - rate (bps) of the category's active rate
 *   at `at`, or null when none.
 * @returns the resolved rate. Product override wins; category applies
 *   otherwise; 0% is the fallback.
 */
export function resolveVatRate(
  activeProductOverrideRate: number | null,
  activeCategoryRate: number | null,
): VatResolution {
  if (activeProductOverrideRate !== null) {
    return { rateBasisPoints: activeProductOverrideRate, source: 'product_override' }
  }
  if (activeCategoryRate !== null) {
    return { rateBasisPoints: activeCategoryRate, source: 'category' }
  }
  return { rateBasisPoints: 0, source: 'fallback_zero' }
}
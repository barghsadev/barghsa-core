/**
 * Gift code contract (T-09.12.03) shared between the admin API
 * (S-09.12 · catalogue management → gift code management), the orders
 * module (redemption at order creation), and future public surfaces.
 *
 * Model summary
 * -------------
 * A gift code is administered by an admin and redeemed by a customer
 * at order creation:
 *
 * - `code` — case-insensitive unique; ALWAYS normalized with
 *   {@link normalizeGiftCode} (trim + uppercase) before storage and
 *   lookup, so ` sale10 ` and `SALE10` are the same code.
 * - `discountType` — `fixed_irr` (a fixed IRR discount) or `percentage`
 *   (a percentage discount with a **required** IRR cap —
 *   `maxCapIrr`). The percentage value is stored in **basis points**
 *   (2500 = 25%), mirroring the VAT rate discipline: financial values
 *   are exact integers, never floats.
 * - `eligibility` — `public` (any profile) or `profile` (only profiles
 *   listed in the `gift_code_profiles` join table).
 * - `totalLimit` / `perProfileLimit` — usage limits; null = unlimited.
 * - `validFrom` (inclusive) / `validUntil` (exclusive; null = open).
 * - `minOrderAmount` — order must total at least this much (IRR).
 * - `categories` — eligible product categories (`products.type`);
 *   empty = all categories.
 * - `status` — `active` / `inactive` (admin toggle; only active codes
 *   can be redeemed).
 *
 * Discount arithmetic
 * -------------------
 * `computeGiftDiscount` is the single source of truth for the discount
 * amount, used identically by the redemption seam at order creation
 * and by the invoice seam so that **VAT is calculated after the gift
 * discount on taxable lines** (T-09.12.03): the taxable base of a line
 * is `lineTotal - allocatedGiftDiscount`.
 *
 * @module promotions
 */

/** Discount type discriminator. */
export const GIFT_CODE_DISCOUNT_TYPES = ['fixed_irr', 'percentage'] as const
export type GiftCodeDiscountType = (typeof GIFT_CODE_DISCOUNT_TYPES)[number]

/** Eligibility scope discriminator. */
export const GIFT_CODE_ELIGIBILITY = ['public', 'profile'] as const
export type GiftCodeEligibility = (typeof GIFT_CODE_ELIGIBILITY)[number]

/** Lifecycle status. */
export const GIFT_CODE_STATUSES = ['active', 'inactive'] as const
export type GiftCodeStatus = (typeof GIFT_CODE_STATUSES)[number]

/** 100% expressed in basis points — upper bound of percentage values. */
export const MAX_GIFT_PERCENT_BPS = 10_000

/** Product category quoted in the task: products.type discriminators. */
export const GIFT_CODE_CATEGORIES = [
  'consultation',
  'electricity',
  'hardware',
  'saving_plan',
] as const
export type GiftCodeCategory = (typeof GIFT_CODE_CATEGORIES)[number]

/**
 * Normalize a raw gift code: trim whitespace and uppercase. This is the
 * canonical form used for the DB unique index and every lookup.
 */
export function normalizeGiftCode(raw: string): string {
  return raw.trim().toUpperCase()
}

/** Whether a raw value is a known discount type. */
export function isGiftCodeDiscountType(raw: unknown): raw is GiftCodeDiscountType {
  return (
    typeof raw === 'string' &&
    (GIFT_CODE_DISCOUNT_TYPES as readonly string[]).includes(raw)
  )
}

/** Whether a raw value is a known eligibility scope. */
export function isGiftCodeEligibility(raw: unknown): raw is GiftCodeEligibility {
  return (
    typeof raw === 'string' &&
    (GIFT_CODE_ELIGIBILITY as readonly string[]).includes(raw)
  )
}

/** Whether a raw value is a known status. */
export function isGiftCodeStatus(raw: unknown): raw is GiftCodeStatus {
  return (
    typeof raw === 'string' &&
    (GIFT_CODE_STATUSES as readonly string[]).includes(raw)
  )
}

/**
 * Whether a raw value is a valid percentage discount in basis points:
 * an integer within [1, 10000] (0.01%..100%). A 0% gift code is
 * meaningless, so 0 is rejected.
 */
export function isGiftCodePercentageBps(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= 1 &&
    raw <= MAX_GIFT_PERCENT_BPS
  )
}

/** Whether a raw value is a valid positive IRR amount (as string/bigint). */
export function isPositiveIrr(raw: unknown): raw is string | bigint {
  try {
    const value = typeof raw === 'bigint' ? raw : BigInt(String(raw))
    return value > 0n
  } catch {
    return false
  }
}

/** BigInt-alias so callers can pass pg bigint strings or bigints. */
type Numeric = string | bigint

function toBigInt(value: Numeric): bigint {
  return typeof value === 'bigint' ? value : BigInt(value)
}

export interface ComputeGiftDiscountInput {
  discountType: GiftCodeDiscountType
  /**
   * `fixed_irr`: the IRR amount. `percentage`: the percentage in basis
   * points (2500 = 25%).
   */
  discountValue: Numeric
  /** Required for `percentage` (the cap); null/absent for `fixed_irr`. */
  maxCapIrr: Numeric | null
  /** The pre-discount order total in IRR. */
  orderAmount: Numeric
}

/**
 * Compute the gift discount for an order at redemption time, in exact
 * integer IRR.
 *
 * - `fixed_irr`: `min(discountValue, orderAmount)` — a code never
 *   discounts below zero.
 * - `percentage`: `min(floor(orderAmount * bps / 10000), maxCapIrr)`
 *   — the percentage is applied to the order total and capped at the
 *   mandatory IRR cap.
 *
 * Returns the discount as a canonical decimal string (pg bigint
 * convention used across the catalogue/finance code).
 */
export function computeGiftDiscount(input: ComputeGiftDiscountInput): string {
  const orderAmount = toBigInt(input.orderAmount)
  const discountValue = toBigInt(input.discountValue)
  if (orderAmount < 0n || discountValue < 0n) {
    throw new Error('gift discount inputs must be non-negative')
  }
  if (input.discountType === 'fixed_irr') {
    const discount = discountValue < orderAmount ? discountValue : orderAmount
    return discount.toString()
  }
  // percentage — basis points; positive inputs, so / truncates = floor
  const uncapped = (orderAmount * discountValue) / 10000n
  if (input.maxCapIrr === null || input.maxCapIrr === undefined) {
    throw new Error('percentage gift discount requires a max IRR cap')
  }
  const cap = toBigInt(input.maxCapIrr)
  if (cap <= 0n) {
    throw new Error('percentage gift discount cap must be positive')
  }
  const capped = uncapped < cap ? uncapped : cap
  return capped.toString()
}

/** Validation outcome shape returned by `validateGiftCodePayload`. */
export interface GiftCodePayloadValidation {
  ok: boolean
  errors: Array<{ path: string; message: string }>
}

/**
 * Validate an admin gift-code payload (create/update) against the
 * business rules that also live in the DB CHECK constraints (migration
 * 0048). Shared so the controller (zod), the service, and tests agree.
 */
export function validateGiftCodePayload(input: {
  discountType: unknown
  discountValue: unknown
  maxCapIrr: unknown
  validFrom?: unknown
  validUntil?: unknown
  totalLimit?: unknown
  perProfileLimit?: unknown
  minOrderAmount?: unknown
}): GiftCodePayloadValidation {
  const errors: Array<{ path: string; message: string }> = []
  if (!isGiftCodeDiscountType(input.discountType)) {
    errors.push({
      path: 'discountType',
      message: `discountType must be one of ${GIFT_CODE_DISCOUNT_TYPES.join(', ')}`,
    })
  } else if (input.discountType === 'fixed_irr') {
    if (!isPositiveIrr(input.discountValue)) {
      errors.push({ path: 'discountValue', message: 'fixed_irr discountValue must be a positive IRR amount' })
    }
    if (input.maxCapIrr !== null && input.maxCapIrr !== undefined) {
      errors.push({ path: 'maxCapIrr', message: 'maxCapIrr must not be set for fixed_irr codes' })
    }
  } else {
    if (!isGiftCodePercentageBps(input.discountValue)) {
      errors.push({
        path: 'discountValue',
        message: `percentage discountValue must be integer basis points within [1, ${MAX_GIFT_PERCENT_BPS}]`,
      })
    }
    if (!isPositiveIrr(input.maxCapIrr ?? null)) {
      errors.push({ path: 'maxCapIrr', message: 'percentage codes require maxCapIrr (positive IRR cap)' })
    }
  }
  for (const [path, raw] of [
    ['totalLimit', input.totalLimit],
    ['perProfileLimit', input.perProfileLimit],
  ] as const) {
    if (raw !== null && raw !== undefined && raw !== '') {
      const num = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isSafeInteger(num) || num < 1) {
        errors.push({ path, message: `${path} must be a positive integer or null for unlimited` })
      }
    }
  }
  if (input.minOrderAmount !== undefined && input.minOrderAmount !== null && input.minOrderAmount !== '') {
    try {
      const value = toBigInt(input.minOrderAmount as Numeric)
      if (value < 0n) {
        errors.push({ path: 'minOrderAmount', message: 'minOrderAmount must be >= 0' })
      }
    } catch {
      errors.push({ path: 'minOrderAmount', message: 'minOrderAmount must be an integer IRR amount' })
    }
  }
  if (input.validFrom !== undefined && input.validFrom !== null) {
    const from = new Date(String(input.validFrom))
    if (Number.isNaN(from.getTime())) {
      errors.push({ path: 'validFrom', message: 'validFrom must be an ISO-8601 timestamp' })
    } else if (input.validUntil !== undefined && input.validUntil !== null) {
      const until = new Date(String(input.validUntil))
      if (!Number.isNaN(until.getTime()) && until.getTime() <= from.getTime()) {
        errors.push({ path: 'validUntil', message: 'validUntil must be strictly after validFrom' })
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

// ─── DTOs ──────────────────────────────────────────────────────────────

/** Derived usage totals attached to every admin list/detail row. */
export interface GiftCodeUsageDto {
  /** Redemptions currently counting against limits (status consumed). */
  consumed: number
  /** Redemptions restored after cancellation (status released). */
  released: number
  /** Sum of discount IRR applied by consumed redemptions. */
  totalDiscountIrr: string
}

/** A gift code row as exposed by the admin API. */
export interface GiftCodeDto {
  id: string
  /** Normalized (trim + uppercase) code. */
  code: string
  discountType: GiftCodeDiscountType
  /** IRR amount (fixed_irr) or basis points (percentage). */
  discountValue: string
  /** Mandatory for percentage; always null for fixed_irr. */
  maxCapIrr: string | null
  eligibility: GiftCodeEligibility
  /** Profile ids when eligibility === 'profile'. */
  profileIds: string[]
  /** Total redemptions allowed; null = unlimited. */
  totalLimit: number | null
  /** Redemptions per profile; null = unlimited. */
  perProfileLimit: number | null
  /** Window start (inclusive). */
  validFrom: string
  /** Window end (exclusive); null = no expiry. */
  validUntil: string | null
  /** Minimum order amount in IRR; '0' = no minimum. */
  minOrderAmount: string
  /** Eligible product categories; empty = all. */
  categories: string[]
  status: GiftCodeStatus
  createdBy: string
  createdAt: string
  updatedAt: string
  usage: GiftCodeUsageDto
}

/** A single redemption record (stats view). */
export interface GiftCodeRedemptionDto {
  id: string
  giftCodeId: string
  profileId: string
  orderId: string
  /** Applied discount in IRR. */
  discountAmount: string
  /** 'consumed' counts against limits; 'released' was restored. */
  status: 'consumed' | 'released'
  createdAt: string
}

/** Per-profile usage breakdown for the admin stats view. */
export interface GiftCodeProfileUsageDto {
  profileId: string
  consumed: number
  released: number
  discountIrr: string
}
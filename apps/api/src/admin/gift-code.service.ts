import { Injectable, Logger, HttpException, Inject } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import {
  computeGiftDiscount,
  isGiftCodeEligibility,
  isGiftCodeStatus,
  normalizeGiftCode,
  validateGiftCodePayload,
  type GiftCodeDiscountType,
  type GiftCodeDto,
  type GiftCodeEligibility,
  type GiftCodeProfileUsageDto,
  type GiftCodeRedemptionDto,
  type GiftCodeStatus,
} from '@barghsa/shared/promotions'
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js'

/**
 * Gift code management service (S-09.12, T-09.12.03) — API slice.
 *
 * Admin surface:
 * - list / create / update / status toggle / usage stats (permission
 *   `admin:promotions:edit` enforced at the controller boundary, mapped
 *   to platform admin today per the S-09 convention).
 * - Code normalization (trim + uppercase) is applied on EVERY write and
 *   lookup; the DB UNIQUE index on the normalized code (migration 0048)
 *   makes collisions a hard guarantee, surfaced as 409.
 * - Discount payload rules mirror the DB CHECK constraints:
 *   `fixed_irr` → IRR amount and NO cap; `percentage` → basis points
 *   1..10000 and a REQUIRED positive IRR cap.
 * - Every mutation runs in ONE transaction and records an `audit_log`
 *   `change_recorded` event (the epic's audit contract).
 *
 * Redemption surface (the order-creation seam):
 * - {@link GiftCodeService.redeem} validates status, date window,
 *   eligibility (profile list), total/per-profile limits, minimum order
 *   amount and eligible categories, computes the exact IRR discount
 *   (`computeGiftDiscount`), and inserts the ledger row status
 *   `consumed`. The gift_codes row is locked `FOR UPDATE` so concurrent
 *   redemptions serialize against the limits.
 * - {@link GiftCodeService.releaseByOrder} restores the slot
 *   (status → `released`) when an order is cancelled BEFORE payment —
 *   the default policy (T-09.12.03). After-payment release follows a
 *   policy config that does not exist yet; the ledger model supports it
 *   by keeping rows immutable and only flipping status.
 *
 * Redemption is ATOMIC with order creation: the orders module runs its
 * create flow inside one transaction and passes its executor into
 * `redeem(_, q)`, so a failed order creation rolls the redemption
 * back — failed orders never consume a slot.
 *
 * The invoice seam (T-03.02.05.03) will apply VAT AFTER the gift
 * discount on taxable lines: taxable base = lineTotal − allocated
 * `discount_amount` (see @barghsa/shared/promotions docs).
 *
 * Deferred (UI slice): gift code list with search/filter, create/edit
 * form, usage statistics view, active/inactive toggle, high-value
 * percentage warning, fa/en dicts, RTL/a11y.
 */

// ─── Public types ──────────────────────────────────────────────────────────

export interface GiftCodeListFilter {
  /** Substring match on the normalized code. */
  search?: string
  status?: GiftCodeStatus
  discountType?: GiftCodeDiscountType
}

export interface CreateGiftCodeInput {
  /** Raw code — normalized (trim + uppercase) before storage. */
  code: string
  discountType: GiftCodeDiscountType
  /** IRR amount (fixed_irr) or basis points (percentage). */
  discountValue: string
  /** Mandatory for percentage; must be null for fixed_irr. */
  maxCapIrr: string | null
  eligibility: GiftCodeEligibility
  /** Required when eligibility === 'profile'. */
  profileIds: string[]
  totalLimit: number | null
  perProfileLimit: number | null
  validFrom?: string
  validUntil: string | null
  minOrderAmount: string
  categories: string[]
  actorUserId: string
  ip: string
}

export type UpdateGiftCodeInput = Partial<
  Omit<CreateGiftCodeInput, 'actorUserId' | 'ip'>
> & {
  actorUserId: string
  ip: string
}

export interface RedeemGiftCodeInput {
  /** Raw code from the customer; normalized before lookup. */
  giftCode: string
  profileId: string
  /** The order the redemption is attached to (must already exist). */
  orderId: string
  /** Pre-discount order total in IRR (bigint string). */
  orderAmount: string
  /** Product category (`products.type`) the order belongs to. */
  category: string
  /** Actor (session user) for the redemption audit trail. */
  actorUserId?: string
  ip?: string
}

// ─── Internal row types ────────────────────────────────────────────────────

type QueryFn = <T = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[]; rowCount: number | null }>

/** Minimal query executor shared by the pool and a transactional client. */
export type DbExecutor = { query: QueryFn }

interface GiftCodeRow {
  id: string
  code: string
  discount_type: GiftCodeDiscountType
  discount_value: string
  max_cap_irr: string | null
  eligibility: GiftCodeEligibility
  total_limit: number | null
  per_profile_limit: number | null
  valid_from: string
  valid_until: string | null
  min_order_amount: string
  categories: string[]
  status: GiftCodeStatus
  created_by: string
  created_at: string
  updated_at: string
}

interface GiftCodeWithUsageRow extends GiftCodeRow {
  consumed: number
  released: number
  total_discount: string
}

interface RedemptionRow {
  id: string
  gift_code_id: string
  profile_id: string
  order_id: string
  discount_amount: string
  status: 'consumed' | 'released'
  created_at: string
}

const PG_UNIQUE_VIOLATION = '23505'
const PG_FOREIGN_KEY_VIOLATION = '23503'

const GIFT_CODE_NOT_FOUND = 'GIFT_CODE_NOT_FOUND'
const GIFT_CODE_ALREADY_EXISTS = 'GIFT_CODE_ALREADY_EXISTS'
const GIFT_CODE_ALREADY_APPLIED = 'GIFT_CODE_ALREADY_APPLIED'
const GIFT_CODE_INACTIVE = 'GIFT_CODE_INACTIVE'
const GIFT_CODE_NOT_YET_VALID = 'GIFT_CODE_NOT_YET_VALID'
const GIFT_CODE_EXPIRED = 'GIFT_CODE_EXPIRED'
const GIFT_CODE_NOT_ELIGIBLE = 'GIFT_CODE_NOT_ELIGIBLE'
const GIFT_CODE_TOTAL_LIMIT_REACHED = 'GIFT_CODE_TOTAL_LIMIT_REACHED'
const GIFT_CODE_PROFILE_LIMIT_REACHED = 'GIFT_CODE_PROFILE_LIMIT_REACHED'
const GIFT_CODE_MIN_ORDER_NOT_MET = 'GIFT_CODE_MIN_ORDER_NOT_MET'
const GIFT_CODE_CATEGORY_NOT_ELIGIBLE = 'GIFT_CODE_CATEGORY_NOT_ELIGIBLE'
const GIFT_CODE_PROFILES_REQUIRED = 'GIFT_CODE_PROFILES_REQUIRED'

/** Allowed code charset after normalization: A-Z0-9, dash, underscore. */
const GIFT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,63}$/

/** Allowed product category key: lowercase letters, digits, underscore. */
const GIFT_CODE_CATEGORY_PATTERN = /^[a-z0-9_]+$/

@Injectable()
export class GiftCodeService {
  private readonly logger = new Logger(GiftCodeService.name)

  constructor(
    @Inject(CorrelationIdProvider)
    private readonly correlationIdProvider: CorrelationIdProvider,
  ) {}

  /** Escapes LIKE metacharacters so a search term matches literally. */
  private escapeLike(raw: string): string {
    return raw.replace(/[\\%_]/g, '\\$&')
  }

  // ─── Admin reads ───────────────────────────────────────────────────────

  /** List gift codes, newest first, with derived usage totals. */
  async list(filter: GiftCodeListFilter = {}): Promise<GiftCodeDto[]> {
    const pool = getDbPool()
    const result = await pool.query<GiftCodeWithUsageRow>(
      `SELECT gc.id, gc.code, gc.discount_type, gc.discount_value, gc.max_cap_irr,
              gc.eligibility, gc.total_limit, gc.per_profile_limit,
              gc.valid_from, gc.valid_until, gc.min_order_amount,
              gc.categories, gc.status, gc.created_by, gc.created_at, gc.updated_at,
              COUNT(gcr.id) FILTER (WHERE gcr.status = 'consumed')::int AS consumed,
              COUNT(gcr.id) FILTER (WHERE gcr.status = 'released')::int AS released,
              COALESCE(SUM(gcr.discount_amount) FILTER (WHERE gcr.status = 'consumed'), 0) AS total_discount
         FROM gift_codes gc
         LEFT JOIN gift_code_redemptions gcr ON gcr.gift_code_id = gc.id
        WHERE ($1::text IS NULL OR gc.code ILIKE '%' || $1 || '%' ESCAPE '\')
          AND ($2::text IS NULL OR gc.status = $2)
          AND ($3::text IS NULL OR gc.discount_type = $3)
        GROUP BY gc.id
        ORDER BY gc.created_at DESC`,
      [
        filter.search !== undefined && filter.search !== ''
          ? this.escapeLike(filter.search)
          : null,
        filter.status ?? null,
        filter.discountType ?? null,
      ],
    )
    return this.attachProfileIds(result.rows)
  }

  /** Full usage statistics for one code, for the admin stats view. */
  async stats(id: string): Promise<{
    code: GiftCodeDto
    perProfile: GiftCodeProfileUsageDto[]
    recentRedemptions: GiftCodeRedemptionDto[]
  }> {
    const pool = getDbPool()
    const code = await this.findByIdWithUsage(pool, id)
    if (!code) throw this.notFound(id)

    const perProfile = await pool.query<{
      profile_id: string
      consumed: number
      released: number
      discount_irr: string
    }>(
      `SELECT profile_id,
              COUNT(*) FILTER (WHERE status = 'consumed')::int AS consumed,
              COUNT(*) FILTER (WHERE status = 'released')::int AS released,
              COALESCE(SUM(discount_amount) FILTER (WHERE status = 'consumed'), 0) AS discount_irr
         FROM gift_code_redemptions
        WHERE gift_code_id = $1
        GROUP BY profile_id
        ORDER BY consumed DESC, profile_id`,
      [id],
    )
    const recent = await pool.query<RedemptionRow>(
      `SELECT id, gift_code_id, profile_id, order_id, discount_amount, status, created_at
         FROM gift_code_redemptions
        WHERE gift_code_id = $1
        ORDER BY created_at DESC
        LIMIT 25`,
      [id],
    )
    const withProfiles = await this.attachProfileIds([code])
    return {
      code: withProfiles[0] as GiftCodeDto,
      perProfile: perProfile.rows.map((row) => ({
        profileId: row.profile_id,
        consumed: row.consumed,
        released: row.released,
        discountIrr: row.discount_irr,
      })),
      recentRedemptions: recent.rows.map((row) => this.toRedemptionDto(row)),
    }
  }

  // ─── Admin mutations ───────────────────────────────────────────────────

  /**
   * Create a gift code. Normalizes the code, validates the discount
   * payload (cap rules for percentage), enforces uniqueness, inserts
   * the code (+ profile scopes when profile-restricted) and audits in
   * ONE transaction.
   */
  async create(input: CreateGiftCodeInput): Promise<GiftCodeDto> {
    const code = this.assertNormalizedCode(input.code)
    const validation = validateGiftCodePayload(input)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'GIFT_CODE_INVALID_PAYLOAD',
          message: 'Invalid gift code payload',
          details: validation.errors,
        },
        400,
      )
    }
    const eligibility = this.assertEligibility(input.eligibility)
    const profileIds = this.assertProfileScope(eligibility, input.profileIds)
    const minOrderAmount = this.assertMinOrderAmount(input.minOrderAmount)
    const categories = this.assertCategories(input.categories)

    const pool = getDbPool()
    const existing = await pool.query('SELECT 1 FROM gift_codes WHERE code = $1', [code])
    if (existing.rows.length > 0) {
      throw this.alreadyExists(code)
    }
    const validFrom = input.validFrom !== undefined ? new Date(input.validFrom) : new Date()
    if (Number.isNaN(validFrom.getTime())) throw this.invalidField('validFrom')
    const validUntil = input.validUntil !== null ? new Date(input.validUntil) : null
    if (validUntil !== null && Number.isNaN(validUntil.getTime())) {
      throw this.invalidField('validUntil')
    }
    if (validUntil !== null && validUntil.getTime() <= validFrom.getTime()) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'GIFT_CODE_INVALID_WINDOW',
          message: 'validUntil must be strictly after validFrom',
        },
        400,
      )
    }

    return this.withTransaction(async (q) => {
      const id = uuidv7()
      await q.query(
        `INSERT INTO gift_codes
           (id, code, discount_type, discount_value, max_cap_irr, eligibility,
            total_limit, per_profile_limit, valid_from, valid_until,
            min_order_amount, categories, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13, $14, $14)`,
        [
          id, code, input.discountType, input.discountValue, input.maxCapIrr, eligibility,
          input.totalLimit ?? null, input.perProfileLimit ?? null, validFrom, validUntil,
          minOrderAmount, categories, input.actorUserId, new Date(),
        ],
      )
      if (profileIds.length > 0) {
        await this.insertProfiles(q, id, profileIds)
      }
      await this.recordChange(q, {
        actorUserId: input.actorUserId,
        ip: input.ip,
        entity: 'gift_code',
        action: 'created',
        meta: {
          giftCodeId: id,
          code,
          discountType: input.discountType,
          discountValue: input.discountValue,
          ...(input.maxCapIrr !== null ? { maxCapIrr: input.maxCapIrr } : {}),
          eligibility,
          profileIds: profileIds.length > 0 ? profileIds : undefined,
          totalLimit: input.totalLimit ?? undefined,
          perProfileLimit: input.perProfileLimit ?? undefined,
          validFrom: validFrom.toISOString(),
          validUntil: validUntil !== null ? validUntil.toISOString() : undefined,
          minOrderAmount,
          categories: categories.length > 0 ? categories : undefined,
        },
      })
      this.logger.log(`Gift code created: id=${id}, code=${code}, actor=${input.actorUserId}`)
      return this.readDto(q, id)
    })
  }

  /**
   * Update a gift code. Only provided fields change; a changed code is
   * re-normalized and uniqueness-checked excluding self. Profile scopes
   * are REPLACED when provided (profile-restricted codes require a
   * non-empty list; public codes clear scopes). Audits the change.
   */
  async update(id: string, input: UpdateGiftCodeInput): Promise<GiftCodeDto> {
    return this.withTransaction(async (q) => {
      const current = await this.findById(q, id)
      if (!current) throw this.notFound(id)

      const code = input.code !== undefined ? this.assertNormalizedCode(input.code) : current.code
      if (code !== current.code) {
        const dup = await q.query('SELECT 1 FROM gift_codes WHERE code = $1 AND id <> $2', [code, id])
        if (dup.rows.length > 0) throw this.alreadyExists(code)
      }
      const discountType = input.discountType ?? current.discount_type
      const discountValue = input.discountValue ?? current.discount_value
      // A code converted to fixed_irr NEVER keeps a cap: when the caller
      // switched the type and did not supply a cap, force null (otherwise
      // the stale stored cap trips the fixed-forbids-cap rule forever).
      const maxCapIrr = input.maxCapIrr !== undefined
        ? input.maxCapIrr
        : (discountType === 'fixed_irr' ? null : current.max_cap_irr)
      const validation = validateGiftCodePayload({
        discountType,
        discountValue,
        maxCapIrr,
        totalLimit: input.totalLimit ?? current.total_limit,
        perProfileLimit: input.perProfileLimit ?? current.per_profile_limit,
        minOrderAmount: input.minOrderAmount ?? current.min_order_amount,
        validFrom: input.validFrom ?? current.valid_from,
        validUntil: input.validUntil !== undefined ? input.validUntil : current.valid_until,
      })
      if (!validation.ok) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'GIFT_CODE_INVALID_PAYLOAD',
            message: 'Invalid gift code payload',
            details: validation.errors,
          },
          400,
        )
      }
      const eligibility = input.eligibility !== undefined
        ? this.assertEligibility(input.eligibility)
        : current.eligibility
      const profileIds = input.profileIds !== undefined
        ? this.assertProfileScope(eligibility, input.profileIds)
        : undefined
      const minOrderAmount = input.minOrderAmount !== undefined
        ? this.assertMinOrderAmount(input.minOrderAmount)
        : current.min_order_amount
      const categories = input.categories !== undefined
        ? this.assertCategories(input.categories)
        : current.categories

      let validFrom: Date = new Date(current.valid_from)
      if (input.validFrom !== undefined) {
        const parsed = new Date(input.validFrom)
        if (Number.isNaN(parsed.getTime())) throw this.invalidField('validFrom')
        validFrom = parsed
      }
      let validUntil: Date | null = current.valid_until !== null ? new Date(current.valid_until) : null
      if (input.validUntil !== undefined) {
        if (input.validUntil === null) {
          validUntil = null
        } else {
          const parsed = new Date(input.validUntil)
          if (Number.isNaN(parsed.getTime())) throw this.invalidField('validUntil')
          validUntil = parsed
        }
      }
      if (validUntil !== null && validUntil.getTime() <= validFrom.getTime()) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'GIFT_CODE_INVALID_WINDOW',
            message: 'validUntil must be strictly after validFrom',
          },
          400,
        )
      }

      await q.query(
        `UPDATE gift_codes
            SET code = $1, discount_type = $2, discount_value = $3, max_cap_irr = $4,
                eligibility = $5, total_limit = $6, per_profile_limit = $7,
                valid_from = $8, valid_until = $9, min_order_amount = $10,
                categories = $11, updated_at = $12
          WHERE id = $13`,
        [
          code, discountType, discountValue, maxCapIrr, eligibility,
          input.totalLimit !== undefined ? input.totalLimit : current.total_limit,
          input.perProfileLimit !== undefined ? input.perProfileLimit : current.per_profile_limit,
          validFrom, validUntil,
          minOrderAmount, categories, new Date(), id,
        ],
      )
      // Replace profile scopes whenever provided (or eligibility changed
      // to public — clear stale scopes).
      if (input.profileIds !== undefined || eligibility !== current.eligibility) {
        await q.query('DELETE FROM gift_code_profiles WHERE gift_code_id = $1', [id])
        if (profileIds !== undefined && profileIds.length > 0) {
          await this.insertProfiles(q, id, profileIds)
        }
      }

      await this.recordChange(q, {
        actorUserId: input.actorUserId,
        ip: input.ip,
        entity: 'gift_code',
        action: 'updated',
        meta: {
          giftCodeId: id,
          code,
          ...(input.code !== undefined ? { previousCode: current.code } : {}),
          ...(input.discountType !== undefined ? { discountType } : {}),
          ...(input.discountValue !== undefined ? { discountValue } : {}),
          ...(input.maxCapIrr !== undefined ? { maxCapIrr } : {}),
          ...(input.eligibility !== undefined ? { eligibility } : {}),
        },
      })
      this.logger.log(`Gift code updated: id=${id}, code=${code}, actor=${input.actorUserId}`)
      return this.readDto(q, id)
    })
  }

  /**
   * Toggle the code's active/inactive status. Setting the same status is
   * a no-op (no write, no audit).
   */
  async setStatus(
    id: string,
    status: GiftCodeStatus,
    actorUserId: string,
    ip: string,
  ): Promise<GiftCodeDto> {
    if (!isGiftCodeStatus(status)) throw this.invalidField('status')
    return this.withTransaction(async (q) => {
      const current = await this.findById(q, id)
      if (!current) throw this.notFound(id)
      if (current.status === status) return this.readDto(q, id)

      await q.query('UPDATE gift_codes SET status = $1, updated_at = $2 WHERE id = $3', [
        status, new Date(), id,
      ])
      await this.recordChange(q, {
        actorUserId,
        ip,
        entity: 'gift_code',
        action: status === 'active' ? 'activated' : 'deactivated',
        meta: { giftCodeId: id, code: current.code },
      })
      this.logger.log(
        `Gift code ${status === 'active' ? 'activated' : 'deactivated'}: id=${id}, actor=${actorUserId}`,
      )
      return this.readDto(q, id)
    })
  }

  // ─── Redemption seam (order creation) ──────────────────────────────────

  /**
   * Redeem a gift code against an order, ATOMICALLY.
   *
   * When `q` is omitted the service opens its own transaction; when a
   * caller-provided executor is passed (the orders module's create flow)
   * the caller owns BEGIN/COMMIT — the order insert and the redemption
   * commit or roll back together, so a failed order never consumes a
   * slot.
   *
   * The gift_codes row is locked FOR UPDATE so concurrent redemptions
   * serialize against the total/per-profile limits (no oversell).
   */
  async redeem(input: RedeemGiftCodeInput, q?: DbExecutor): Promise<GiftCodeRedemptionDto> {
    const code = normalizeGiftCode(input.giftCode)
    const run = async (tx: DbExecutor): Promise<GiftCodeRedemptionDto> => {
      const lock = await tx.query<GiftCodeRow>(
        `SELECT id, code, discount_type, discount_value, max_cap_irr, eligibility,
                total_limit, per_profile_limit, valid_from, valid_until,
                min_order_amount, categories, status, created_by, created_at, updated_at
           FROM gift_codes
          WHERE code = $1
          FOR UPDATE`,
        [code],
      )
      const gift = lock.rows[0]
      if (!gift) throw this.http(404, GIFT_CODE_NOT_FOUND, `Gift code ${code} not found`)

      if (gift.status !== 'active') {
        throw this.http(400, GIFT_CODE_INACTIVE, `Gift code ${code} is not active`)
      }
      const now = Date.now()
      if (new Date(gift.valid_from).getTime() > now) {
        throw this.http(400, GIFT_CODE_NOT_YET_VALID, `Gift code ${code} is not valid yet`)
      }
      if (gift.valid_until !== null && new Date(gift.valid_until).getTime() <= now) {
        throw this.http(400, GIFT_CODE_EXPIRED, `Gift code ${code} has expired`)
      }

      if (gift.eligibility === 'profile') {
        const scope = await tx.query(
          'SELECT 1 FROM gift_code_profiles WHERE gift_code_id = $1 AND profile_id = $2',
          [gift.id, input.profileId],
        )
        if (scope.rows.length === 0) {
          throw this.http(
            403,
            GIFT_CODE_NOT_ELIGIBLE,
            `Gift code ${code} is not eligible for this profile`,
          )
        }
      }

      if (gift.total_limit !== null) {
        const total = await tx.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM gift_code_redemptions
            WHERE gift_code_id = $1 AND status = 'consumed'`,
          [gift.id],
        )
        if ((total.rows[0]?.n ?? 0) >= gift.total_limit) {
          throw this.http(400, GIFT_CODE_TOTAL_LIMIT_REACHED, `Gift code ${code} usage limit reached`)
        }
      }
      if (gift.per_profile_limit !== null) {
        const perProfile = await tx.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM gift_code_redemptions
            WHERE gift_code_id = $1 AND profile_id = $2 AND status = 'consumed'`,
          [gift.id, input.profileId],
        )
        if ((perProfile.rows[0]?.n ?? 0) >= gift.per_profile_limit) {
          throw this.http(
            400,
            GIFT_CODE_PROFILE_LIMIT_REACHED,
            `Gift code ${code} limit reached for this profile`,
          )
        }
      }

      const orderAmount = BigInt(input.orderAmount)
      if (orderAmount < 0n) {
        throw this.http(400, 'GIFT_CODE_INVALID_ORDER', 'orderAmount must be >= 0')
      }
      if (orderAmount < BigInt(gift.min_order_amount)) {
        throw this.http(
          400,
          GIFT_CODE_MIN_ORDER_NOT_MET,
          `Gift code ${code} requires a minimum order of ${gift.min_order_amount} IRR`,
        )
      }
      if (gift.categories.length > 0 && !gift.categories.includes(input.category)) {
        throw this.http(
          400,
          GIFT_CODE_CATEGORY_NOT_ELIGIBLE,
          `Gift code ${code} does not apply to category ${input.category}`,
        )
      }

      const discountAmount = computeGiftDiscount({
        discountType: gift.discount_type,
        discountValue: gift.discount_value,
        maxCapIrr: gift.max_cap_irr,
        orderAmount: input.orderAmount,
      })

      const inserted = await tx.query<RedemptionRow>(
        `INSERT INTO gift_code_redemptions
           (id, gift_code_id, profile_id, order_id, discount_amount, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'consumed', $6)
         RETURNING id, gift_code_id, profile_id, order_id, discount_amount, status, created_at`,
        [uuidv7(), gift.id, input.profileId, input.orderId, discountAmount, new Date()],
      )
      // The ledger row is the primary trace, mirroring the epic's audit
      // posture with a change_recorded event (same executor → commits
      // with the redemption, no out-of-band writes).
      if (input.actorUserId !== undefined) {
        await this.recordChange(tx, {
          actorUserId: input.actorUserId,
          ip: input.ip ?? 'system',
          entity: 'gift_code',
          action: 'redeemed',
          meta: {
            giftCodeId: gift.id,
            code,
            profileId: input.profileId,
            orderId: input.orderId,
            discountAmount,
          },
        })
      }
      this.logger.log(
        `Gift code redeemed: code=${code}, order=${input.orderId}, ` +
          `profile=${input.profileId}, discount=${discountAmount}`,
      )
      return this.toRedemptionDto(inserted.rows[0] as RedemptionRow)
    }

    if (q !== undefined) return run(q)
    return this.withTransaction(run)
  }

  /**
   * Restore gift-code slots when an order is cancelled BEFORE payment
   * (the default policy, T-09.12.03): consumed ledger rows flip to
   * `released` and stop counting against limits. Idempotent — already
   * released rows are untouched. Returns the number of slots restored.
   *
   * When `q` is omitted the service opens its own connection; when a
   * caller-provided executor is passed (the orders module's cancel flow)
   * the caller owns the transaction, so the cancellation and the slot
   * release commit or roll back together — a cancelled order can never
   * permanently leak a consumed slot because its release failed.
   */
  async releaseByOrder(
    orderId: string,
    q?: DbExecutor,
    audit?: { actorUserId: string; ip: string },
  ): Promise<{ released: number }> {
    const run = async (tx: DbExecutor): Promise<{ released: number }> => {
      const result = await tx.query(
        `UPDATE gift_code_redemptions SET status = 'released'
          WHERE order_id = $1 AND status = 'consumed'`,
        [orderId],
      )
      const released = result.rowCount ?? 0
      if (released > 0) {
        if (audit !== undefined) {
          await this.recordChange(tx, {
            actorUserId: audit.actorUserId,
            ip: audit.ip,
            entity: 'gift_code',
            action: 'released',
            meta: { orderId },
          })
        }
        this.logger.log(`Gift code slot(s) released for cancelled order ${orderId}: ${released}`)
      }
      return { released }
    }

    if (q !== undefined) return run(q)
    return this.withTransaction(run)
  }

  private assertEligibility(raw: unknown): GiftCodeEligibility {
    if (!isGiftCodeEligibility(raw)) throw this.invalidField('eligibility')
    return raw
  }

  private assertNormalizedCode(raw: string): string {
    if (typeof raw !== 'string') throw this.invalidField('code')
    const code = normalizeGiftCode(raw)
    if (!GIFT_CODE_PATTERN.test(code)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'GIFT_CODE_INVALID_CODE',
          message:
            'code must be 3-64 characters: letters, digits, dash or underscore (case-insensitive)',
        },
        400,
      )
    }
    return code
  }

  private assertProfileScope(
    eligibility: GiftCodeEligibility,
    profileIds: string[] | undefined,
  ): string[] {
    const ids = [...new Set((profileIds ?? []).map((p) => p.trim()).filter((p) => p.length > 0))]
    for (const id of ids) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw this.invalidField('profileIds')
      }
    }
    if (eligibility === 'profile' && ids.length === 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: GIFT_CODE_PROFILES_REQUIRED,
          message: 'profile-restricted gift codes require at least one profile',
        },
        400,
      )
    }
    return ids
  }

  private assertMinOrderAmount(raw: string): string {
    let value: bigint
    try {
      value = BigInt(String(raw))
    } catch {
      throw this.invalidField('minOrderAmount')
    }
    if (value < 0n) throw this.invalidField('minOrderAmount')
    return value.toString()
  }

  private assertCategories(raw: string[]): string[] {
    if (!Array.isArray(raw)) throw this.invalidField('categories')
    const uniq = [...new Set(raw.map((c) => c.trim()).filter((c) => c.length > 0))]
    if (uniq.some((c) => !GIFT_CODE_CATEGORY_PATTERN.test(c))) throw this.invalidField('categories')
    return uniq
  }

  private async insertProfiles(q: DbExecutor, giftCodeId: string, profileIds: string[]): Promise<void> {
    for (const profileId of profileIds) {
      await q.query(
        'INSERT INTO gift_code_profiles (gift_code_id, profile_id) VALUES ($1, $2)',
        [giftCodeId, profileId],
      )
    }
  }

  private toRedemptionDto(row: RedemptionRow): GiftCodeRedemptionDto {
    return {
      id: row.id,
      giftCodeId: row.gift_code_id,
      profileId: row.profile_id,
      orderId: row.order_id,
      discountAmount: row.discount_amount,
      status: row.status,
      createdAt: row.created_at,
    }
  }

  private toDto(row: GiftCodeWithUsageRow, profileIds: string[]): GiftCodeDto {
    return {
      id: row.id,
      code: row.code,
      discountType: row.discount_type,
      discountValue: row.discount_value,
      maxCapIrr: row.max_cap_irr,
      eligibility: row.eligibility,
      profileIds,
      totalLimit: row.total_limit,
      perProfileLimit: row.per_profile_limit,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      minOrderAmount: row.min_order_amount,
      categories: row.categories,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      usage: {
        consumed: row.consumed,
        released: row.released,
        totalDiscountIrr: row.total_discount,
      } satisfies GiftCodeDto['usage'],
    }
  }

  private async attachProfileIds(rows: GiftCodeWithUsageRow[]): Promise<GiftCodeDto[]> {
    if (rows.length === 0) return []
    const pool = getDbPool()
    const entries = await pool.query<{ gift_code_id: string; profile_id: string }>(
      `SELECT gift_code_id, profile_id FROM gift_code_profiles
        WHERE gift_code_id = ANY($1::uuid[])
        ORDER BY profile_id`,
      [rows.map((r) => r.id)],
    )
    const byCode = new Map<string, string[]>()
    for (const entry of entries.rows) {
      const list = byCode.get(entry.gift_code_id) ?? []
      list.push(entry.profile_id)
      byCode.set(entry.gift_code_id, list)
    }
    return rows.map((row) => this.toDto(row, byCode.get(row.id) ?? []))
  }

  private async findById(q: DbExecutor, id: string): Promise<GiftCodeRow | null> {
    const result = await q.query<GiftCodeRow>(
      `SELECT id, code, discount_type, discount_value, max_cap_irr, eligibility,
              total_limit, per_profile_limit, valid_from, valid_until,
              min_order_amount, categories, status, created_by, created_at, updated_at
         FROM gift_codes
        WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  private async findByIdWithUsage(
    q: DbExecutor,
    id: string,
  ): Promise<GiftCodeWithUsageRow | null> {
    const result = await q.query<GiftCodeWithUsageRow>(
      `SELECT gc.id, gc.code, gc.discount_type, gc.discount_value, gc.max_cap_irr,
              gc.eligibility, gc.total_limit, gc.per_profile_limit,
              gc.valid_from, gc.valid_until, gc.min_order_amount,
              gc.categories, gc.status, gc.created_by, gc.created_at, gc.updated_at,
              COUNT(gcr.id) FILTER (WHERE gcr.status = 'consumed')::int AS consumed,
              COUNT(gcr.id) FILTER (WHERE gcr.status = 'released')::int AS released,
              COALESCE(SUM(gcr.discount_amount) FILTER (WHERE gcr.status = 'consumed'), 0) AS total_discount
         FROM gift_codes gc
         LEFT JOIN gift_code_redemptions gcr ON gcr.gift_code_id = gc.id
        WHERE gc.id = $1
        GROUP BY gc.id`,
      [id],
    )
    return result.rows[0] ?? null
  }

  private async readDto(q: DbExecutor, id: string): Promise<GiftCodeDto> {
    const row = await this.findByIdWithUsage(q, id)
    if (!row) throw this.notFound(id)
    const [dto] = await this.attachProfileIds([row])
    return dto as GiftCodeDto
  }

  private invalidField(field: string): HttpException {
    return new HttpException(
      {
        statusCode: 400,
        error: 'GIFT_CODE_INVALID_FIELD',
        message: `Invalid ${field}`,
      },
      400,
    )
  }

  private notFound(id: string): HttpException {
    return new HttpException(
      {
        statusCode: 404,
        error: GIFT_CODE_NOT_FOUND,
        message: `Gift code ${id} not found`,
      },
      404,
    )
  }

  private alreadyExists(code: string): HttpException {
    return new HttpException(
      {
        statusCode: 409,
        error: GIFT_CODE_ALREADY_EXISTS,
        message: `A gift code with the code ${code} already exists (codes are case-insensitive)`,
      },
      409,
    )
  }

  private http(statusCode: number, error: string, message: string): HttpException {
    return new HttpException({ statusCode, error, message }, statusCode)
  }

  private isPgError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === code
    )
  }

  /** Run `fn` inside a single DB transaction on one client; any error rolls back. */
  private async withTransaction<T>(fn: (q: DbExecutor) => Promise<T>): Promise<T> {
    const client = await getDbPool().connect()
    let committed = false
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      committed = true
      return result
    } catch (error) {
      if (committed) throw error
      await client.query('ROLLBACK').catch(() => {})
      if (this.isPgError(error, PG_UNIQUE_VIOLATION)) {
        // Disambiguate by constraint name: the normalized-code index
        // racing a concurrent create is a duplicate code; the
        // one-redemption-per-order index is a code already applied.
        const constraint = (error as { constraint?: string }).constraint
        if (constraint === 'uq_gift_code_redemptions_order_id') {
          throw new HttpException(
            {
              statusCode: 409,
              error: GIFT_CODE_ALREADY_APPLIED,
              message: 'A gift code has already been applied to this order',
            },
            409,
          )
        }
        throw new HttpException(
          {
            statusCode: 409,
            error: GIFT_CODE_ALREADY_EXISTS,
            message: 'A gift code with this code already exists (codes are case-insensitive)',
          },
          409,
        )
      }
      if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'GIFT_CODE_REFERENCE_MISSING',
            message: 'A referenced profile or order no longer exists',
          },
          409,
        )
      }
      throw error
    } finally {
      client.release()
    }
  }

  /** Record the epic's `change_recorded` audit event. */
  private async recordChange(
    q: DbExecutor,
    input: {
      actorUserId: string
      ip: string
      entity: string
      action: string
      meta: Record<string, unknown>
    },
  ): Promise<void> {
    // Correlate with the originating request when one exists (AsyncLocal
    // Storage set by CorrelationIdMiddleware); fall back to a fresh id.
    const correlationId = this.correlationIdProvider.getCorrelationId() ?? uuidv7()
    await q.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, 'change_recorded', $3::jsonb, $4, $5, $6)`,
      [
        uuidv7(),
        input.actorUserId,
        JSON.stringify({ entity: input.entity, action: input.action, ...input.meta }),
        correlationId,
        input.ip,
        new Date(),
      ],
    )
  }
}
import { Injectable, Logger, HttpException, Inject } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import {
  CHARGE_CATEGORIES,
  isChargeCategory,
  isRateCategory,
  isValidVatBasisPoints,
  PRODUCT_OVERRIDE_CATEGORY,
  resolveVatRate,
  vatWindowStatus,
  type VatConfigDto,
  type VatProductOverrideDto,
  type VatResolution,
} from '@barghsa/shared/finance'
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js'

/**
 * Admin VAT configuration service (S-09.12, T-09.12.02) — API slice.
 *
 * Versioned VAT rates per charge category, with optional per-product
 * overrides. Resolution (T-09.12.02 / T-03.02.05.03): product override
 * wins; otherwise the category's active rate applies; otherwise 0%.
 *
 * Data model (migration 0047):
 * - `vat_configurations` — one row = ONE versioned rate with an
 *   effective window (`effective_from` inclusive, `effective_until`
 *   exclusive; null = open). Rates are never mutated or hard-deleted;
 *   adding a rate appends a row and closes the previously-open one at
 *   the new effective_from (mirroring catalogue price versions). This
 *   preserves complete rate history for invoice-time snapshotting.
 * - `product_vat_overrides` — links a product to a vat_configurations
 *   row while the override window is active. The override's own window
 *   governs applicability; the linked config row's rate is what applies.
 *
 * Every mutation runs in ONE transaction on a single client
 * (BEGIN/COMMIT/ROLLBACK) and records an `audit_log` event named
 * `change_recorded` (the epic's audit contract) with actor, ip, and the
 * change summary.
 *
 * Permission `admin:finance:edit` is enforced at the controller boundary
 * (mapped to platform admin today, per the S-09 convention). The admin
 * web UI slice (table: category/product, rate, effective from, status;
 * add future-effective rate; product override toggle; fa/en dicts,
 * RTL/a11y) is deferred.
 */

// ─── Public types ──────────────────────────────────────────────────────────

export interface CreateVatRateInput {
  /** Charge category key (CHARGE_CATEGORIES). */
  category: string
  /** Rate in basis points (0..10000 = 0%..100%). */
  rateBasisPoints: number
  /** ISO timestamp the rate takes effect (inclusive). Defaults to now. */
  effectiveFrom?: string
  actorUserId: string
  ip: string
}

export interface EndVatRateInput {
  id: string
  /** ISO timestamp the rate stops applying (exclusive). Defaults to now. */
  effectiveUntil?: string
  actorUserId: string
  ip: string
}

export interface CreateProductOverrideInput {
  productId: string
  /** The vat_configurations row whose rate applies to the product. */
  vatConfigId: string
  /** ISO timestamp the override takes effect (inclusive). Defaults to now. */
  effectiveFrom?: string
  actorUserId: string
  ip: string
}

export interface EndProductOverrideInput {
  id: string
  /** ISO timestamp the override stops applying (exclusive). Defaults to now. */
  effectiveUntil?: string
  actorUserId: string
  ip: string
}

export interface ResolveVatInput {
  /** Optional product; when present, an active override wins. */
  productId?: string
  /** Charge category (required when no productId, or as fallback). */
  category?: string
  /** Point in time to resolve at (defaults to now). */
  at?: string
}

// ─── Internal row types ────────────────────────────────────────────────────

type QueryFn = <T = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[]; rowCount: number | null }>

/** Minimal query executor shared by the pool and a transactional client. */
type DbExecutor = { query: QueryFn }

interface VatConfigRow {
  id: string
  category: string
  rate: number
  effective_from: string
  effective_until: string | null
  created_by: string
  created_at: string
  updated_at: string
}

interface VatOverrideRow {
  id: string
  product_id: string
  vat_config_id: string
  rate: number
  category: string
  effective_from: string
  effective_until: string | null
  created_by: string
  created_at: string
  updated_at: string
}

const PG_FOREIGN_KEY_VIOLATION = '23503'
const PG_EXCLUSION_VIOLATION = '23P01'
const PG_CHECK_VIOLATION = '23514'

@Injectable()
export class VatConfigService {
  private readonly logger = new Logger(VatConfigService.name)

  constructor(
    @Inject(CorrelationIdProvider)
    private readonly correlationIdProvider: CorrelationIdProvider,
  ) {}

  // ─── Read ───────────────────────────────────────────────────────────────

  /**
   * List versioned VAT rates, newest first, optionally filtered by
   * category. Each row carries its derived status (current/scheduled/
   * expired) for the admin table view.
   */
  async list(category?: string): Promise<VatConfigDto[]> {
    if (category !== undefined && !isRateCategory(category)) {
      throw this.invalidCategory(category)
    }
    const pool = getDbPool()
    const result = category
      ? await pool.query<VatConfigRow>(
          `SELECT id, category, rate, effective_from, effective_until, created_by,
                  created_at, updated_at
             FROM vat_configurations
            WHERE category = $1
            ORDER BY effective_from DESC, created_at DESC`,
          [category],
        )
      : await pool.query<VatConfigRow>(
          `SELECT id, category, rate, effective_from, effective_until, created_by,
                  created_at, updated_at
             FROM vat_configurations
            ORDER BY effective_from DESC, created_at DESC`,
        )
    return result.rows.map((row) => this.toConfigDto(row))
  }

  /** List product overrides with the linked rate/category denormalized. */
  async listOverrides(): Promise<VatProductOverrideDto[]> {
    const pool = getDbPool()
    const result = await pool.query<VatOverrideRow>(
      `SELECT pvo.id, pvo.product_id, pvo.vat_config_id,
              vc.rate, vc.category,
              pvo.effective_from, pvo.effective_until,
              pvo.created_by, pvo.created_at, pvo.updated_at
         FROM product_vat_overrides pvo
         JOIN vat_configurations vc ON vc.id = pvo.vat_config_id
        ORDER BY pvo.effective_from DESC, pvo.created_at DESC`,
    )
    return result.rows.map((row) => this.toOverrideDto(row))
  }

  /**
   * Resolve the VAT rate at a point in time (the invoice snapshot seam,
   * T-03.02.05.03, will call this at invoice-line creation time).
   *
   * Rules (T-09.12.02 / T-03.02.05.03):
   *   1. product has an active override  → the override's rate
   *   2. charge category has an active rate → the category rate
   *   3. otherwise                        → 0% (fallback)
   *
   * When `productId` is given, the product's own charge category is
   * derived from `products.type` (its product-type discriminator) and
   * used as the category fallback — so a caller can pass just the
   * product and still get the category default (the middle rule) when
   * no override is active. An explicit `category` argument overrides
   * the derived one.
   */
  async resolve(input: ResolveVatInput): Promise<VatResolution> {
    const at = input.at !== undefined ? new Date(input.at) : new Date()
    if (Number.isNaN(at.getTime())) {
      throw this.invalidEffectiveDate('at')
    }
    const pool = getDbPool()

    let productOverrideRate: number | null = null
    let derivedCategory: string | undefined
    if (input.productId !== undefined) {
      // Derive the product's charge category from its type, so the
      // category-default rule is reachable with productId alone.
      const product = await pool.query<{ type: string }>(
        'SELECT type FROM products WHERE id = $1',
        [input.productId],
      )
      if (product.rows.length > 0 && product.rows[0] !== undefined) {
        derivedCategory = product.rows[0].type
      }
      // Only the override's own window governs: the linked config row is
      // versioned (its effective window records when the rate came into
      // force), but the override link is what the admin actively manages.
      const override = await pool.query<{ rate: number }>(
        `SELECT vc.rate
           FROM product_vat_overrides pvo
           JOIN vat_configurations vc ON vc.id = pvo.vat_config_id
          WHERE pvo.product_id = $1
            AND pvo.effective_from <= $2
            AND (pvo.effective_until IS NULL OR pvo.effective_until > $2)
          ORDER BY pvo.effective_from DESC
          LIMIT 1`,
        [input.productId, at],
      )
      productOverrideRate = override.rows[0]?.rate ?? null
    }

    let categoryRate: number | null = null
    const category = input.category ?? derivedCategory
    if (category !== undefined) {
      if (!isChargeCategory(category)) {
        throw this.invalidCategory(category)
      }
      const config = await pool.query<{ rate: number }>(
        `SELECT rate
           FROM vat_configurations
          WHERE category = $1
            AND effective_from <= $2
            AND (effective_until IS NULL OR effective_until > $2)
          ORDER BY effective_from DESC
          LIMIT 1`,
        [category, at],
      )
      categoryRate = config.rows[0]?.rate ?? null
    }

    return resolveVatRate(productOverrideRate, categoryRate)
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  /**
   * Record a new versioned category rate. The previously-open rate for
   * the same category is closed at the new effective_from, so the
   * windows stay contiguous. A re-submit of the currently-open rate is
   * a no-op (no audit). Future-dated rates are allowed — they become
   * `scheduled` until their effective_from arrives.
   */
  async createRate(input: CreateVatRateInput): Promise<VatConfigDto> {
    if (!isRateCategory(input.category)) {
      throw this.invalidCategory(input.category)
    }
    if (!isValidVatBasisPoints(input.rateBasisPoints)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'VAT_RATE_INVALID',
          message: 'VAT rate must be an integer in basis points between 0 and 10000 (0%..100%)',
        },
        400,
      )
    }
    const effectiveFrom =
      input.effectiveFrom !== undefined ? new Date(input.effectiveFrom) : new Date()
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw this.invalidEffectiveDate('effectiveFrom')
    }

    return this.withTransaction(async (q) => {
      const open = await this.findOpenRate(q, input.category)
      if (open !== null) {
        const openFrom = new Date(open.effective_from)
        if (open.rate === input.rateBasisPoints) {
          // No-op: the same rate is already open — no version records a
          // non-change (mirrors catalogue price no-op discipline).
          return this.readConfig(q, open.id)
        }
        if (effectiveFrom.getTime() <= openFrom.getTime()) {
          throw new HttpException(
            {
              statusCode: 400,
              error: 'VAT_RATE_INVALID_EFFECTIVE_FROM',
              message:
                'A new VAT rate must take effect strictly after the currently ' +
                'open rate (active since ' + open.effective_from + ')',
            },
            400,
          )
        }
        // Close the previous open rate at the new effective_from.
        await q.query(
          `UPDATE vat_configurations
              SET effective_until = $1, updated_at = NOW()
            WHERE id = $2 AND effective_until IS NULL`,
          [effectiveFrom, open.id],
        )
      } else {
        // No open rate: the new open row must not overlap any already
        // ended window. The DB EXCLUDE constraint would reject it as
        // 23P01; pre-validate here so a mis-dated (e.g. backdated after
        // an end-date) request surfaces as an actionable 400.
        const conflict = await q.query<{ id: string; effective_from: string; effective_until: string | null }>(
          `SELECT id, effective_from, effective_until
             FROM vat_configurations
            WHERE category = $1
              AND effective_from <= $2
              AND (effective_until IS NULL OR effective_until > $2)
            LIMIT 1`,
          [input.category, effectiveFrom],
        )
        if (conflict.rows.length > 0) {
          const row = conflict.rows[0]
          if (row !== undefined) {
            throw new HttpException(
              {
                statusCode: 400,
                error: 'VAT_RATE_INVALID_EFFECTIVE_FROM',
                message:
                  'The requested effective_from falls inside an existing rate window ' +
                  `(id ${row.id}: ${row.effective_from}${row.effective_until ? ' -> ' + row.effective_until : ' (open)'})`,
              },
              400,
            )
          }
        }
      }

      const id = uuidv7()
      await q.query(
        `INSERT INTO vat_configurations
           (id, category, rate, effective_from, effective_until, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $6)`,
        [id, input.category, input.rateBasisPoints, effectiveFrom, input.actorUserId, new Date()],
      )
      await this.recordChange(q, {
        actorUserId: input.actorUserId,
        ip: input.ip,
        entity: 'vat_configuration',
        action: 'created',
        meta: {
          vatConfigId: id,
          category: input.category,
          rateBasisPoints: input.rateBasisPoints,
          effectiveFrom: effectiveFrom.toISOString(),
          ...(open !== null ? { closedVatConfigId: open.id } : {}),
        },
      })
      this.logger.log(
        `VAT rate created: id=${id}, category=${input.category}, ` +
          `rate=${input.rateBasisPoints}bps, effectiveFrom=${effectiveFrom.toISOString()}, actor=${input.actorUserId}`,
      )
      return this.readConfig(q, id)
    })
  }

  /**
   * End-date a rate (soft close — rates are never hard-deleted).
   * Ending the currently-open rate closes its window; ending an
   * already-ended rate is a no-op (no audit).
   */
  async endRate(input: EndVatRateInput): Promise<VatConfigDto> {
    const effectiveUntil =
      input.effectiveUntil !== undefined ? new Date(input.effectiveUntil) : new Date()
    if (Number.isNaN(effectiveUntil.getTime())) {
      throw this.invalidEffectiveDate('effectiveUntil')
    }

    return this.withTransaction(async (q) => {
      const current = await this.findConfigById(q, input.id)
      if (!current) throw this.vatConfigNotFound(input.id)

      if (current.effective_until !== null) {
        // Already ended — no write, no audit.
        return this.toConfigDto(current)
      }

      const from = new Date(current.effective_from)
      if (effectiveUntil.getTime() <= from.getTime()) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'VAT_RATE_INVALID_EFFECTIVE_UNTIL',
            message:
              'effectiveUntil must be strictly after the rate\'s effective_from (' +
              current.effective_from + ')',
          },
          400,
        )
      }

      await q.query(
        `UPDATE vat_configurations
            SET effective_until = $1, updated_at = NOW()
          WHERE id = $2 AND effective_until IS NULL`,
        [effectiveUntil, input.id],
      )
      await this.recordChange(q, {
        actorUserId: input.actorUserId,
        ip: input.ip,
        entity: 'vat_configuration',
        action: 'ended',
        meta: {
          vatConfigId: input.id,
          category: current.category,
          rateBasisPoints: current.rate,
          effectiveFrom: current.effective_from,
          effectiveUntil: effectiveUntil.toISOString(),
        },
      })
      this.logger.log(
        `VAT rate ended: id=${input.id}, until=${effectiveUntil.toISOString()}, actor=${input.actorUserId}`,
      )
      return this.readConfig(q, input.id)
    })
  }

  /**
   * Create a product VAT override: while active, the product uses the
   * linked config row's rate instead of its category default. The
   * previously-open override for the product is closed at the new
   * effective_from. A re-submit of the same open override is a no-op.
   *
   * The linked config must be an override-eligible rate: either a row
   * with the reserved `product_override` category (a product-specific
   * rate) or an active category default. Linking an ended or
   * never-active category row is rejected — the admin must end-date /
   * create rates explicitly.
   */
  async createProductOverride(input: CreateProductOverrideInput): Promise<VatProductOverrideDto> {
    const effectiveFrom =
      input.effectiveFrom !== undefined ? new Date(input.effectiveFrom) : new Date()
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw this.invalidEffectiveDate('effectiveFrom')
    }

    return this.withTransaction(async (q) => {
      // The config row must exist and be override-eligible.
      const config = await this.findConfigById(q, input.vatConfigId)
      if (!config) throw this.vatConfigNotFound(input.vatConfigId)

      const isProductSpecific = config.category === PRODUCT_OVERRIDE_CATEGORY
      const configEnded =
        config.effective_until !== null &&
        new Date(config.effective_until).getTime() <= effectiveFrom.getTime()
      const configScheduled = new Date(config.effective_from).getTime() > effectiveFrom.getTime()
      if (!isProductSpecific && (configEnded || configScheduled)) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'VAT_OVERRIDE_CONFIG_INACTIVE',
            message:
              'The linked VAT rate must be active at the override\'s effective_from ' +
              '(link a product_override rate or an active category rate)',
          },
          400,
        )
      }
      // A product_override rate row must itself be active (or scheduled)
      // at the override's start — its window is the rate's own validity.
      if (isProductSpecific && configEnded) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'VAT_OVERRIDE_CONFIG_INACTIVE',
            message:
              'The linked product_override rate is already ended — create a new rate first',
          },
          400,
        )
      }

      const open = await this.findOpenOverride(q, input.productId)
      if (open !== null) {
        const openFrom = new Date(open.effective_from)
        if (open.vat_config_id === input.vatConfigId) {
          // No-op: the same override is already open.
          return this.readOverride(q, open.id)
        }
        if (effectiveFrom.getTime() <= openFrom.getTime()) {
          throw new HttpException(
            {
              statusCode: 400,
              error: 'VAT_OVERRIDE_INVALID_EFFECTIVE_FROM',
              message:
                'A new override must take effect strictly after the currently ' +
                'open override (active since ' + open.effective_from + ')',
            },
            400,
          )
        }
        await q.query(
          `UPDATE product_vat_overrides
              SET effective_until = $1, updated_at = NOW()
            WHERE id = $2 AND effective_until IS NULL`,
          [effectiveFrom, open.id],
        )
      }

      const id = uuidv7()
      await q.query(
        `INSERT INTO product_vat_overrides
           (id, product_id, vat_config_id, effective_from, effective_until, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $6)`,
        [id, input.productId, input.vatConfigId, effectiveFrom, input.actorUserId, new Date()],
      )
      await this.recordChange(q, {
        actorUserId: input.actorUserId,
        ip: input.ip,
        entity: 'vat_product_override',
        action: 'created',
        meta: {
          overrideId: id,
          productId: input.productId,
          vatConfigId: input.vatConfigId,
          rateBasisPoints: config.rate,
          effectiveFrom: effectiveFrom.toISOString(),
          ...(open !== null ? { closedOverrideId: open.id } : {}),
        },
      })
      this.logger.log(
        `VAT product override created: id=${id}, product=${input.productId}, ` +
          `vatConfig=${input.vatConfigId}, actor=${input.actorUserId}`,
      )
      return this.readOverride(q, id)
    })
  }

  /**
   * End-date a product override (soft close). Ending an already-ended
   * override is a no-op. FK races (product deleted concurrently) surface
   * as 409.
   */
  async endProductOverride(input: EndProductOverrideInput): Promise<VatProductOverrideDto> {
    const effectiveUntil =
      input.effectiveUntil !== undefined ? new Date(input.effectiveUntil) : new Date()
    if (Number.isNaN(effectiveUntil.getTime())) {
      throw this.invalidEffectiveDate('effectiveUntil')
    }

    return this.withTransaction(async (q) => {
      const current = await this.findOverrideById(q, input.id)
      if (!current) throw this.overrideNotFound(input.id)

      if (current.effective_until !== null) {
        return this.readOverride(q, input.id)
      }

      const from = new Date(current.effective_from)
      if (effectiveUntil.getTime() <= from.getTime()) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'VAT_OVERRIDE_INVALID_EFFECTIVE_UNTIL',
            message:
              'effectiveUntil must be strictly after the override\'s effective_from (' +
              current.effective_from + ')',
          },
          400,
        )
      }

      await q.query(
        `UPDATE product_vat_overrides
            SET effective_until = $1, updated_at = NOW()
          WHERE id = $2 AND effective_until IS NULL`,
        [effectiveUntil, input.id],
      )
      await this.recordChange(q, {
        actorUserId: input.actorUserId,
        ip: input.ip,
        entity: 'vat_product_override',
        action: 'ended',
        meta: {
          overrideId: input.id,
          productId: current.product_id,
          vatConfigId: current.vat_config_id,
          effectiveUntil: effectiveUntil.toISOString(),
        },
      })
      this.logger.log(
        `VAT product override ended: id=${input.id}, until=${effectiveUntil.toISOString()}, actor=${input.actorUserId}`,
      )
      return this.readOverride(q, input.id)
    })
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private toConfigDto(row: VatConfigRow): VatConfigDto {
    return {
      id: row.id,
      category: row.category,
      rateBasisPoints: row.rate,
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until ?? null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: vatWindowStatus(row.effective_from, row.effective_until),
    }
  }

  private toOverrideDto(row: VatOverrideRow): VatProductOverrideDto {
    return {
      id: row.id,
      productId: row.product_id,
      vatConfigId: row.vat_config_id,
      rateBasisPoints: row.rate,
      category: row.category,
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until ?? null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private async findOpenRate(q: DbExecutor, category: string): Promise<VatConfigRow | null> {
    const result = await q.query<VatConfigRow>(
      `SELECT id, category, rate, effective_from, effective_until, created_by, created_at, updated_at
         FROM vat_configurations
        WHERE category = $1 AND effective_until IS NULL
        ORDER BY effective_from DESC
        LIMIT 1`,
      [category],
    )
    return result.rows[0] ?? null
  }

  private async findConfigById(q: DbExecutor, id: string): Promise<VatConfigRow | null> {
    const result = await q.query<VatConfigRow>(
      `SELECT id, category, rate, effective_from, effective_until, created_by, created_at, updated_at
         FROM vat_configurations
        WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  private async findOpenOverride(q: DbExecutor, productId: string): Promise<VatOverrideRow | null> {
    const result = await q.query<VatOverrideRow>(
      `SELECT pvo.id, pvo.product_id, pvo.vat_config_id,
              vc.rate, vc.category,
              pvo.effective_from, pvo.effective_until,
              pvo.created_by, pvo.created_at, pvo.updated_at
         FROM product_vat_overrides pvo
         JOIN vat_configurations vc ON vc.id = pvo.vat_config_id
        WHERE pvo.product_id = $1 AND pvo.effective_until IS NULL
        ORDER BY pvo.effective_from DESC
        LIMIT 1`,
      [productId],
    )
    return result.rows[0] ?? null
  }

  private async findOverrideById(q: DbExecutor, id: string): Promise<VatOverrideRow | null> {
    const result = await q.query<VatOverrideRow>(
      `SELECT pvo.id, pvo.product_id, pvo.vat_config_id,
              vc.rate, vc.category,
              pvo.effective_from, pvo.effective_until,
              pvo.created_by, pvo.created_at, pvo.updated_at
         FROM product_vat_overrides pvo
         JOIN vat_configurations vc ON vc.id = pvo.vat_config_id
        WHERE pvo.id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  /** Re-read a config after a mutation. */
  private async readConfig(q: DbExecutor, id: string): Promise<VatConfigDto> {
    const row = await this.findConfigById(q, id)
    if (!row) throw this.vatConfigNotFound(id)
    return this.toConfigDto(row)
  }

  /** Re-read an override after a mutation. */
  private async readOverride(q: DbExecutor, id: string): Promise<VatProductOverrideDto> {
    const row = await this.findOverrideById(q, id)
    if (!row) throw this.overrideNotFound(id)
    return this.toOverrideDto(row)
  }

  private invalidCategory(category: string): HttpException {
    return new HttpException(
      {
        statusCode: 400,
        error: 'VAT_CATEGORY_INVALID',
        message:
          `Invalid VAT charge category: ${category}. ` +
          `Expected one of: ${[...CHARGE_CATEGORIES, PRODUCT_OVERRIDE_CATEGORY].join(', ')}`,
      },
      400,
    )
  }

  private invalidEffectiveDate(field: string): HttpException {
    return new HttpException(
      {
        statusCode: 400,
        error: 'VAT_INVALID_DATE',
        message: `Invalid ${field}: expected an ISO-8601 timestamp`,
      },
      400,
    )
  }

  private vatConfigNotFound(id: string): HttpException {
    return new HttpException(
      {
        statusCode: 404,
        error: 'VAT_CONFIG_NOT_FOUND',
        message: `VAT configuration ${id} not found`,
      },
      404,
    )
  }

  private overrideNotFound(id: string): HttpException {
    return new HttpException(
      {
        statusCode: 404,
        error: 'VAT_OVERRIDE_NOT_FOUND',
        message: `VAT product override ${id} not found`,
      },
      404,
    )
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
      // Translate DB races into clean HTTP errors where safe.
      if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'VAT_REFERENCE_MISSING',
            message: 'A referenced product or VAT configuration no longer exists',
          },
          409,
        )
      }
      if (this.isPgError(error, PG_EXCLUSION_VIOLATION) || this.isPgError(error, PG_CHECK_VIOLATION)) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'VAT_WINDOW_OVERLAP',
            message:
              'The requested effective window overlaps an existing VAT rate or override',
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

// Re-export for consumers that only need the category list.
export { CHARGE_CATEGORIES }

import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'

/**
 * Admin product catalogue service (S-09.12, T-09.12.01) — API slice.
 *
 * The DB layer (products, product_price_versions, product_categories,
 * electricity_product_limits + the system-product protection triggers)
 * landed with S-03.01; this service is the admin management surface on
 * top of it:
 *
 * - Product CRUD per type (`consultation`, `electricity`, `hardware`,
 *   `saving_plan`). Type-specific fields: categories for consultation
 *   and electricity products, min/max kWh limits for electricity. The
 *   four system electricity products (system_key set) are immutable
 *   fixtures: they cannot be created, archived, or have type/system_key
 *   changed (also enforced by DB triggers from T-03.01.02.04).
 * - `DELETE` only archives (status -> archived). A hard delete is never
 *   issued: products referenced by orders are protected by the FK
 *   (ON DELETE RESTRICT) — archive is the only removal path.
 * - Versioned price changes with effective dates. Every price change
 *   appends a `product_price_versions` row (new version starts at the
 *   requested effective_from, previous open version is closed there);
 *   `products.price` mirrors the newest version. An identical re-submit
 *   is a no-op that emits no audit.
 * - Every mutation runs in ONE database transaction on a single client
 *   (BEGIN/COMMIT/ROLLBACK) and records an `audit_log` event with
 *   actor, ip, and change summary.
 *
 * Permission `admin:catalogue:edit` is enforced at the controller
 * boundary (mapped to platform admin today, per the S-09 convention).
 * The tabbed admin web UI (list/add/edit per type, price history view,
 * fa/en dictionaries, RTL/a11y) is a later UI slice.
 */

// ─── Public types ──────────────────────────────────────────────────────────

export const PRODUCT_TYPES = ['consultation', 'electricity', 'hardware', 'saving_plan'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const PRODUCT_STATUSES = ['active', 'inactive', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

/** Consultation categories (consultation-type products only). */
export const CONSULTATION_CATEGORIES = [
  'electricity_generation_station_consultation',
  'electricity_saving_certificate_consultation',
] as const

/** Electricity categories (electricity-type products only). */
export const ELECTRICITY_CATEGORIES = [
  'thermal_electricity',
  'green_electricity',
  'free_market_electricity',
  'energy_saving_electricity',
] as const

export type ProductCategory =
  | (typeof CONSULTATION_CATEGORIES)[number]
  | (typeof ELECTRICITY_CATEGORIES)[number]

/** Category set allowed per product type. */
const CATEGORIES_BY_TYPE: Record<ProductType, readonly ProductCategory[]> = {
  consultation: CONSULTATION_CATEGORIES,
  electricity: ELECTRICITY_CATEGORIES,
  hardware: [],
  saving_plan: [],
}

/** Localized text bundle (Persian + English). */
export interface LocalizedText {
  fa: string
  en: string
}

/** A product as rendered in admin list/detail views. */
export interface ProductDto {
  id: string
  type: ProductType
  /** Immutable identifier of system products; null for admin-created ones. */
  systemKey: string | null
  title: LocalizedText
  description: LocalizedText | null
  /** Current price in IRR (bigint as string), or null when unset. */
  price: string | null
  status: ProductStatus
  categories: ProductCategory[]
  /** Present only for electricity products with configured limits. */
  electricityLimits: { minKwh: string; maxKwh: string } | null
  createdAt: string
  updatedAt: string
}

/** One price-version history entry. */
export interface PriceVersionDto {
  id: string
  price: string
  effectiveFrom: string
  /** Null while this version is the active one. */
  effectiveUntil: string | null
  createdBy: string
  createdAt: string
}

/** Product detail: full record + versioned price history. */
export interface ProductDetailDto extends ProductDto {
  priceHistory: PriceVersionDto[]
}

// ─── Mutation inputs ───────────────────────────────────────────────────────

export interface CreateProductInput {
  type: Exclude<ProductType, 'electricity'>
  title: LocalizedText
  description: LocalizedText | null
  /** Initial price in IRR; seeds the first price version when set. */
  price: string | null
  status: 'active' | 'inactive'
  categories: ProductCategory[]
  actorUserId: string
  ip: string
}

export interface UpdateProductInput {
  title?: LocalizedText
  description?: LocalizedText | null
  status?: 'active' | 'inactive'
  /** Full-set replace semantics (like the AI agent link sets). */
  categories?: ProductCategory[]
  /** Omit to leave untouched; electricity products only. */
  minKwh?: string
  maxKwh?: string
  actorUserId: string
  ip: string
}

export interface AddPriceInput {
  productId: string
  /** New price in IRR (bigint as string). */
  price: string
  /** ISO timestamp the new price takes effect (tagged-timestamptz). */
  effectiveFrom: string
  actorUserId: string
  ip: string
}

// ─── Internal types ────────────────────────────────────────────────────────

/** Minimal query executor shared by the pool and a transactional client. */
type DbExecutor = { query: QueryFn }
type QueryFn = <T = DbRow>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[]; rowCount: number | null }>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = any

/** A product row as stored in `products`. */
interface ProductRow {
  id: string
  type: ProductType
  system_key: string | null
  title: LocalizedText
  description: LocalizedText | null
  price: string | null
  status: ProductStatus
  created_at: string
  updated_at: string
}

interface PriceVersionRow {
  id: string
  price: string
  effective_from: string
  effective_until: string | null
  created_by: string
  created_at: string
}

interface CategoryRow {
  product_id: string
  category: ProductCategory
}

interface LimitsRow {
  product_id: string
  min_kwh: string
  max_kwh: string
}

/** A product row plus its fetch-time aggregates (categories, limits). */
interface ProductRowWithAggregates extends ProductRow {
  categories: ProductCategory[]
  /** Only for electricity-type products. */
  electricityLimits: { minKwh: string; maxKwh: string } | null
}

const PG_FOREIGN_KEY_VIOLATION = '23503'
const PG_EXCLUSION_VIOLATION = '23P01'

@Injectable()
export class CatalogueProductsService {
  private readonly logger = new Logger(CatalogueProductsService.name)

  // ─── Read ───────────────────────────────────────────────────────────────

  /**
   * List products, optionally filtered by type. Archived products are
   * included so the admin can see and restore them.
   */
  async list(type?: ProductType): Promise<ProductDto[]> {
    const pool = getDbPool()
    const rows = type
      ? await pool.query<ProductRow>(
          'SELECT * FROM products WHERE type = $1 ORDER BY created_at DESC, id',
          [type],
        )
      : await pool.query<ProductRow>('SELECT * FROM products ORDER BY created_at DESC, id')

    const withAggregates = await this.loadAggregates(pool, rows.rows)
    return withAggregates.map((row) => this.toDto(row))
  }

  /** Fetch one product with its versioned price history. */
  async get(id: string): Promise<ProductDetailDto> {
    const pool = getDbPool()
    const product = await this.findProduct(pool, id)
    if (!product) throw this.productNotFound(id)

    const [withAggregates, history] = await Promise.all([
      this.loadAggregates(pool, [product]),
      this.loadPriceHistory(pool, id),
    ])

    return {
      ...this.toDto(withAggregates[0]!),
      priceHistory: history.map((row) => this.toHistoryDto(row)),
    }
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  /**
   * Create a product. Type-specific validation:
   * - `electricity` products are the four immutable system fixtures — the
   *   API rejects creating additional electricity products (T-03.01.02.04).
   * - categories are only valid for consultation/electricity types (and
   *   electricity cannot be created here, so effectively consultation).
   * An optional initial `price` seeds the first price version (effective
   * immediately) and sets the current price.
   *
   * `minKwh`/`maxKwh` limits are intentionally NOT part of create: the
   * API cannot create electricity products, and limits only apply to
   * electricity — they arrive through `update`.
   */
  create(input: CreateProductInput): Promise<ProductDetailDto> {
    return this.withTransaction(async (q) => {
      const id = uuidv7()
      this.assertCategorySetForType(input.type, input.categories)

      const now = new Date()
      await q.query(
        `INSERT INTO products (id, type, system_key, title, description, price, status, created_at, updated_at)
         VALUES ($1, $2, NULL, $3::jsonb, $4::jsonb, $5, $6, $7, $7)`,
        [
          id,
          input.type,
          JSON.stringify(input.title),
          input.description === null ? null : JSON.stringify(input.description),
          input.price,
          input.status,
          now,
        ],
      )

      if (input.categories.length > 0) {
        await this.insertCategories(q, id, input.categories)
      }

      // Initial price seeds the first versioned price record.
      if (input.price !== null) {
        await this.insertPriceVersion(q, {
          productId: id,
          price: input.price,
          effectiveFrom: now.toISOString(),
          actorUserId: input.actorUserId,
        })
      }

      await this.recordAudit(q, 'catalogue_product_created', input.actorUserId, input.ip, {
        productId: id,
        type: input.type,
        title: input.title,
        status: input.status,
        ...(input.price !== null ? { initialPrice: input.price } : {}),
      })
      this.logger.log(
        `Catalogue product created: id=${id}, type=${input.type}, actor=${input.actorUserId}`,
      )

      return this.readDetail(q, id)
    })
  }

  /**
   * Update mutable product fields. `type` and `system_key` are never
   * changeable (the schema omits them; DB triggers pin them). Categories
   * use full-set replace semantics for the admin form; electricity
   * limits upsert for electricity-type products. A request that changes
   * nothing emits no audit (no-op discipline).
   */
  update(id: string, input: UpdateProductInput): Promise<ProductDetailDto> {
    return this.withTransaction(async (q) => {
      const current = await this.findProduct(q, id)
      if (!current) throw this.productNotFound(id)

      // Load current aggregate values so the no-op diff is exact.
      const [aggregates, currentLimits] = await Promise.all([
        this.loadAggregates(q, [current]),
        this.findLimits(q, id),
      ])
      const currentCategories = aggregates[0]!.categories

      const titleChanged =
        input.title !== undefined &&
        JSON.stringify(input.title) !== JSON.stringify(current.title)
      const descriptionChanged =
        input.description !== undefined &&
        JSON.stringify(input.description) !== JSON.stringify(current.description)
      const statusChanged = input.status !== undefined && input.status !== current.status
      const minChanged =
        input.minKwh !== undefined &&
        String(input.minKwh) !== String(currentLimits?.min_kwh ?? null)
      const maxChanged =
        input.maxKwh !== undefined &&
        String(input.maxKwh) !== String(currentLimits?.max_kwh ?? null)
      const limitsChanged = minChanged || maxChanged
      const categoriesChanged =
        input.categories !== undefined &&
        JSON.stringify([...input.categories].sort()) !==
          JSON.stringify([...currentCategories].sort())

      // Electricity consumption limits only apply to electricity products.
      if (
        current.type !== 'electricity' &&
        (input.minKwh !== undefined || input.maxKwh !== undefined)
      ) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'CATALOGUE_LIMITS_NOT_ALLOWED',
            message: `Electricity consumption limits only apply to electricity products`,
          },
          400,
        )
      }

      // Merge partial limit updates against the current row (when one exists)
      // and validate the MERGED pair — never just the requested values — so a
      // partial write cannot produce an invalid min/max combination.
      let mergedLimits: { minKwh: string; maxKwh: string } | null = null
      if (current.type === 'electricity' && (input.minKwh !== undefined || input.maxKwh !== undefined)) {
        if (currentLimits === null) {
          if (input.minKwh === undefined || input.maxKwh === undefined) {
            throw new HttpException(
              {
                statusCode: 400,
                error: 'CATALOGUE_LIMITS_INVALID',
                message:
                  'Both minKwh and maxKwh are required to set electricity limits ' +
                  'on a product that has none yet',
              },
              400,
            )
          }
          mergedLimits = { minKwh: input.minKwh, maxKwh: input.maxKwh }
        } else {
          mergedLimits = {
            minKwh: input.minKwh ?? String(currentLimits.min_kwh),
            maxKwh: input.maxKwh ?? String(currentLimits.max_kwh),
          }
        }
        this.assertLimits(current.type, mergedLimits.minKwh, mergedLimits.maxKwh)
      }

      if (
        input.title === undefined &&
        input.description === undefined &&
        input.status === undefined &&
        input.categories === undefined &&
        input.minKwh === undefined &&
        input.maxKwh === undefined
      ) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'CATALOGUE_UPDATE_EMPTY',
            message: 'At least one field must be provided',
          },
          400,
        )
      }

      // No-op: identical re-submit — no writes, no audit.
      if (
        !titleChanged &&
        !descriptionChanged &&
        !statusChanged &&
        !limitsChanged &&
        !categoriesChanged
      ) {
        return this.readDetail(q, id)
      }

      const sets: string[] = []
      const values: unknown[] = []
      let param = 1
      const push = (col: string, value: unknown) => {
        sets.push(`${col} = $${param++}`)
        values.push(value)
      }

      if (input.title !== undefined) {
        push('title', JSON.stringify(input.title))
      }
      if (input.description !== undefined) {
        push(
          'description',
          input.description === null ? null : JSON.stringify(input.description),
        )
      }
      if (input.status !== undefined) {
        push('status', input.status)
      }
      // Always refresh the audit timestamp on mutation (belt-and-braces even
      // where a DB touch trigger exists).
      sets.push(`updated_at = NOW()`)
      if (sets.length > 0) {
        await q.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${param}`, [
          ...values,
          id,
        ])
      }

      if (input.categories !== undefined) {
        await q.query('DELETE FROM product_categories WHERE product_id = $1', [id])
        if (input.categories.length > 0) {
          await this.insertCategories(q, id, input.categories)
        }
      }

      if (current.type === 'electricity' && mergedLimits !== null) {
        await this.upsertElectricityLimits(q, id, mergedLimits.minKwh, mergedLimits.maxKwh)
      }

      await this.recordAudit(q, 'catalogue_product_updated', input.actorUserId, input.ip, {
        productId: id,
        ...(titleChanged ? { title: input.title } : {}),
        ...(descriptionChanged ? { description: input.description } : {}),
        ...(statusChanged ? { statusBefore: current.status, statusAfter: input.status } : {}),
        ...(limitsChanged
          ? {
              limits: {
                minKwhBefore: currentLimits?.min_kwh ?? null,
                maxKwhBefore: currentLimits?.max_kwh ?? null,
                minKwhAfter: mergedLimits?.minKwh ?? null,
                maxKwhAfter: mergedLimits?.maxKwh ?? null,
              },
            }
          : {}),
        ...(categoriesChanged ? { categories: input.categories } : {}),
      })
      this.logger.log(`Catalogue product updated: id=${id}, actor=${input.actorUserId}`)

      return this.readDetail(q, id)
    })
  }

  /**
   * Archive a product (soft delete). A hard delete is never issued —
   * products referenced by orders are FK-protected and must stay
   * referenceable. System products (system_key set) cannot be archived.
   * Archiving an already-archived product is a no-op (no audit).
   */
  archive(id: string, actorUserId: string, ip: string): Promise<void> {
    return this.withTransaction(async (q) => {
      const current = await this.findProduct(q, id)
      if (!current) throw this.productNotFound(id)

      if (current.system_key !== null) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'CATALOGUE_SYSTEM_PRODUCT_IMMUTABLE',
            message: `System product ${current.system_key} cannot be archived`,
          },
          400,
        )
      }

      if (current.status === 'archived') {
        // Already archived — no write, no audit.
        return
      }

      await q.query('UPDATE products SET status = $1, updated_at = NOW() WHERE id = $2', [
        'archived',
        id,
      ])
      await this.recordAudit(q, 'catalogue_product_archived', actorUserId, ip, {
        productId: id,
        type: current.type,
        statusBefore: current.status,
        statusAfter: 'archived',
      })
      this.logger.log(`Catalogue product archived: id=${id}, actor=${actorUserId}`)
    })
  }

  /**
   * Add a versioned price change with an effective date. Closes the
   * previously-open version at `effectiveFrom` and appends the new one;
   * `products.price` mirrors the newest version. A re-submit of the
   * currently-active price is a no-op (no audit).
   *
   * Overlap safety: the DB EXCLUDE constraint (migration 0015) rejects
   * overlapping effective periods; the service validates ordering up
   * front so a mis-dated price surfaces as a 400, and a concurrent
   * product delete (FK race) surfaces as a 409.
   */
  addPrice(input: AddPriceInput): Promise<ProductDetailDto> {
    return this.withTransaction(async (q) => {
      const current = await this.findProduct(q, input.productId)
      if (!current) throw this.productNotFound(input.productId)

      let changed: boolean
      try {
        changed = await this.insertPriceVersion(q, {
          productId: input.productId,
          price: input.price,
          effectiveFrom: input.effectiveFrom,
          actorUserId: input.actorUserId,
        })
      } catch (error) {
        if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
          // Race: product deleted between the existence check and the insert.
          throw new HttpException(
            {
              statusCode: 409,
              error: 'CATALOGUE_PRICE_ADD_FAILED',
              message: 'The product no longer exists',
            },
            409,
          )
        }
        if (this.isPgError(error, PG_EXCLUSION_VIOLATION)) {
          // Race: a concurrent price change claimed the same effective window,
          // or the requested window overlaps an existing version (23P01 from
          // the EXCLUDE constraint in migration 0015). Surface a clean 409.
          throw new HttpException(
            {
              statusCode: 409,
              error: 'CATALOGUE_PRICE_OVERLAP',
              message:
                'The requested effective window overlaps an existing price version',
            },
            409,
          )
        }
        throw error
      }

      // No-op: identical re-submit of the active price — no audit.
      if (!changed) {
        return this.readDetail(q, input.productId)
      }

      await this.recordAudit(q, 'catalogue_product_price_changed', input.actorUserId, input.ip, {
        productId: input.productId,
        price: input.price,
        effectiveFrom: input.effectiveFrom,
      })
      this.logger.log(
        `Catalogue product price changed: id=${input.productId}, ` +
          `price=${input.price}, effectiveFrom=${input.effectiveFrom}, actor=${input.actorUserId}`,
      )

      return this.readDetail(q, input.productId)
    })
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  /** Load full rows + categories + electricity limits for a set of rows. */
  private async loadAggregates(
    q: DbExecutor,
    rows: ProductRow[],
  ): Promise<ProductRowWithAggregates[]> {
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)

    const [categories, limits] = await Promise.all([
      q.query<CategoryRow>(
        `SELECT product_id, category FROM product_categories WHERE product_id = ANY($1::uuid[])`,
        [ids],
      ),
      q.query<LimitsRow>(
        `SELECT product_id, min_kwh, max_kwh FROM electricity_product_limits WHERE product_id = ANY($1::uuid[])`,
        [ids],
      ),
    ])

    const categoryMap = new Map<string, ProductCategory[]>()
    for (const row of categories.rows) {
      const list = categoryMap.get(row.product_id) ?? []
      list.push(row.category)
      categoryMap.set(row.product_id, list)
    }
    const limitsMap = new Map(
      limits.rows.map((row) => [
        row.product_id,
        { minKwh: String(row.min_kwh), maxKwh: String(row.max_kwh) },
      ]),
    )

    return rows.map((row) => ({
      ...row,
      categories: categoryMap.get(row.id) ?? [],
      electricityLimits: limitsMap.get(row.id) ?? null,
    }))
  }

  private async findLimits(q: DbExecutor, productId: string): Promise<LimitsRow | null> {
    const result = await q.query<LimitsRow>(
      `SELECT product_id, min_kwh, max_kwh
         FROM electricity_product_limits
        WHERE product_id = $1`,
      [productId],
    )
    return result.rows[0] ?? null
  }

  private async loadPriceHistory(q: DbExecutor, productId: string): Promise<PriceVersionRow[]> {
    const result = await q.query<PriceVersionRow>(
      `SELECT id, price, effective_from, effective_until, created_by, created_at
         FROM product_price_versions
        WHERE product_id = $1
        ORDER BY effective_from ASC, created_at ASC`,
      [productId],
    )
    return result.rows
  }

  private toDto(row: ProductRowWithAggregates): ProductDto {
    return {
      id: row.id,
      type: row.type,
      systemKey: row.system_key,
      title: row.title,
      description: row.description ?? null,
      price: row.price === null ? null : String(row.price),
      status: row.status,
      categories: row.categories,
      electricityLimits: row.electricityLimits,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private toHistoryDto(row: PriceVersionRow): PriceVersionDto {
    return {
      id: row.id,
      price: String(row.price),
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until ?? null,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }
  }

  /**
   * Insert a new price version and close the previous open version at the
   * new effective_from. Returns `false` when the submission is a no-op (the
   * requested price equals the currently-open price — a version exists to
   * record a price CHANGE, and a same-price version records nothing, so the
   * no-op is reachable via HTTP where effectiveFrom defaults to "now").
   * The caller then emits no audit (no-op discipline). `products.price`
   * mirrors the newest version so list/detail reads (and the public
   * endpoint) keep showing the latest price.
   */
  private async insertPriceVersion(
    q: DbExecutor,
    input: { productId: string; price: string; effectiveFrom: string; actorUserId: string },
  ): Promise<boolean> {
    const id = uuidv7()
    const from = new Date(input.effectiveFrom)

    const open = await this.findOpenVersion(q, input.productId)
    if (open) {
      const openFrom = new Date(open.effective_from)

      // Re-submitting the currently-open price is a no-op: a version exists
      // to record a price CHANGE, and a same-price version (whatever its
      // effective date) records nothing.
      if (String(open.price) === String(input.price)) {
        return false
      }

      if (from.getTime() <= openFrom.getTime()) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'CATALOGUE_PRICE_INVALID_EFFECTIVE_FROM',
            message:
              'A new price version must take effect strictly after the ' +
              'currently active version (active since ' + open.effective_from + ')',
          },
          400,
        )
      }
      // Close the previous open version at the new effective_from.
      await q.query(
        `UPDATE product_price_versions
            SET effective_until = $1, updated_at = NOW()
          WHERE id = $2 AND effective_until IS NULL`,
        [from, open.id],
      )
    }

    await q.query(
      `INSERT INTO product_price_versions
         (id, product_id, price, effective_from, effective_until, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $6)`,
      [id, input.productId, input.price, from, input.actorUserId, new Date()],
    )

    // Mirror the newest price into products.price (the current price column).
    await q.query('UPDATE products SET price = $1, updated_at = NOW() WHERE id = $2', [
      input.price,
      input.productId,
    ])
    return true
  }

  private async findOpenVersion(
    q: DbExecutor,
    productId: string,
  ): Promise<PriceVersionRow | null> {
    const result = await q.query<PriceVersionRow>(
      `SELECT id, price, effective_from, effective_until, created_by, created_at
         FROM product_price_versions
        WHERE product_id = $1 AND effective_until IS NULL
        ORDER BY effective_from DESC
        LIMIT 1`,
      [productId],
    )
    return result.rows[0] ?? null
  }

  private async findProduct(q: DbExecutor, id: string): Promise<ProductRow | null> {
    const result = await q.query<ProductRow>(
      `SELECT id, type, system_key, title, description, price, status, created_at, updated_at
         FROM products
        WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  /** Re-read a product after a mutation (aggregates + price history). */
  private async readDetail(q: DbExecutor, id: string): Promise<ProductDetailDto> {
    const product = await this.findProduct(q, id)
    if (!product) throw this.productNotFound(id)
    const [withAggregates, history] = await Promise.all([
      this.loadAggregates(q, [product]),
      this.loadPriceHistory(q, id),
    ])
    return {
      ...this.toDto(withAggregates[0]!),
      priceHistory: history.map((row) => this.toHistoryDto(row)),
    }
  }

  private async insertCategories(
    q: DbExecutor,
    productId: string,
    categories: ProductCategory[],
  ): Promise<void> {
    for (const category of categories) {
      await q.query(
        `INSERT INTO product_categories (id, product_id, category, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [uuidv7(), productId, category, new Date()],
      )
    }
  }

  private async upsertElectricityLimits(
    q: DbExecutor,
    productId: string,
    minKwh: string,
    maxKwh: string,
  ): Promise<void> {
    const limits = await this.findLimits(q, productId)
    const min = minKwh ?? limits?.min_kwh ?? null
    const max = maxKwh ?? limits?.max_kwh ?? null

    if (limits) {
      await q.query(
        `UPDATE electricity_product_limits
            SET min_kwh = $1, max_kwh = $2, updated_at = NOW()
          WHERE product_id = $3`,
        [min ?? 0, max ?? 0, productId],
      )
    } else {
      await q.query(
        `INSERT INTO electricity_product_limits (id, product_id, min_kwh, max_kwh, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [uuidv7(), productId, min ?? 0, max ?? 0, new Date()],
      )
    }
  }

  /** Validate the category set against the product type. */
  private assertCategorySetForType(type: ProductType, categories: ProductCategory[]): void {
    const allowed = CATEGORIES_BY_TYPE[type]
    if (categories.length === 0) return
    if (allowed.length === 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'CATALOGUE_CATEGORIES_NOT_ALLOWED',
          message: `Categories are not applicable to ${type} products`,
        },
        400,
      )
    }
    const invalid = categories.filter((c) => !allowed.includes(c))
    if (invalid.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'CATALOGUE_CATEGORY_INVALID',
          message: `Invalid category for ${type} product: ${invalid.join(', ')}`,
        },
        400,
      )
    }
  }

  /** Electricity limits must satisfy the DB CHECK constraints (0018). */
  private assertLimits(type: ProductType, minKwh: string, maxKwh: string): void {
    if (type !== 'electricity') {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'CATALOGUE_LIMITS_NOT_ALLOWED',
          message: `Electricity consumption limits only apply to electricity products`,
        },
        400,
      )
    }
    const min = BigInt(minKwh)
    const max = BigInt(maxKwh)
    if (min < 0n) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'CATALOGUE_LIMITS_INVALID',
          message: 'minKwh must be non-negative',
        },
        400,
      )
    }
    if (max < 0n) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'CATALOGUE_LIMITS_INVALID',
          message: 'maxKwh must be non-negative',
        },
        400,
      )
    }
    // Both zero is meaningless — the DB CHECK requires at least one bound.
    if (min === 0n && max === 0n) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'CATALOGUE_LIMITS_INVALID',
          message: 'At least one of minKwh or maxKwh must be non-zero',
        },
        400,
      )
    }
    // maxKwh 0 means "no upper limit" (0018 CHECK: max_kwh = 0 OR min <= max),
    // so the min<=max check only applies when a real cap is set.
    if (max > 0n && min > max) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'CATALOGUE_LIMITS_INVALID',
          message: 'minKwh cannot exceed maxKwh when maxKwh is set',
        },
        400,
      )
    }
  }

  private productNotFound(id: string): HttpException {
    return new HttpException(
      {
        statusCode: 404,
        error: 'CATALOGUE_PRODUCT_NOT_FOUND',
        message: `Catalogue product ${id} not found`,
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
      throw error
    } finally {
      client.release()
    }
  }

  private async recordAudit(
    q: DbExecutor,
    event: string,
    actorUserId: string,
    ip: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await q.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [uuidv7(), actorUserId, event, JSON.stringify(meta), uuidv7(), ip, new Date()],
    )
  }
}

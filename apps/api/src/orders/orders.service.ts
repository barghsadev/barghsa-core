import { Injectable, Logger, HttpException, Inject } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { GiftCodeService } from '../admin/gift-code.service.js'

export interface OrderRow {
  id: string
  userId: string
  profileId: string
  productId: string
  orderType: 'electricity' | 'savings' | 'solar'
  status: 'DRAFT' | 'PENDING' | 'CONFIRMED' | 'CANCELLED'
  snapshotProvinceId: string
  snapshotCityId: string
  snapshotFullAddress: string
  snapshotPostalCode: string
  /** Gift code id applied at creation (T-09.12.03); null when none. */
  giftCodeId: string | null
  /** Gift discount IRR snapshot (T-09.12.03); null when none. */
  giftDiscountAmount: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateOrderDto {
  profileId: string
  productId: string
  orderType: 'electricity' | 'savings' | 'solar'
  /** Address values to snapshot (copied at order time, not FK). */
  address: {
    provinceId: string
    cityId: string
    fullAddress: string
    postalCode: string
  }
  /**
   * Optional gift code (T-09.12.03) — case-insensitive; normalized by
   * the redemption seam. Redeemed ATOMICALLY with the order insert: a
   * failed creation rolls back the redemption (no slot consumed).
   */
  giftCode?: string
}

function mapRow(row: Record<string, unknown>): OrderRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    profileId: row.profile_id as string,
    productId: row.product_id as string,
    orderType: row.order_type as 'electricity' | 'savings' | 'solar',
    status: row.status as 'DRAFT' | 'PENDING' | 'CONFIRMED' | 'CANCELLED',
    snapshotProvinceId: row.snapshot_province_id as string,
    snapshotCityId: row.snapshot_city_id as string,
    snapshotFullAddress: row.snapshot_full_address as string,
    snapshotPostalCode: row.snapshot_postal_code as string,
    giftCodeId: (row.gift_code_id as string) ?? null,
    giftDiscountAmount: (row.gift_discount_amount as string) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  }
}

/** Minimal query executor shared by the pool and a transactional client. */
type QueryFn = <T = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[]; rowCount: number | null }>

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name)

  constructor(
    @Inject(GiftCodeService)
    private readonly giftCodeService: GiftCodeService,
  ) {}

  /**
   * Create a new order with an address snapshot.
   *
   * Validates address fields first (cheap), then runs the profile
   * ownership check, product availability check, order insert and
   * (when a gift code is supplied) the gift-code redemption in ONE
   * transaction on a single client — so a failed order creation rolls
   * everything back and never consumes a gift-code slot.
   *
   * When `giftCode` is provided the product must have a price: the
   * price is the pre-discount order total used for minimum-order and
   * percentage-capped discount computation (T-09.12.03).
   */
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
    actorIp = 'unknown',
  ): Promise<OrderRow> {
    // ── Address field validation (fast-path, no DB) ────────────────
    if (!dto.address.provinceId?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Province is required' },
        400,
      )
    }
    if (!dto.address.cityId?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'City is required' },
        400,
      )
    }
    if (!dto.address.fullAddress?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Full address is required' },
        400,
      )
    }
    if (!dto.address.postalCode?.trim()) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Postal code is required' },
        400,
      )
    }
    if (dto.address.fullAddress.length > 500) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Full address must be 500 characters or fewer' },
        400,
      )
    }
    if (dto.giftCode !== undefined && dto.giftCode.trim().length === 0) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_MISSING.code, message: 'Gift code cannot be empty' },
        400,
      )
    }

    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Validate the profile belongs to the user
      const profileResult = await client.query(
        `SELECT id FROM profiles WHERE id = $1 AND user_id = $2`,
        [dto.profileId, userId],
      )
      if (profileResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Profile not found' },
          404,
        )
      }

      // Validate the product exists, is active, and fetch its price +
      // type (the price is the order total for gift-code math).
      const productResult = await client.query<{ id: string; type: string; price: string | null }>(
        `SELECT id, type, price FROM products WHERE id = $1 AND is_active = true`,
        [dto.productId],
      )
      if (productResult.rows.length === 0) {
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Product not found or not active' },
          404,
        )
      }
      const product = productResult.rows[0] as { id: string; type: string; price: string | null }

      // Create the order with address snapshot
      const result = await client.query(
        `INSERT INTO orders (user_id, profile_id, product_id, order_type, status, snapshot_province_id, snapshot_city_id, snapshot_full_address, snapshot_postal_code)
         VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8)
         RETURNING *`,
        [
          userId,
          dto.profileId,
          dto.productId,
          dto.orderType,
          dto.address.provinceId.trim(),
          dto.address.cityId.trim(),
          dto.address.fullAddress.trim(),
          dto.address.postalCode.trim(),
        ],
      )
      const order = mapRow(result.rows[0] as Record<string, unknown>)

      // Redeem the gift code atomically (same tx as the order insert).
      let finalOrder = order
      if (dto.giftCode !== undefined) {
        if (product.price === null) {
          throw new HttpException(
            {
              statusCode: 400,
              error: 'GIFT_CODE_INVALID_ORDER',
              message: 'Cannot apply a gift code to a product without a price',
            },
            400,
          )
        }
        const redemption = await this.giftCodeService.redeem(
          {
            giftCode: dto.giftCode,
            profileId: dto.profileId,
            orderId: order.id,
            orderAmount: product.price,
            category: product.type,
            actorUserId: userId,
            ip: actorIp,
          },
          client,
        )
        const withGift = await client.query(
          `UPDATE orders
              SET gift_code_id = $1, gift_discount_amount = $2, updated_at = $3
            WHERE id = $4
            RETURNING *`,
          [redemption.giftCodeId, redemption.discountAmount, new Date(), order.id],
        )
        finalOrder = mapRow(withGift.rows[0] as Record<string, unknown>)
        this.logger.log(
          `Order ${order.id}: gift code applied (code redemption ${redemption.id}, ` +
            `discount ${redemption.discountAmount} IRR)`,
        )
      }

      await client.query('COMMIT')
      this.logger.log(`Order ${finalOrder.id} created for user ${userId}, type=${dto.orderType}`)
      return finalOrder
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * List all orders for a user, ordered by most recent first.
   */
  async listOrders(userId: string): Promise<OrderRow[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    )
    return result.rows.map((row) => mapRow(row as Record<string, unknown>))
  }

  /**
   * Get a single order by id, scoped to the user.
   */
  async getOrder(userId: string, orderId: string): Promise<OrderRow | null> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND user_id = $2`,
      [orderId, userId],
    )
    return result.rows.length > 0 ? mapRow(result.rows[0] as Record<string, unknown>) : null
  }

  /**
   * Cancel an order (T-09.12.03 order-creation seam).
   *
   * Only DRAFT/PENDING orders can be cancelled. Cancelling an order
   * BEFORE payment restores its gift-code slot by default (the epic's
   * policy): the redemption ledger row flips to `released` and stops
   * counting against the code's limits.
   *
   * The status flip and the slot release run in ONE transaction, so a
   * cancellation can never permanently leak a consumed slot because
   * the release failed. Cancelling an already-cancelled order is an
   * idempotent no-op returning the current row; a CONFIRMED (or other
   * terminal, un-cancellable) order is rejected with 409 rather than
   * silently reporting success.
   */
  async cancelOrder(
    userId: string,
    orderId: string,
    actorIp = 'unknown',
  ): Promise<OrderRow | null> {
    const pool = getDbPool()
    const client = await pool.connect()
    let rolledBack = false
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `UPDATE orders
            SET status = 'CANCELLED', updated_at = $1
          WHERE id = $2 AND user_id = $3 AND status IN ('DRAFT', 'PENDING')
          RETURNING *`,
        [new Date(), orderId, userId],
      )
      if (result.rows.length === 0) {
        await client.query('ROLLBACK').catch(() => {})
        rolledBack = true
        // Distinguish: not found / not owned (404) vs already cancelled
        // (idempotent no-op) vs terminal non-cancellable (409).
        const existing = await pool.query(
          `SELECT * FROM orders WHERE id = $1 AND user_id = $2`,
          [orderId, userId],
        )
        if (existing.rows.length === 0) return null
        const row = mapRow(existing.rows[0] as Record<string, unknown>)
        if (row.status === 'CANCELLED') return row
        throw new HttpException(
          {
            statusCode: 409,
            error: 'ORDER_NOT_CANCELLABLE',
            message: `Order ${orderId} is ${row.status} and cannot be cancelled at this stage`,
          },
          409,
        )
      }
      const order = mapRow(result.rows[0] as Record<string, unknown>)
      // Restore the gift-code slot (default pre-payment policy) — same
      // transaction: the release commits/rolls back with the cancel.
      if (order.giftCodeId !== null) {
        const { released } = await this.giftCodeService.releaseByOrder(
          order.id,
          client,
          { actorUserId: userId, ip: actorIp },
        )
        this.logger.log(
          `Order ${order.id} cancelled before payment; ${released} gift-code slot(s) restored`,
        )
      }
      await client.query('COMMIT')
      this.logger.log(`Order ${order.id} cancelled for user ${userId}`)
      return order
    } catch (error) {
      // The no-match branch already rolled back; the catch only rolls
      // back when the transaction is still open.
      if (!rolledBack) {
        await client.query('ROLLBACK').catch(() => {})
      }
      throw error
    } finally {
      client.release()
    }
  }
}

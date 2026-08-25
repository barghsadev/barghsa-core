import { Injectable, Logger, HttpException } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'

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
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  }
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name)

  /**
   * Create a new order with an address snapshot.
   *
   * Validates address fields first (cheap), then checks profile ownership
   * and product availability, and creates the order record with the address
   * values copied directly (not via FK) to ensure historical accuracy.
   */
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
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

    const pool = getDbPool()

    // Validate the profile belongs to the user
    const profileResult = await pool.query(
      `SELECT id FROM profiles WHERE id = $1 AND user_id = $2`,
      [dto.profileId, userId],
    )
    if (profileResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Profile not found' },
        404,
      )
    }

    // Validate the product exists and is active
    const productResult = await pool.query(
      `SELECT id FROM products WHERE id = $1 AND is_active = true`,
      [dto.productId],
    )
    if (productResult.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Product not found or not active' },
        404,
      )
    }

    // Create the order with address snapshot
    const result = await pool.query(
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

    const order = mapRow(result.rows[0])
    this.logger.log(`Order ${order.id} created for user ${userId}, type=${dto.orderType}`)
    return order
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
    return result.rows.map(mapRow)
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
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  }
}
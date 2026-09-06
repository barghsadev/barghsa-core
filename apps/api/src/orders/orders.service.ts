import type { PoolClient } from 'pg';
import { requireAddressGeography } from '../profiles/address-geography.js';
import { Injectable, Logger, HttpException, Inject } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { GiftCodeService } from '../admin/gift-code.service.js';

export interface OrderRow {
  id: string;
  userId: string;
  profileId: string;
  productId: string;
  orderType: 'electricity' | 'savings' | 'solar';
  status: 'DRAFT' | 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  snapshotProvinceId: string;
  snapshotCityId: string;
  snapshotFullAddress: string;
  snapshotPostalCode: string;
  /** Gift code id applied at creation (T-09.12.03); null when none. */
  giftCodeId: string | null;
  /** Gift discount IRR snapshot (T-09.12.03); null when none. */
  giftDiscountAmount: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderDto {
  profileId: string;
  productId: string;
  orderType: 'electricity' | 'savings' | 'solar';
  /** Address values to snapshot (copied at order time, not FK). */
  address: {
    provinceId: string;
    cityId: string;
    fullAddress: string;
    postalCode: string;
  };
  /**
   * Optional gift code (T-09.12.03) — case-insensitive; normalized by
   * the redemption seam. Redeemed ATOMICALLY with the order insert: a
   * failed creation rolls back the redemption (no slot consumed).
   */
  giftCode?: string;
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
  };
}

/** Minimal query executor shared by the pool and a transactional client. */

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(GiftCodeService)
    private readonly giftCodeService: GiftCodeService
  ) {}

  private async mayManageOrders(
    client: PoolClient,
    userId: string,
    profileId: string
  ): Promise<boolean> {
    const profile = (
      await client.query(
        'SELECT id,user_id,profile_type FROM profiles WHERE id=$1 AND NOT archived FOR SHARE',
        [profileId]
      )
    ).rows[0];
    if (!profile) return false;
    if (profile.user_id === userId) return true;
    if (profile.profile_type !== 'LEGAL') return false;
    const agent = await client.query(
      "SELECT id FROM profile_agents WHERE profile_id=$1 AND user_id=$2 AND role='Manager' FOR SHARE",
      [profileId, userId]
    );
    return agent.rows.length > 0;
  }

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
  async createOrder(userId: string, dto: CreateOrderDto, actorIp = 'unknown'): Promise<OrderRow> {
    // ── Address field validation (fast-path, no DB) ────────────────
    if (!dto.address.provinceId?.trim()) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_MISSING.code,
          message: 'Province is required',
        },
        400
      );
    }
    if (!dto.address.cityId?.trim()) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_MISSING.code,
          message: 'City is required',
        },
        400
      );
    }
    if (!dto.address.fullAddress?.trim()) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_MISSING.code,
          message: 'Full address is required',
        },
        400
      );
    }
    if (!dto.address.postalCode?.trim()) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_MISSING.code,
          message: 'Postal code is required',
        },
        400
      );
    }
    if (dto.address.fullAddress.length > 500) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Full address must be 500 characters or fewer',
        },
        400
      );
    }
    if (dto.giftCode !== undefined && dto.giftCode.trim().length === 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_MISSING.code,
          message: 'Gift code cannot be empty',
        },
        400
      );
    }

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (!(await this.mayManageOrders(client, userId, dto.profileId)))
        throw new HttpException(
          {
            statusCode: 404,
            error: ErrorCodes.NOT_FOUND_RESOURCE.code,
            message: 'Profile not found',
          },
          404
        );

      // Validate the product exists, is active, and fetch its price +
      // type (the price is the order total for gift-code math).
      const productResult = await client.query<{ id: string; type: string; price: string | null }>(
        `SELECT id, type, effective_product_price(id) AS price FROM products WHERE id = $1 AND status = 'active' FOR SHARE`,
        [dto.productId]
      );
      if (productResult.rows.length === 0) {
        throw new HttpException(
          {
            statusCode: 404,
            error: ErrorCodes.NOT_FOUND_RESOURCE.code,
            message: 'Product not found or not active',
          },
          404
        );
      }
      const product = productResult.rows[0] as { id: string; type: string; price: string | null };

      await requireAddressGeography(
        client,
        dto.address.provinceId.trim(),
        dto.address.cityId.trim()
      );

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
        ]
      );
      const order = mapRow(result.rows[0] as Record<string, unknown>);

      // Redeem the gift code atomically (same tx as the order insert).
      let finalOrder = order;
      if (dto.giftCode !== undefined) {
        if (product.price === null) {
          throw new HttpException(
            {
              statusCode: 400,
              error: 'GIFT_CODE_INVALID_ORDER',
              message: 'Cannot apply a gift code to a product without a price',
            },
            400
          );
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
          client
        );
        const withGift = await client.query(
          `UPDATE orders
              SET gift_code_id = $1, gift_discount_amount = $2, updated_at = $3
            WHERE id = $4
            RETURNING *`,
          [redemption.giftCodeId, redemption.discountAmount, new Date(), order.id]
        );
        finalOrder = mapRow(withGift.rows[0] as Record<string, unknown>);
        this.logger.log(
          `Order ${order.id}: gift code applied (code redemption ${redemption.id}, ` +
            `discount ${redemption.discountAmount} IRR)`
        );
      }

      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
         VALUES(uuid_generate_v7(),$1,'order_created',$2::jsonb,uuid_generate_v7(),$3)`,
        [
          userId,
          JSON.stringify({ orderId: finalOrder.id, profileId: dto.profileId, status: 'DRAFT' }),
          actorIp,
        ]
      );
      await client.query('COMMIT');
      this.logger.log(`Order ${finalOrder.id} created for user ${userId}, type=${dto.orderType}`);
      return finalOrder;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * List all orders for a user, ordered by most recent first.
   */
  async listOrders(userId: string): Promise<OrderRow[]> {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT o.* FROM orders o JOIN profiles p ON p.id=o.profile_id
       WHERE NOT p.archived AND (p.user_id=$1 OR (p.profile_type='LEGAL' AND EXISTS(
         SELECT 1 FROM profile_agents a WHERE a.profile_id=p.id AND a.user_id=$1 AND a.role='Manager'
       ))) ORDER BY o.created_at DESC`,
      [userId]
    );
    return result.rows.map((row) => mapRow(row as Record<string, unknown>));
  }

  /**
   * Get a single order by id, scoped to the user.
   */
  async getOrder(userId: string, orderId: string): Promise<OrderRow | null> {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT o.* FROM orders o JOIN profiles p ON p.id=o.profile_id
       WHERE o.id=$1 AND NOT p.archived AND (p.user_id=$2 OR (p.profile_type='LEGAL' AND EXISTS(
         SELECT 1 FROM profile_agents a WHERE a.profile_id=p.id AND a.user_id=$2 AND a.role='Manager'
       )))`,
      [orderId, userId]
    );
    return result.rows.length > 0 ? mapRow(result.rows[0] as Record<string, unknown>) : null;
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
    actorIp = 'unknown'
  ): Promise<OrderRow | null> {
    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = (await client.query('SELECT profile_id FROM orders WHERE id=$1', [orderId]))
        .rows[0];
      if (!target || !(await this.mayManageOrders(client, userId, target.profile_id))) {
        await client.query('ROLLBACK');
        return null;
      }
      const result = await client.query(
        'SELECT * FROM orders WHERE id=$1 AND profile_id=$2 FOR UPDATE',
        [orderId, target.profile_id]
      );
      if (!result.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }
      const current = mapRow(result.rows[0] as Record<string, unknown>);
      if (current.status === 'CANCELLED') {
        await client.query('COMMIT');
        return current;
      }
      if (current.status !== 'DRAFT' && current.status !== 'PENDING')
        throw new HttpException({ statusCode: 409, error: 'ORDER_NOT_CANCELLABLE' }, 409);
      const updated = await client.query(
        "UPDATE orders SET status='CANCELLED',updated_at=NOW() WHERE id=$1 RETURNING *",
        [orderId]
      );
      const order = mapRow(updated.rows[0] as Record<string, unknown>);
      // Restore the gift-code slot (default pre-payment policy) — same
      // transaction: the release commits/rolls back with the cancel.
      if (order.giftCodeId !== null) {
        const { released } = await this.giftCodeService.releaseByOrder(order.id, client, {
          actorUserId: userId,
          ip: actorIp,
        });
        this.logger.log(
          `Order ${order.id} cancelled before payment; ${released} gift-code slot(s) restored`
        );
      }
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
         VALUES(uuid_generate_v7(),$1,'order_cancelled',$2::jsonb,uuid_generate_v7(),$3)`,
        [
          userId,
          JSON.stringify({
            orderId: order.id,
            profileId: order.profileId,
            previousStatus: current.status,
            status: 'CANCELLED',
          }),
          actorIp,
        ]
      );
      await client.query('COMMIT');
      this.logger.log(`Order ${order.id} cancelled for user ${userId}`);
      return order;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

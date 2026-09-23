import type { PoolClient } from 'pg';
import { requireAddressGeography } from '../profiles/address-geography.js';
import { Injectable, Logger, HttpException, Inject } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { GiftCodeService } from '../admin/gift-code.service.js';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import {
  DEFAULT_GREEN_ELECTRICITY_CONFIG,
  GREEN_ELECTRICITY_CONFIG_KEY,
  GREEN_ELECTRICITY_SYSTEM_KEYS,
  evaluateGreenRuleEnforcement,
  greenElectricityConfigToStored,
  toGreenElectricityConfig,
  validateGreenElectricityConfig,
} from '@barghsa/shared/finance';
import {
  CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
  DEFAULT_CONTRACT_ELECTRICITY_LIMITS,
  contractElectricityLimitsToStored,
  toContractElectricityLimits,
  validateContractElectricityLimits,
} from '@barghsa/shared/admin';
import type { GreenElectricityConfig } from '@barghsa/shared/finance';
import type { ContractElectricityLimits } from '@barghsa/shared/admin';

type OrderActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

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

  async mayManageOrders(
    client: PoolClient,
    userId: string,
    profileId: string,
    commercial = false
  ): Promise<boolean> {
    const profile = (
      await client.query(
        'SELECT id,user_id,profile_type,status FROM profiles WHERE id=$1 AND NOT archived FOR SHARE',
        [profileId]
      )
    ).rows[0];
    if (!profile) return false;
    if (profile.user_id !== userId) {
      if (profile.profile_type !== 'LEGAL') return false;
      const agent = await client.query(
        "SELECT id FROM profile_agents WHERE profile_id=$1 AND user_id=$2 AND role='Manager' FOR SHARE",
        [profileId, userId]
      );
      if (agent.rows.length === 0) return false;
    }
    if (commercial) {
      // Cover absent configuration keys as well as updates. Keep policy and the
      // submitted profile stable until commit, without relying on cached context.
      await client.query('LOCK TABLE app_config IN SHARE MODE');
      const config = await client.query<{ key: string; value: unknown }>(
        "SELECT key,value FROM app_config WHERE key IN ('profile_verification_mode','verification.required')"
      );
      const mode = config.rows.find((row) => row.key === 'profile_verification_mode')?.value;
      const required =
        mode != null
          ? mode !== 'DISABLED'
          : config.rows.find((row) => row.key === 'verification.required')?.value === true;
      if (
        profile.status === 'DRAFT' ||
        profile.status === 'SUSPENDED' ||
        (required && profile.status !== 'VERIFIED')
      )
        throw new HttpException({ error: ErrorCodes.AUTHZ_PROFILE_NOT_VERIFIED.code }, 403);
    }
    return true;
  }

  async lockOrderActor(client: PoolClient, actor: OrderActor): Promise<void> {
    const account = (
      await client.query('SELECT disabled_at FROM users WHERE user_id=$1 FOR UPDATE', [
        actor.userId,
      ])
    ).rows[0];
    if (!account || account.disabled_at)
      throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
    await requireCurrentSession(client, actor);
  }

  /** Serialize submissions by all agents of the same profile until commit. */
  async lockProfileSubmissions(client: PoolClient, profileId: string): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('submission-quota:' || $1))", [
      profileId,
    ]);
  }

  /** Call after locking the profile and checking whether this is an idempotent retry. */
  async enforceProfileSubmissionLimit(client: PoolClient, profileId: string): Promise<void> {
    const result = await client.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM orders o JOIN electricity_orders e ON e.id=o.id
          WHERE o.profile_id=$1 AND o.order_type='electricity'
            AND e.submitted_at>=clock_timestamp()-INTERVAL '1 minute') +
         (SELECT count(*) FROM saving_orders
          WHERE profile_id=$1 AND submitted_at>=clock_timestamp()-INTERVAL '1 minute') +
         (SELECT count(*) FROM solar_construction_requests
          WHERE profile_id=$1 AND submitted_at>=clock_timestamp()-INTERVAL '1 minute') +
         (SELECT count(*) FROM consultation_requests
          WHERE profile_id=$1 AND submitted_at>=clock_timestamp()-INTERVAL '1 minute')
       )::text AS count`,
      [profileId]
    );
    if (Number(result.rows[0]?.count ?? 0) >= 5)
      throw new HttpException({ error: ErrorCodes.RATE_LIMIT_EXCEEDED.code }, 429);
  }

  async loadElectricitySettings(client: PoolClient): Promise<{
    config: GreenElectricityConfig;
    limits: ContractElectricityLimits;
    snapshot: Record<string, unknown>;
  }> {
    // Lock the table to cover absent keys as well as concurrent updates.
    await client.query('LOCK TABLE app_config IN SHARE MODE');
    const rows = (
      await client.query<{ key: string; value: unknown; version: number }>(
        'SELECT key, value, version FROM app_config WHERE key = ANY($1::text[])',
        [[GREEN_ELECTRICITY_CONFIG_KEY, CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY]]
      )
    ).rows;
    const greenRow = rows.find((row) => row.key === GREEN_ELECTRICITY_CONFIG_KEY);
    const limitsRow = rows.find((row) => row.key === CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY);
    if (
      (greenRow && !validateGreenElectricityConfig(greenRow.value).ok) ||
      (limitsRow && !validateContractElectricityLimits(limitsRow.value).ok)
    )
      throw new HttpException({ error: 'CONFIG:STORED_VALUE_INVALID' }, 503);
    const config = greenRow
      ? toGreenElectricityConfig(greenRow.value)
      : DEFAULT_GREEN_ELECTRICITY_CONFIG;
    const limits = limitsRow
      ? toContractElectricityLimits(limitsRow.value)
      : DEFAULT_CONTRACT_ELECTRICITY_LIMITS;
    return {
      config,
      limits,
      snapshot: {
        schemaVersion: 1,
        green: greenElectricityConfigToStored(config),
        sourceVersion: greenRow?.version ?? 0,
        contractLimits: contractElectricityLimitsToStored(limits),
        contractLimitsVersion: limitsRow?.version ?? 0,
        capturedAt: new Date().toISOString(),
      },
    };
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
  async createOrder(
    actor: OrderActor,
    dto: CreateOrderDto,
    actorIp = 'unknown'
  ): Promise<OrderRow> {
    const { userId } = actor;
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
      await this.lockOrderActor(client, actor);

      if (!(await this.mayManageOrders(client, userId, dto.profileId, true)))
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
      const productResult = await client.query<{
        id: string;
        type: string;
        system_key: string | null;
        price: string | null;
      }>(
        `SELECT id, type, system_key, effective_product_price(id) AS price FROM products WHERE id = $1 AND status = 'active' FOR SHARE`,
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
      const product = productResult.rows[0]!;

      let electricitySettingsSnapshot: Record<string, unknown> | null = null;
      if (dto.orderType === 'electricity') {
        if (
          product.type !== 'electricity' ||
          product.system_key !== 'thermal' ||
          product.price === null ||
          !/^\d+$/.test(product.price) ||
          BigInt(product.price) <= 0n
        ) {
          throw new HttpException(
            {
              statusCode: 400,
              error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
              message: 'Selected electricity product is not orderable',
            },
            400
          );
        }

        const { config, snapshot } = await this.loadElectricitySettings(client);
        const greenResult = await client.query<{ status: string; price: string | null }>(
          `SELECT status, effective_product_price(id) AS price FROM products
              WHERE system_key = ANY($1::text[]) FOR SHARE`,
          [GREEN_ELECTRICITY_SYSTEM_KEYS]
        );
        if (greenResult.rows.length > 1) {
          throw new HttpException({ statusCode: 503, error: 'ELECTRICITY_PRODUCT_AMBIGUOUS' }, 503);
        }
        const green = greenResult.rows[0];
        const safety = evaluateGreenRuleEnforcement(config, 'simpleOrder', {
          exists: !!green,
          status:
            green?.status === 'active' ||
            green?.status === 'inactive' ||
            green?.status === 'archived'
              ? green.status
              : null,
          // The safety check needs only a positive price, not its rounded Number value.
          priceIrR:
            green?.price && /^\d+$/.test(green.price) && BigInt(green.price) > 0n ? 1 : null,
        });
        if (safety.blocked) {
          throw new HttpException(
            {
              statusCode: 409,
              error: 'ELECTRICITY_GREEN_RULE_BLOCKED',
              message: 'Mandatory green electricity is unavailable',
              details: safety.reasons,
            },
            409
          );
        }
        electricitySettingsSnapshot = snapshot;
      }

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

      if (electricitySettingsSnapshot !== null) {
        await client.query(
          `INSERT INTO electricity_orders (id, profile_id, mode, status, settings_snapshot)
             VALUES ($1, $2, 'simple', 'draft', $3::jsonb)`,
          [order.id, dto.profileId, JSON.stringify(electricitySettingsSnapshot)]
        );
      }

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
         VALUES(uuid_generate_v7(),$1,'order_created',$2::jsonb,COALESCE($4::uuid,uuid_generate_v7()),$3)`,
        [
          userId,
          JSON.stringify({ orderId: finalOrder.id, profileId: dto.profileId, status: 'DRAFT' }),
          actorIp,
          correlationIdStorage.getStore() ?? null,
        ]
      );
      await requireCurrentSession(client, actor);
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
    actor: OrderActor,
    orderId: string,
    actorIp = 'unknown'
  ): Promise<OrderRow | null> {
    const { userId } = actor;
    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockOrderActor(client, actor);
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
        await requireCurrentSession(client, actor);
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
      if (order.orderType === 'electricity') {
        await client.query(
          "UPDATE electricity_orders SET status='cancelled', updated_at=NOW() WHERE id=$1 AND status='draft'",
          [order.id]
        );
      }
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
         VALUES(uuid_generate_v7(),$1,'order_cancelled',$2::jsonb,COALESCE($4::uuid,uuid_generate_v7()),$3)`,
        [
          userId,
          JSON.stringify({
            orderId: order.id,
            profileId: order.profileId,
            previousStatus: current.status,
            status: 'CANCELLED',
          }),
          actorIp,
          correlationIdStorage.getStore() ?? null,
        ]
      );
      await requireCurrentSession(client, actor);
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

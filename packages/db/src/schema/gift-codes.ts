import { sql } from 'drizzle-orm'
import { integer, text, uuid } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table'
import { irrAmount, timestamptz } from '../types'
import { orders } from './orders'
import { profiles } from './profiles'
import { users } from './users'

/**
 * Gift codes (T-09.12.03) — admin-managed promotions redeemed at order
 * creation.
 *
 * `gift_codes` — one row per code. `code` is ALWAYS stored normalized
 * (trim + uppercase; see `normalizeGiftCode` in @barghsa/shared/promotions)
 * and has a UNIQUE index, so `sale10` and ` SALE10 ` collide.
 *
 * Discount model (exact integer arithmetic, no floats):
 * - `discount_type` `fixed_irr` → `discount_value` is an IRR amount;
 *   `max_cap_irr` must be NULL.
 * - `discount_type` `percentage` → `discount_value` is the percentage in
 *   basis points (2500 = 25%); `max_cap_irr` is REQUIRED (the cap).
 *
 * Limits/dates/categories:
 * - `total_limit` / `per_profile_limit` — null = unlimited, CHECK > 0.
 * - `valid_from` (inclusive) / `valid_until` (exclusive; null = open).
 * - `min_order_amount` — order total must reach this (IRR, >= 0).
 * - `categories` — eligible product categories (`products.type`
 *   discriminators); empty array = all categories.
 * - `eligibility` `public` | `profile` — `profile` requires rows in
 *   `gift_code_profiles`.
 * - `status` `active` | `inactive` — admin toggle; only active codes
 *   redeem.
 *
 * The migration (0048) also declares: discount/limit/window CHECK
 * constraints, `updated_at` triggers, and a UNIQUE index on the
 * normalized `code`.
 */
export const giftCodes = createTable('gift_codes', {
  /** Normalized (trim + uppercase) code. UNIQUE via migration 0048. */
  code: text('code').notNull(),

  /** `fixed_irr` (IRR amount) or `percentage` (basis points). */
  discountType: text('discount_type', {
    enum: ['fixed_irr', 'percentage'],
  }).notNull(),

  /** IRR amount (fixed_irr) or basis points (percentage). BIGINT. */
  discountValue: irrAmount('discount_value').notNull(),

  /** Mandatory cap for percentage codes; always NULL for fixed_irr. */
  maxCapIrr: irrAmount('max_cap_irr'),

  /** `public` (any profile) or `profile` (gift_code_profiles rows). */
  eligibility: text('eligibility', {
    enum: ['public', 'profile'],
  })
    .notNull()
    .default('public'),

  /** Total redemptions allowed; NULL = unlimited. CHECK > 0. */
  totalLimit: integer('total_limit'),

  /** Redemptions per profile; NULL = unlimited. CHECK > 0. */
  perProfileLimit: integer('per_profile_limit'),

  /** Window start (inclusive). */
  validFrom: timestamptz('valid_from').notNull().defaultNow(),

  /** Window end (exclusive); NULL = no expiry. */
  validUntil: timestamptz('valid_until'),

  /** Minimum order amount in IRR; 0 = no minimum. BIGINT. */
  minOrderAmount: irrAmount('min_order_amount').notNull().default(sql`0`),

  /** Eligible product categories; empty array = all. */
  categories: text('categories').array().notNull().default(sql`'{}'`),

  /** `active` | `inactive`. */
  status: text('status', {
    enum: ['active', 'inactive'],
  })
    .notNull()
    .default('active'),

  /** Admin who created the code. */
  createdBy: text('created_by')
    .notNull()
    .references(() => users.userId, { onDelete: 'restrict' }),
})

/**
 * Profile-restricted eligibility (T-09.12.03).
 *
 * Rows exist ONLY when `gift_codes.eligibility = 'profile'`: each row
 * grants one profile the right to redeem the code. Deleted with the
 * code (CASCADE) — profile scopes are config, not history.
 */
export const giftCodeProfiles = createTable('gift_code_profiles', {
  /** FK gift_codes.id, CASCADE (scope is config). */
  giftCodeId: uuid('gift_code_id')
    .notNull()
    .references(() => giftCodes.id, { onDelete: 'cascade' }),

  /** FK profiles.id, CASCADE. */
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
})

/**
 * Redemption ledger (T-09.12.03) — ONE row per redeemed order.
 *
 * - `status` `consumed` counts against `total_limit`/`per_profile_limit`;
 *   `released` was restored (cancellation before payment) and no longer
 *   counts. Rows are never hard-deleted: the ledger is the audit trail
 *   and the stats source.
 * - `order_id` is UNIQUE (migration 0048): at most one gift code per
 *   order. This is the AUTHORITATIVE association between an order and
 *   its code; `orders.gift_code_id` is a denormalized mirror.
 * - `discount_amount` — the exact IRR discount applied at redemption,
 *   computed by `computeGiftDiscount` (@barghsa/shared/promotions). The
 *   invoice seam applies VAT AFTER this discount on taxable lines.
 *
 * The `order_id` FK also makes orders un-deletable while a redemption
 * exists (ON DELETE RESTRICT) — consistent with the audit-first
 * conventions of the platform.
 */
export const giftCodeRedemptions = createTable('gift_code_redemptions', {
  /** FK gift_codes.id, RESTRICT (codes with history are immutable). */
  giftCodeId: uuid('gift_code_id')
    .notNull()
    .references(() => giftCodes.id, { onDelete: 'restrict' }),

  /** FK profiles.id, RESTRICT (ledger keeps identity). */
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'restrict' }),

  /** FK orders.id, RESTRICT; UNIQUE — one code per order. */
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'restrict' }),

  /** Exact IRR discount applied at redemption (BIGINT). */
  discountAmount: irrAmount('discount_amount').notNull(),

  /** `consumed` (counts) | `released` (restored after cancellation). */
  status: text('status', {
    enum: ['consumed', 'released'],
  })
    .notNull()
    .default('consumed'),
})

/** SQL to create the gift_codes table (migration 0048 source). */
export const createGiftCodesTable = sql`
  CREATE TABLE IF NOT EXISTS gift_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    code TEXT NOT NULL,
    discount_type TEXT NOT NULL,
    discount_value BIGINT NOT NULL,
    max_cap_irr BIGINT,
    eligibility TEXT NOT NULL DEFAULT 'public',
    total_limit INTEGER,
    per_profile_limit INTEGER,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    min_order_amount BIGINT NOT NULL DEFAULT 0,
    categories TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_gift_codes_discount_type
      CHECK (discount_type IN ('fixed_irr', 'percentage')),
    CONSTRAINT chk_gift_codes_eligibility
      CHECK (eligibility IN ('public', 'profile')),
    CONSTRAINT chk_gift_codes_status
      CHECK (status IN ('active', 'inactive')),
    CONSTRAINT chk_gift_codes_discount_value
      CHECK (
        discount_value > 0
        AND (
          (discount_type = 'fixed_irr' AND max_cap_irr IS NULL)
          OR
          (discount_type = 'percentage'
           AND discount_value <= 10000
           AND max_cap_irr IS NOT NULL
           AND max_cap_irr > 0)
        )
      ),
    CONSTRAINT chk_gift_codes_window
      CHECK (valid_until IS NULL OR valid_from < valid_until),
    CONSTRAINT chk_gift_codes_limits
      CHECK (
        (total_limit IS NULL OR total_limit > 0)
        AND (per_profile_limit IS NULL OR per_profile_limit > 0)
      ),
    CONSTRAINT chk_gift_codes_min_order
      CHECK (min_order_amount >= 0)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_codes_code
    ON gift_codes (code);
  CREATE INDEX IF NOT EXISTS idx_gift_codes_status
    ON gift_codes (status);
  CREATE INDEX IF NOT EXISTS idx_gift_codes_valid_from
    ON gift_codes (valid_from);
  CREATE INDEX IF NOT EXISTS idx_gift_codes_valid_until
    ON gift_codes (valid_until);
`

/** SQL to create the gift_code_profiles table (migration 0048 source). */
export const createGiftCodeProfilesTable = sql`
  CREATE TABLE IF NOT EXISTS gift_code_profiles (
    gift_code_id UUID NOT NULL REFERENCES gift_codes(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    PRIMARY KEY (gift_code_id, profile_id)
  );

  CREATE INDEX IF NOT EXISTS idx_gift_code_profiles_profile_id
    ON gift_code_profiles (profile_id);
`

/** SQL to create the gift_code_redemptions table (migration 0048 source). */
export const createGiftCodeRedemptionsTable = sql`
  CREATE TABLE IF NOT EXISTS gift_code_redemptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    gift_code_id UUID NOT NULL REFERENCES gift_codes(id) ON DELETE RESTRICT,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    discount_amount BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'consumed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_gift_code_redemptions_status
      CHECK (status IN ('consumed', 'released'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_code_redemptions_order_id
    ON gift_code_redemptions (order_id);
  CREATE INDEX IF NOT EXISTS idx_gift_code_redemptions_code_status
    ON gift_code_redemptions (gift_code_id, status);
  CREATE INDEX IF NOT EXISTS idx_gift_code_redemptions_code_profile_status
    ON gift_code_redemptions (gift_code_id, profile_id, status);
`

/** SQL to add the gift-code mirror columns to orders (migration 0048 source). */
export const alterOrdersForGiftCodes = sql`
  ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS gift_code_id UUID;

  ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS gift_discount_amount BIGINT;

  CREATE INDEX IF NOT EXISTS idx_orders_gift_code_id
    ON orders (gift_code_id);
`

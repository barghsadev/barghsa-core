import { sql } from 'drizzle-orm'
import { text, timestamp, uuid, pgTable } from 'drizzle-orm/pg-core'
import { uuidv7, irrAmount } from '../types'
import { users } from './users'
import { profiles } from './profiles'
import { products } from './products'

/**
 * Orders table (T-03.04.02).
 *
 * Stores order records for electricity, savings plans, and solar products.
 * Address values are snapshotted (copied, not foreign key) to ensure
 * historical accuracy if the user's saved address changes later.
 *
 * - `id` — UUIDv7 primary key.
 * - `user_id` — foreign key to users.
 * - `profile_id` — foreign key to the active profile at order time.
 * - `product_id` — foreign key to the ordered product.
 * - `order_type` — discriminator: `'electricity'`, `'savings'`, `'solar'`.
 * - `status` — lifecycle: `'DRAFT'` | `'PENDING'` | `'CONFIRMED'` | `'CANCELLED'`.
 * - `snapshot_province_id` — address snapshot: province id (copied).
 * - `snapshot_city_id` — address snapshot: city id (copied).
 * - `snapshot_full_address` — address snapshot: full address text (copied).
 * - `snapshot_postal_code` — address snapshot: postal code (copied).
 * - `created_at` / `updated_at` — audit columns.
 */
export const orders = pgTable(
  'orders',
  {
    /** UUIDv7 opaque order identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Foreign key to the ordering user. */
    userId: text('user_id')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    /** Foreign key to the active profile. */
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),

    /** Foreign key to the ordered product. */
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),

    /** Order type discriminator. */
    orderType: text('order_type', {
      enum: ['electricity', 'savings', 'solar'],
    }).notNull(),

    /** Order lifecycle status. */
    status: text('status', {
      enum: ['DRAFT', 'PENDING', 'CONFIRMED', 'CANCELLED'],
    })
      .notNull()
      .default('DRAFT'),

    /** Address snapshot — province id (copied from profile address). */
    snapshotProvinceId: text('snapshot_province_id').notNull(),

    /** Address snapshot — city id (copied from profile address). */
    snapshotCityId: text('snapshot_city_id').notNull(),

    /** Address snapshot — full address text (copied from profile address). */
    snapshotFullAddress: text('snapshot_full_address').notNull(),

    /** Address snapshot — postal code (copied from profile address). */
    snapshotPostalCode: text('snapshot_postal_code').notNull(),

    /**
     * Gift code applied at order creation (T-09.12.03) — denormalized
     * mirror of the authoritative association in
     * `gift_code_redemptions.order_id` (UNIQUE): at most one gift code
     * per order. Nullable until a code is redeemed on the order. No FK
     * here on purpose — referential integrity and the code link live
     * in the redemption ledger, keeping the schema acyclic.
     */
    giftCodeId: uuid('gift_code_id'),

    /**
     * Exact IRR discount applied by the gift code at redemption time
     * (T-09.12.03). Snapshot for display/history — the ledger row
     * (`gift_code_redemptions.discount_amount`) is the source of truth.
     */
    giftDiscountAmount: irrAmount('gift_discount_amount'),

    /** When the order was created. */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),

    /** Last update timestamp. */
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
)

/**
 * SQL to create the orders table.
 */
export const createOrdersTable = sql`
  CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    order_type TEXT NOT NULL CHECK (order_type IN ('electricity', 'savings', 'solar')),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'CONFIRMED', 'CANCELLED')),
    snapshot_province_id TEXT NOT NULL,
    snapshot_city_id TEXT NOT NULL,
    snapshot_full_address TEXT NOT NULL,
    snapshot_postal_code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_profile_id ON orders (profile_id);
  CREATE INDEX IF NOT EXISTS idx_orders_product_id ON orders (product_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
`

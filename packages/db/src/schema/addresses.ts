import { sql } from 'drizzle-orm'
import { text, boolean, pgTable, timestamp } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../types'
import { profiles } from './profiles'

/**
 * Profile addresses table (T-03.02.02).
 *
 * Each profile can have one or more addresses. A single `main_address`
 * flag is enforced per profile via a partial unique index (only rows with
 * `main_address = true` are constrained).
 *
 * - `id` — UUIDv7 primary key.
 * - `profile_id` — foreign key to profiles, cascading delete.
 * - `province_id` / `city_id` — references to the geography tables.
 * - `full_address` — free-text full address, max 500 chars.
 * - `postal_code` — Iranian postal code (10 digits).
 * - `main_address` — whether this is the profile's main address.
 * - `created_at` / `updated_at` — audit columns.
 */
export const addresses = pgTable(
  'addresses',
  {
    /** UUIDv7 opaque address identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Foreign key to the owning profile. */
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),

    /** Iranian province id. */
    provinceId: text('province_id').notNull(),

    /** Iranian city id. */
    cityId: text('city_id').notNull(),

    /** Full free-text address. */
    fullAddress: text('full_address').notNull(),

    /** Iranian postal code (10 digits). */
    postalCode: text('postal_code').notNull(),

    /** Whether this is the profile's main address. */
    mainAddress: boolean('main_address').notNull().default(false),

    /** When the address was created. */
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
 * SQL to create the addresses table.
 */
export const createAddressesTable = sql`
  CREATE TABLE IF NOT EXISTS addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    province_id TEXT NOT NULL REFERENCES provinces(id) ON DELETE RESTRICT,
    city_id TEXT NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    full_address TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    main_address BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_addresses_profile_id ON addresses (profile_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_main_per_profile ON addresses (profile_id) WHERE main_address = true;
`
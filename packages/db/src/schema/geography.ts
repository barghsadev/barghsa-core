import { sql } from 'drizzle-orm'
import { pgEnum, text, pgTable, timestamp } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../types'

/**
 * Province status enum — active means the province is visible and
 * selectable in user-facing forms; inactive hides it from selection.
 */
export const provinceStatus = pgEnum('province_status', ['active', 'inactive'])

/**
 * Iranian provinces table (T-03.02.02, T-09.02.01).
 *
 * Pre-seeded with all 31 Iranian provinces. Cities are referenced by
 * `province_id` so the frontend can cascade province → city dropdowns.
 * Admin can manage provinces via the admin geography CRUD endpoints.
 */
export const provinces = pgTable('provinces', {
  /** UUIDv7 province identifier. */
  id: uuidv7('id').primaryKey().notNull(),

  /** Province name in Persian. */
  nameFa: text('name_fa').notNull(),

  /** Province name in English. */
  nameEn: text('name_en').notNull(),

  /** Whether the province is active and selectable. */
  status: provinceStatus('status').notNull().default('active'),

  /** When the province was created. */
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),

  /** When the province was last updated (maintained by trigger). */
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
})

/**
 * Iranian cities table (T-03.02.02).
 *
 * Each city belongs to a province. Pre-seeded with major Iranian cities.
 */
export const cityStatus = pgEnum('city_status', ['active', 'inactive'])

/**
 * Iranian cities table (T-03.02.02, T-09.02.02).
 *
 * Each city belongs to a province. Pre-seeded with major Iranian cities.
 * Admin can manage cities via nested CRUD endpoints under provinces.
 */
export const cities = pgTable('cities', {
  /** UUIDv7 city identifier. */
  id: uuidv7('id').primaryKey().notNull(),

  /** Foreign key to the parent province. */
  provinceId: text('province_id').notNull(),

  /** City name in Persian. */
  nameFa: text('name_fa').notNull(),

  /** City name in English. */
  nameEn: text('name_en').notNull(),

  /** Whether the city is active and selectable. */
  status: cityStatus('status').notNull().default('active'),

  /** When the city was created. */
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),

  /** When the city was last updated (maintained by trigger). */
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
})

/**
 * SQL to create the provinces and cities tables.
 */
export const createGeographyTables = sql`
  CREATE TABLE IF NOT EXISTS provinces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    name_fa TEXT NOT NULL,
    name_en TEXT NOT NULL,
    status province_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS cities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    province_id TEXT NOT NULL REFERENCES provinces(id) ON DELETE RESTRICT,
    name_fa TEXT NOT NULL,
    name_en TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_cities_province_id ON cities (province_id);
  CREATE INDEX IF NOT EXISTS idx_provinces_status ON provinces (status);
`
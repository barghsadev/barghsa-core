import { sql } from 'drizzle-orm'
import { text, pgTable, timestamp } from 'drizzle-orm/pg-core'
import { uuidv7 } from '../types'

/**
 * Company types reference table (T-03.02.03).
 *
 * Admin-managed list of legal entity types (e.g., "Private Joint Stock",
 * "Public Joint Stock", "Limited Liability", "Non-Profit", etc.).
 *
 * Pre-seeded with common Iranian company types. Admin can add more via
 * a management UI (future task).
 */
export const companyTypes = pgTable('company_types', {
  /** Unique company type identifier (kebab-case, e.g. 'private-joint-stock'). */
  id: text('id').primaryKey().notNull(),

  /** Company type name in English. */
  nameEn: text('name_en').notNull(),

  /** Company type name in Persian. */
  nameFa: text('name_fa').notNull(),
})

/**
 * Legal profiles extended data table (T-03.02.03).
 *
 * Stores legal entity data that augments the base `profiles` table entries
 * with `profile_type = 'LEGAL'`. Each legal profile has a 1:1 mapping to
 * its corresponding `profiles.id`.
 *
 * - `id` — UUIDv7 primary key (same as `profiles.id`).
 * - `legal_name` — registered legal entity name.
 * - `national_identifier` — 11-digit Iranian national identifier for legal entities.
 * - `registration_number` — company registration number.
 * - `company_type_id` — FK to `company_types`.
 * - `registration_date` — optional registration date.
 * - `economic_code` — optional economic code.
 * - `official_phone` — optional official phone number.
 * - `official_email` — optional official email.
 * - `official_province_id` / `official_city_id` — official address geography.
 * - `official_full_address` — official address free text.
 * - `official_postal_code` — official address postal code.
 * - `representative_title` — authorized representative's title.
 * - `representative_relationship` — representative's relationship to entity.
 * - `created_at` / `updated_at` — audit columns.
 */
export const legalProfiles = pgTable(
  'legal_profiles',
  {
    /** UUIDv7 primary key (same as profiles.id). */
    id: uuidv7('id').primaryKey().notNull(),

    /** Registered legal entity name. */
    legalName: text('legal_name').notNull(),

    /** 11-digit Iranian national identifier for legal entities. */
    nationalIdentifier: text('national_identifier').notNull(),

    /** Company registration number. */
    registrationNumber: text('registration_number').notNull(),

    /** FK to company_types. */
    companyTypeId: text('company_type_id'),

    /** Optional registration date. */
    registrationDate: text('registration_date'),

    /** Optional economic code. */
    economicCode: text('economic_code'),

    /** Optional official phone number. */
    officialPhone: text('official_phone'),

    /** Optional official email. */
    officialEmail: text('official_email'),

    /** Official address province ID. */
    officialProvinceId: text('official_province_id'),

    /** Official address city ID. */
    officialCityId: text('official_city_id'),

    /** Official address free text. */
    officialFullAddress: text('official_full_address'),

    /** Official address postal code. */
    officialPostalCode: text('official_postal_code'),

    /** Authorized representative's title/position. */
    representativeTitle: text('representative_title').notNull(),

    /** Representative's relationship to the entity. */
    representativeRelationship: text('representative_relationship').notNull(),

    /** When the legal profile was created. */
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
 * SQL to create the legal_profiles and company_types tables.
 */
export const createLegalProfilesTables = sql`
  CREATE TABLE IF NOT EXISTS company_types (
    id TEXT PRIMARY KEY,
    name_en TEXT NOT NULL,
    name_fa TEXT NOT NULL
  );

  INSERT INTO company_types (id, name_en, name_fa) VALUES
    ('private-joint-stock', 'Private Joint Stock', 'سهامی خاص'),
    ('public-joint-stock', 'Public Joint Stock', 'سهامی عام'),
    ('limited-liability', 'Limited Liability', 'مسئولیت محدود'),
    ('non-profit', 'Non-Profit', 'غیر تجاری'),
    ('cooperative', 'Cooperative', 'تعاونی'),
    ('sole-proprietorship', 'Sole Proprietorship', 'شخص حقیقی')
  ON CONFLICT (id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS legal_profiles (
    id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    legal_name TEXT NOT NULL,
    national_identifier TEXT NOT NULL,
    registration_number TEXT NOT NULL,
    company_type_id TEXT REFERENCES company_types(id) ON DELETE RESTRICT,
    registration_date TEXT,
    economic_code TEXT,
    official_phone TEXT,
    official_email TEXT,
    official_province_id TEXT,
    official_city_id TEXT,
    official_full_address TEXT,
    official_postal_code TEXT,
    representative_title TEXT NOT NULL,
    representative_relationship TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_profiles_national_identifier
    ON legal_profiles (national_identifier)
    WHERE national_identifier IS NOT NULL;
`
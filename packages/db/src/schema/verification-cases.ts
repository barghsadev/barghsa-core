import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { profiles } from './profiles.js'
import { users } from './users.js'

/**
 * Verification cases table (T-05.02.05).
 *
 * When CRM staff need to correct verified identity fields (firstName, lastName,
 * nationalId, or legal-entity fields), they cannot edit them directly. Instead
 * they create a verification case — a mini-workflow that produces an audit trail.
 *
 * - Cases have states: Open → Under Review → Approved | Rejected
 * - Approved cases update the profile field automatically and record before/after.
 * - Evidence is stored as JSON array of URLs/s3-keys.
 * - Identity fields: firstName, lastName, nationalId (individual profiles)
 *   + legalName, nationalIdentifier (legal profiles via the same workflow).
 */
export const verificationCases = pgTable(
  'verification_cases',
  {
    /** UUIDv7 primary key. */
    id: text('id').primaryKey(),

    /** The profile whose identity field is being corrected. */
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),

    /** The identity field being corrected (e.g. 'first_name', 'last_name', 'national_id'). */
    fieldName: text('field_name').notNull(),

    /** The current value of the field before correction. */
    currentValue: text('current_value'),

    /** The requested new value. */
    requestedValue: text('requested_value').notNull(),

    /** JSON array of evidence URLs/s3-keys (uploaded documents). */
    evidenceUrls: text('evidence_urls').notNull().default('[]'),

    /** Reason/description for the correction request. */
    reason: text('reason').notNull(),

    /** Case status: Open, Under Review, Approved, Rejected. */
    status: text('status', { enum: ['Open', 'Under Review', 'Approved', 'Rejected'] })
      .notNull()
      .default('Open'),

    /** The staff user who created the case (corrector). */
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    /** The staff user who reviewed the case (reviewer). Null until reviewed. */
    reviewedBy: text('reviewed_by')
      .references(() => users.userId, { onDelete: 'restrict' }),

    /** When the review decision was made. Null until reviewed. */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),

    /** Notes from the reviewer (rationale for approval/rejection). */
    reviewerNotes: text('reviewer_notes'),

    /** When the case was created. */
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
 * SQL to create the verification_cases table.
 *
 * Additive — uses IF NOT EXISTS for idempotent deployments.
 */
export const createVerificationCasesTable = sql`
  CREATE TABLE IF NOT EXISTS verification_cases (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    field_name TEXT NOT NULL,
    current_value TEXT,
    requested_value TEXT NOT NULL,
    evidence_urls TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Under Review', 'Approved', 'Rejected')),
    created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    reviewed_by TEXT REFERENCES users(user_id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_verification_cases_profile_id ON verification_cases (profile_id);
  CREATE INDEX IF NOT EXISTS idx_verification_cases_status ON verification_cases (status);
  CREATE INDEX IF NOT EXISTS idx_verification_cases_created_by ON verification_cases (created_by);
  CREATE INDEX IF NOT EXISTS idx_verification_cases_reviewed_by ON verification_cases (reviewed_by);
`
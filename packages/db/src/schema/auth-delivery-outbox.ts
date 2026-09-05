import { sql } from 'drizzle-orm'
import { pgTable, text, uuid, timestamp, integer, index, check } from 'drizzle-orm/pg-core'
import { otpChallenges } from './otp-challenge.js'

export const authDeliveryOutbox = pgTable('auth_delivery_outbox', {
  id: uuid('id').primaryKey(),
  challengeId: text('challenge_id').notNull().references(() => otpChallenges.challengeId),
  codeHash: text('code_hash').notNull(),
  encryptedPayload: text('encrypted_payload'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  leaseToken: uuid('lease_token'),
  providerRef: text('provider_ref'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('auth_delivery_due_idx').on(table.status, table.availableAt),
  check('auth_delivery_status_check', sql`${table.status} IN ('pending','leased','sent','cancelled','dead')`),
  check('auth_delivery_attempts_check', sql`${table.attempts} >= 0`),
])

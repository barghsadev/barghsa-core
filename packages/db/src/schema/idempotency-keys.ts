import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { uuidv7, timestamptz } from '../types'

/**
 * Unified idempotency cache (T-04.2.03.03 / C-04.CC.01).
 *
 * One row per `(idempotencyKey, entityType)`. Retrying a succeeded
 * command returns `response`; a NULL response is an in-flight claim
 * that must not start a second side effect.
 *
 * Wallet-to-invoice payment uses `entityType = 'invoice_wallet_payment'`.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    /** UUIDv7 primary key. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Client-supplied idempotency key. Unique together with entityType. */
    idempotencyKey: text('idempotency_key').notNull(),

    /** Command discriminator (invoice_wallet_payment, …). */
    entityType: text('entity_type').notNull(),

    /** Domain entity the first attempt targeted (invoice id, …). */
    entityId: text('entity_id'),

    /** Cached successful result. NULL while the first attempt is in flight. */
    response: jsonb('response'),

    /** TTL hint for later stale-row cleanup. */
    expiresAt: timestamptz('expires_at'),

    createdAt: timestamptz('created_at').defaultNow().notNull(),

    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    keyNonblank: check(
      'chk_idempotency_keys_key_nonblank',
      sql`char_length(btrim(${table.idempotencyKey})) > 0`,
    ),
    entityTypeNonblank: check(
      'chk_idempotency_keys_entity_type_nonblank',
      sql`char_length(btrim(${table.entityType})) > 0`,
    ),
    /** At most one cached result per (idempotencyKey, entityType). */
    keyEntityTypeUnique: uniqueIndex('uq_idempotency_keys_key_entity_type').on(
      table.idempotencyKey,
      table.entityType,
    ),
    expiresAtIdx: index('idx_idempotency_keys_expires_at')
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} IS NOT NULL`),
  }),
)

/**
 * SQL to create the idempotency_keys table (migration 0073 source).
 */
export const createIdempotencyKeysTable = sql`
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    idempotency_key TEXT NOT NULL
      CONSTRAINT chk_idempotency_keys_key_nonblank
        CHECK (char_length(btrim(idempotency_key)) > 0),
    entity_type TEXT NOT NULL
      CONSTRAINT chk_idempotency_keys_entity_type_nonblank
        CHECK (char_length(btrim(entity_type)) > 0),
    entity_id TEXT,
    response JSONB,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_keys_key_entity_type
    ON idempotency_keys (idempotency_key, entity_type);

  CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
    ON idempotency_keys (expires_at)
    WHERE expires_at IS NOT NULL;
`

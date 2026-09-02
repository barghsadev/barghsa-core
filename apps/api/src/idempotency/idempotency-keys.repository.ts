/**
 * IdempotencyKeysRepository — unique `(idempotencyKey, entityType)`
 * claim + JSONB response cache (T-04.2.03.03 / C-04.CC.01).
 *
 * `uq_idempotency_keys_key_entity_type` is the last-line duplicate
 * guard. Callers insert a claim row (NULL `response`) in the same
 * transaction as the side effect, then persist the cached JSON. A
 * retry either:
 *   - returns the cached response (never a second side effect),
 *   - 409s while the first attempt is still in flight, or
 *   - reclaims an expired in-flight row whose `expires_at` has passed.
 *
 * Successful cached responses are never treated as expired so a retry
 * after TTL still cannot debit twice.
 */

import { Injectable } from '@nestjs/common'
import { isExpiredInFlightIdempotencyClaim } from '@barghsa/shared/finance'

/**
 * Minimal transaction-scoped client. A `pg` PoolClient satisfies it;
 * BEGIN/COMMIT/ROLLBACK belong to the caller.
 */
export interface IdempotencyQueryClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>
}

export type IdempotencyClaimResult =
  | { kind: 'claimed' }
  | { kind: 'cached'; response: unknown; entityId: string | null }
  | { kind: 'in_flight' }

export interface ClaimIdempotencyKeyInput {
  key: string
  entityType: string
  entityId: string
  expiresAt: Date
  now: Date
}

export interface PersistIdempotencyResponseInput {
  key: string
  entityType: string
  entityId: string
  response: unknown
}

@Injectable()
export class IdempotencyKeysRepository {
  /**
   * Claim `(idempotencyKey, entityType)` or load the cached JSON.
   * INSERT … ON CONFLICT DO NOTHING is serialized by the unique index;
   * the loser `SELECT … FOR UPDATE`s the winner's row.
   */
  async claimOrLoad(
    client: IdempotencyQueryClient,
    input: ClaimIdempotencyKeyInput,
  ): Promise<IdempotencyClaimResult> {
    const inserted = await this.insertClaim(client, input)
    if (inserted) return { kind: 'claimed' }

    const existing = await client.query(
      `SELECT entity_id, response, expires_at
         FROM idempotency_keys
        WHERE idempotency_key = $1 AND entity_type = $2
        FOR UPDATE`,
      [input.key, input.entityType],
    )
    const row = existing.rows[0] as
      | { entity_id: string | null; response: unknown; expires_at: Date | string | null }
      | undefined
    if (!row) {
      const retried = await this.insertClaim(client, input)
      if (retried) return { kind: 'claimed' }
      return { kind: 'in_flight' }
    }
    if (row.response == null) {
      if (
        isExpiredInFlightIdempotencyClaim({
          response: row.response,
          expiresAt: row.expires_at,
          now: input.now,
        })
      ) {
        const reclaimed = await this.reclaimExpiredClaim(client, input)
        if (reclaimed) return { kind: 'claimed' }
      }
      return { kind: 'in_flight' }
    }
    return {
      kind: 'cached',
      response: row.response,
      entityId: row.entity_id,
    }
  }

  async persistResponse(
    client: IdempotencyQueryClient,
    input: PersistIdempotencyResponseInput,
  ): Promise<void> {
    await client.query(
      `UPDATE idempotency_keys
          SET response = $3::jsonb,
              entity_id = $4,
              updated_at = NOW()
        WHERE idempotency_key = $1 AND entity_type = $2`,
      [input.key, input.entityType, JSON.stringify(input.response), input.entityId],
    )
  }

  private async insertClaim(
    client: IdempotencyQueryClient,
    input: ClaimIdempotencyKeyInput,
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO idempotency_keys
         (idempotency_key, entity_type, entity_id, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key, entity_type) DO NOTHING
       RETURNING id`,
      [input.key, input.entityType, input.entityId, input.expiresAt],
    )
    return result.rows.length > 0
  }

  private async reclaimExpiredClaim(
    client: IdempotencyQueryClient,
    input: ClaimIdempotencyKeyInput,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE idempotency_keys
          SET entity_id = $3,
              expires_at = $4,
              updated_at = NOW()
        WHERE idempotency_key = $1
          AND entity_type = $2
          AND response IS NULL
          AND expires_at IS NOT NULL
          AND expires_at <= $5
        RETURNING id`,
      [input.key, input.entityType, input.entityId, input.expiresAt, input.now],
    )
    return result.rows.length > 0
  }
}

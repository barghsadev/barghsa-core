import type { Pool } from 'pg';
import { expect } from 'vitest';

export async function expectCoreAudit(
  pool: Pool,
  event: string,
  entityId: string,
  expected: {
    entity: string;
    fromState: string | null;
    toState: string;
    reason: string | null;
    actor: string;
    context: 'staff' | 'customer';
  },
  action?: string,
  idempotencyKey?: string
) {
  const rows = (
    await pool.query(
      `SELECT user_id,metadata::jsonb AS metadata,correlation_id,created_at,operating_context FROM audit_log
     WHERE event=$1 AND metadata::jsonb->>'entityId'=$2
       AND ($3::text IS NULL OR metadata::jsonb->>'action'=$3)
 AND ($4::text IS NULL OR metadata::jsonb->>'idempotencyKey'=$4)`,
      [event, entityId, action ?? null, idempotencyKey ?? null]
    )
  ).rows;
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row.user_id).toBe(expected.actor);
  expect(row.operating_context).toBe(expected.context);
  expect(row.created_at).toBeInstanceOf(Date);
  expect(row.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(row.metadata).toMatchObject({
    entity: expected.entity,
    entityId,
    fromState: expected.fromState,
    toState: expected.toState,
    reason: expected.reason,
  });
}

export async function expectDocumentAuditHistory(pool: Pool, id: string) {
  const events = (
    await pool.query(
      'SELECT revision,previous_state,state,actor_id,reason FROM document_events WHERE document_id=$1',
      [id]
    )
  ).rows;
  const audits = (
    await pool.query(
      `SELECT user_id,metadata::jsonb AS metadata,correlation_id,created_at FROM audit_log WHERE event='document_state_changed' AND metadata::jsonb->>'documentId'=$1`,
      [id]
    )
  ).rows;
  expect(events.length).toBeGreaterThan(0);
  const actual = audits.map((row) => {
    expect(row.metadata).toMatchObject({ entity: 'document', entityId: id });
    expect(row.metadata).toHaveProperty('fromState');
    expect(row.metadata).toHaveProperty('reason');
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    return {
      revision: row.metadata.revision,
      previous_state: row.metadata.fromState,
      state: row.metadata.toState,
      actor_id: row.user_id,
      reason: row.metadata.reason,
    };
  });
  const sort = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).sort();
  expect(sort(actual)).toEqual(sort(events));
}

import type { Pool } from 'pg';
import { expect } from 'vitest';

export async function expectSubmissionAudit(
  pool: Pool,
  input: { event: string; actor: string; entity: string; id: string; state: string }
) {
  const records = (
    await pool.query(
      `SELECT user_id,operating_context,created_at,correlation_id,metadata::jsonb AS metadata
       FROM audit_log WHERE event=$1 AND metadata::jsonb->>'entityId'=$2`,
      [input.event, input.id]
    )
  ).rows;
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    user_id: input.actor,
    operating_context: 'customer',
    created_at: expect.any(Date),
    correlation_id: expect.stringMatching(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
    metadata: {
      entity: input.entity,
      entityId: input.id,
      fromState: null,
      toState: input.state,
      reason: null,
    },
  });
  expect(Number.isFinite(records[0].created_at.getTime())).toBe(true);
}

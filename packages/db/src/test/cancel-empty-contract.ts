import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
/** Seed terminal history through the same immutable evidence required of new writes. */
export async function cancelEmptyContract(pool: Pool, id: string, actor: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const parent = (await client.query('SELECT * FROM contracts WHERE id=$1 FOR UPDATE', [id]))
      .rows[0];
    const intent = randomUUID();
    await client.query(
      `INSERT INTO contract_cancellation_intents(id,contract_id,version_id,actor_id,reason,refund_decision,financial_snapshot,financial_fingerprint,financial_impact_amount,approval_policy,idempotency_key)
   VALUES($1,$2,$3,$4,'Test cancellation','{"refunds":[]}',$5,$6,0,'{"enabled":false}',$7)`,
      [
        intent,
        id,
        parent.current_version_id,
        actor,
        {
          contractId: id,
          versionId: parent.current_version_id,
          profileId: parent.profile_id,
          state: parent.state,
          refundableAmount: '0',
          invoices: [],
        },
        'a'.repeat(64),
        randomUUID(),
      ]
    );
    await client.query(
      "UPDATE contracts SET state='Cancelled',cancelled_at=clock_timestamp() WHERE id=$1",
      [id]
    );
    await client.query(
      'INSERT INTO contract_cancellations(contract_id,intent_id,executed_by) VALUES($1,$2,$3)',
      [id, intent, actor]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

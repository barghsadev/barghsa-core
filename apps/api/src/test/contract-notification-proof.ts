import { expect } from 'vitest';
import type { Pool } from 'pg';
import type { ContractCustomerEvent } from '../notifications/notifications.service.js';

export async function expectContractCustomerDelivery(
  pool: Pool,
  id: string,
  versionId: string,
  event: ContractCustomerEvent
) {
  const contract = (
    await pool.query(
      'SELECT c.profile_id,c.contract_number::text,p.user_id FROM contracts c JOIN profiles p ON p.id=c.profile_id WHERE c.id=$1',
      [id]
    )
  ).rows[0];
  const rows = (
    await pool.query('SELECT * FROM notification_outbox WHERE idempotency_key=$1', [
      `${event}:${id}:${versionId}:${contract.user_id}`,
    ])
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    event_key: event,
    profile_id: contract.profile_id,
    user_id: contract.user_id,
    channels: ['in_app', 'email'],
    payload: { contractNumber: contract.contract_number, link_route: `/contracts/${id}` },
  });
  const inbox = (
    await pool.query(
      "SELECT id,type,profile_id,recipient_user_id,operating_context FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
      [rows[0].id]
    )
  ).rows;
  expect(inbox).toMatchObject([
    {
      type: event,
      profile_id: contract.profile_id,
      recipient_user_id: contract.user_id,
      operating_context: 'customer',
    },
  ]);
  expect(
    (
      await pool.query(
        'SELECT channel,status,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [rows[0].id]
      )
    ).rows
  ).toMatchObject([
    { channel: 'email', status: 'queued', attempts: 0 },
    { channel: 'in_app', status: 'done', attempts: 1, provider_ref: inbox[0].id },
  ]);
  if (event === 'contract.accepted' || event === 'contract.signed') {
    const evidence = (
      await pool.query(
        event === 'contract.accepted'
          ? 'SELECT accepted_at AS occurred_at FROM contract_acceptances WHERE contract_id=$1 AND version_id=$2'
          : 'SELECT recorded_at AS occurred_at FROM contract_signatures WHERE contract_id=$1 AND version_id=$2',
        [id, versionId]
      )
    ).rows[0];
    expect(rows[0].payload[event === 'contract.accepted' ? 'acceptedAt' : 'signedAt']).toBe(
      evidence.occurred_at.toISOString()
    );
  }
  return rows[0];
}

import type { Pool } from 'pg';
import { expect } from 'vitest';
export async function failWalletNotice(
  pool: Pool,
  table: string,
  mode: 'raise' | 'suppress',
  operation = 'INSERT'
) {
  const predicate =
    table === 'notification_outbox'
      ? "NEW.event_key IN ('payment.wallet_topup_completed','payment.wallet_topup_failed')"
      : table === 'in_app_notifications'
        ? "NEW.type IN ('payment.wallet_topup_completed','payment.wallet_topup_failed')"
        : `EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.${table === 'notification_job' ? 'outbox_id' : 'notification_id'} AND o.event_key IN ('payment.wallet_topup_completed','payment.wallet_topup_failed'))`;
  await pool.query(
    `CREATE FUNCTION fail_wallet_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'wallet notice failure';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_wallet_notice BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_wallet_notice()`
  );
  return () =>
    pool.query(`DROP TRIGGER fail_wallet_notice ON ${table}; DROP FUNCTION fail_wallet_notice()`);
}
export async function walletNoticeState(pool: Pool, key: string) {
  const outbox = (
    await pool.query('SELECT * FROM notification_outbox WHERE idempotency_key=$1', [key])
  ).rows;
  const ids = outbox.map((o) => o.id);
  return {
    outbox,
    inbox: (
      await pool.query(
        'SELECT * FROM in_app_notifications WHERE delivery_key=ANY($1::text[]) ORDER BY id',
        [ids.map((id) => `outbox:${id}`)]
      )
    ).rows,
    jobs: (
      await pool.query(
        'SELECT * FROM notification_job WHERE outbox_id=ANY($1::uuid[]) ORDER BY channel',
        [ids]
      )
    ).rows,
    history: (
      await pool.query(
        'SELECT * FROM notification_delivery_log WHERE notification_id=ANY($1::uuid[]) ORDER BY id',
        [ids]
      )
    ).rows,
  };
}
export async function expectWalletNotice(
  pool: Pool,
  key: string,
  userId: string,
  profileId: string,
  event: string,
  amount: string,
  reason?: string
) {
  const saved = await walletNoticeState(pool, key);
  expect(saved.outbox).toHaveLength(1);
  const o = saved.outbox[0];
  expect(o).toMatchObject({
    profile_id: profileId,
    user_id: userId,
    event_key: event,
    channels: ['in_app', 'email'],
    max_attempts: 5,
    idempotency_key: key,
    payload: expect.objectContaining({ amount }),
  });
  expect(saved.inbox).toHaveLength(1);
  const n = saved.inbox[0];
  expect(n).toMatchObject({
    profile_id: profileId,
    recipient_user_id: userId,
    operating_context: 'customer',
    type: event,
    delivery_key: `outbox:${o.id}`,
    link_route: '/wallet',
  });
  expect(n.localized_content.fa.title).toMatch(/[\u0600-\u06ff]/);
  expect(n.localized_content.en.body).toContain(amount);
  if (reason) {
    expect(n.localized_content.fa.body).toContain(reason);
    expect(n.localized_content.en.body).toContain(reason);
  }
  expect(
    saved.jobs.map(({ channel, status, priority, attempts, max_attempts, provider_ref }) => ({
      channel,
      status,
      priority,
      attempts,
      max_attempts,
      provider_ref,
    }))
  ).toEqual([
    {
      channel: 'email',
      status: 'queued',
      priority: 'urgent',
      attempts: 0,
      max_attempts: 5,
      provider_ref: null,
    },
    {
      channel: 'in_app',
      status: 'done',
      priority: 'urgent',
      attempts: 1,
      max_attempts: 5,
      provider_ref: n.id,
    },
  ]);
  expect(
    saved.history.map(({ channel, status, attempt_number, provider_ref }) => ({
      channel,
      status,
      attempt_number,
      provider_ref,
    }))
  ).toEqual([{ channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: n.id }]);
  return saved;
}

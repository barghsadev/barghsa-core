import { expect } from 'vitest';
import type { Pool } from 'pg';

export async function passwordNoticeState(pool: Pool) {
  const tables = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('preauth_sessions','rate_limit_counters','rate_limit_windows') ORDER BY tablename"
    )
  ).rows;
  return Object.fromEntries(
    await Promise.all(
      tables.map(async ({ tablename }) => [
        tablename,
        (
          await pool.query(
            `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${tablename}" t`
          )
        ).rows[0].rows,
      ])
    )
  );
}
export async function expectPasswordNotice(pool: Pool, user: string, secrets: string[]) {
  const audits = (
    await pool.query(
      "SELECT id FROM audit_log WHERE user_id=$1 AND event IN ('password_changed','password_reset')",
      [user]
    )
  ).rows;
  expect(audits).toHaveLength(1);
  const rows = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='auth.password_changed' AND user_id=$1",
      [user]
    )
  ).rows;
  expect(rows).toHaveLength(1);
  const outbox = rows[0];
  expect(outbox).toMatchObject({
    profile_id: null,
    user_id: user,
    channels: ['in_app', 'email'],
    max_attempts: 5,
    idempotency_key: `auth.password_changed:${audits[0].id}:${user}`,
  });
  expect(outbox.payload).toEqual({ auditId: audits[0].id, link_route: '/settings/security' });
  const inbox = (
    await pool.query("SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
      outbox.id,
    ])
  ).rows;
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({
    profile_id: null,
    recipient_user_id: user,
    operating_context: 'account',
    type: 'auth.password_changed',
    link_route: '/settings/security',
    localized_content: {
      en: { title: 'Your password changed' },
      fa: { title: 'رمز عبور شما تغییر کرد' },
    },
  });
  expect(inbox[0].localized_content.en.body).toContain('contact support immediately');
  expect(inbox[0].localized_content.fa.body).toContain('فوراً با پشتیبانی');
  const jobs = (
    await pool.query(
      'SELECT channel,status,priority,attempts,max_attempts,provider_ref,delivery_payload FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
      [outbox.id]
    )
  ).rows;
  expect(jobs).toEqual([
    {
      channel: 'email',
      status: 'queued',
      priority: 'urgent',
      attempts: 0,
      max_attempts: 5,
      provider_ref: null,
      delivery_payload: null,
    },
    {
      channel: 'in_app',
      status: 'done',
      priority: 'urgent',
      attempts: 1,
      max_attempts: 5,
      provider_ref: inbox[0].id,
      delivery_payload: outbox.payload,
    },
  ]);
  const history = (
    await pool.query(
      'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
      [outbox.id]
    )
  ).rows;
  expect(history).toEqual([
    { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox[0].id },
  ]);
  const stored = JSON.stringify({ outbox, inbox, jobs, history });
  for (const secret of secrets) expect(stored).not.toContain(secret);
  return { outbox, inbox: inbox[0] };
}
export async function failPasswordSink(pool: Pool, table: string, mode: 'raise' | 'suppress') {
  const predicate =
    table === 'notification_outbox'
      ? "NEW.event_key='auth.password_changed'"
      : table === 'in_app_notifications'
        ? "NEW.type='auth.password_changed'"
        : `EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.${table === 'notification_job' ? 'outbox_id' : 'notification_id'} AND o.event_key='auth.password_changed')`;
  await pool.query(
    `CREATE FUNCTION fail_password_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'password notice failure';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_password_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_password_notice()`
  );
  return () =>
    pool.query(
      `DROP TRIGGER fail_password_notice ON ${table}; DROP FUNCTION fail_password_notice()`
    );
}
export const passwordFailureCases = [
  'notification_outbox',
  'in_app_notifications',
  'notification_job',
  'notification_delivery_log',
].flatMap((table) => (['raise', 'suppress'] as const).map((mode) => ({ table, mode })));

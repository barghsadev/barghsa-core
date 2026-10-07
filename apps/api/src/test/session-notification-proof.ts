import { expect } from 'vitest';
import type { Pool } from 'pg';
export async function sessionNoticeState(pool: Pool, touchedSession?: string) {
  const tables = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('preauth_sessions','rate_limit_counters','rate_limit_windows') ORDER BY tablename"
    )
  ).rows;
  const state = Object.fromEntries(
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
  if (touchedSession)
    for (const row of state.sessions)
      if (row.session_id === touchedSession) {
        delete row.idle_deadline;
        delete row.updated_at;
      }
  return state;
}
export async function sessionDeliveryState(pool: Pool, user: string) {
  const outbox = (
      await pool.query(
        "SELECT * FROM notification_outbox WHERE event_key='auth.session_revoked' AND user_id=$1 ORDER BY id",
        [user]
      )
    ).rows,
    ids = outbox.map((r) => r.id);
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
        'SELECT * FROM notification_job WHERE outbox_id=ANY($1::uuid[]) ORDER BY outbox_id,channel',
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
export async function expectSessionNotice(
  pool: Pool,
  user: string,
  secrets: string[],
  crm = false
) {
  const saved = await sessionDeliveryState(pool, user);
  expect(saved.outbox).toHaveLength(1);
  const outbox = saved.outbox[0];
  expect(outbox).toMatchObject({
    profile_id: null,
    user_id: user,
    channels: ['in_app', 'email'],
    max_attempts: 5,
    idempotency_key: `auth.session_revoked:${outbox.payload.auditId}:${user}`,
  });
  expect(outbox.payload).toEqual({
    auditId: outbox.payload.auditId,
    link_route: '/settings/security',
  });
  const audit = (await pool.query('SELECT * FROM audit_log WHERE id=$1', [outbox.payload.auditId]))
    .rows;
  expect(audit).toHaveLength(1);
  expect(audit[0].event).toBe(crm ? 'expire_sessions' : 'sessions_revoked');
  if (crm) expect(JSON.parse(audit[0].metadata).targetUserId).toBe(user);
  else {
    expect(audit[0].user_id).toBe(user);
    expect(JSON.parse(audit[0].metadata).changedSessionCount).toBeGreaterThan(0);
  }
  expect(saved.inbox).toHaveLength(1);
  const inbox = saved.inbox[0];
  expect(inbox).toMatchObject({
    profile_id: null,
    recipient_user_id: user,
    operating_context: 'account',
    type: 'auth.session_revoked',
    link_route: '/settings/security',
  });
  expect(inbox.localized_content.fa.title).toMatch(/[\u0600-\u06ff]/);
  expect(inbox.localized_content.en.body).toContain(crm ? 'staff' : 'contact support immediately');
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
      provider_ref: inbox.id,
    },
  ]);
  expect(
    saved.history.map(({ channel, status, attempt_number, provider_ref }) => ({
      channel,
      status,
      attempt_number,
      provider_ref,
    }))
  ).toEqual([
    { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox.id },
  ]);
  for (const secret of secrets) expect(JSON.stringify(saved)).not.toContain(secret);
  return { outbox, inbox };
}
export const sessionFailureCases = [
  'notification_outbox',
  'in_app_notifications',
  'notification_job',
  'notification_delivery_log',
].flatMap((table) => (['raise', 'suppress'] as const).map((mode) => ({ table, mode })));
export async function failSessionSink(pool: Pool, table: string, mode: 'raise' | 'suppress') {
  const predicate =
    table === 'notification_outbox'
      ? "NEW.event_key='auth.session_revoked'"
      : table === 'in_app_notifications'
        ? "NEW.type='auth.session_revoked'"
        : `EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.${table === 'notification_job' ? 'outbox_id' : 'notification_id'} AND o.event_key='auth.session_revoked')`;
  await pool.query(
    `CREATE FUNCTION fail_session_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'session notice failure';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_session_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_session_notice()`
  );
  return () =>
    pool.query(`DROP TRIGGER fail_session_notice ON ${table}; DROP FUNCTION fail_session_notice()`);
}

export async function expectLifecycleNotice(
  pool: Pool,
  user: string,
  reason: string,
  secrets: string[]
) {
  const saved = await sessionDeliveryState(pool, user);
  expect(saved.outbox).toHaveLength(1);
  const outbox = saved.outbox[0];
  expect(outbox).toMatchObject({
    profile_id: null,
    user_id: user,
    channels: ['in_app', 'email'],
    max_attempts: 5,
    idempotency_key: `auth.session_revoked:${outbox.payload.auditId}:${user}`,
  });
  expect(outbox.payload).toEqual({
    auditId: outbox.payload.auditId,
    link_route: '/settings/security',
  });
  const audit = (
    await pool.query(
      'SELECT user_id,event,metadata::jsonb AS metadata FROM audit_log WHERE id=$1',
      [outbox.payload.auditId]
    )
  ).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    user_id: user,
    event: 'session_lifecycle_revoked',
    metadata: { reason, changedSessionCount: 1 },
  });
  expect(saved.inbox).toHaveLength(1);
  const inbox = saved.inbox[0];
  expect(inbox).toMatchObject({
    profile_id: null,
    recipient_user_id: user,
    operating_context: 'account',
    type: 'auth.session_revoked',
    link_route: '/settings/security',
  });
  expect(inbox.localized_content.en.body).toContain('contact support immediately');
  expect(inbox.localized_content.fa.body).toContain('فوراً با پشتیبانی');
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
      provider_ref: inbox.id,
    },
  ]);
  expect(
    saved.history.map(({ channel, status, attempt_number, provider_ref }) => ({
      channel,
      status,
      attempt_number,
      provider_ref,
    }))
  ).toEqual([
    { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox.id },
  ]);
  for (const secret of secrets) expect(JSON.stringify(saved)).not.toContain(secret);
  return { outbox, inbox };
}

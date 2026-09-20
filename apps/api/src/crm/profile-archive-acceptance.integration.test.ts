import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ('archive-acceptance-staff','archive-acceptance-staff','fixture',true),('archive-acceptance-owner','archive-acceptance-owner','fixture',false),('archive-acceptance-agent','archive-acceptance-agent','fixture',false)"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'archive-acceptance-staff',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: 'barghsa_session=' + session,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function profile(type = 'INDIVIDUAL') {
  const id = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status,title) VALUES ($1,'archive-acceptance-owner',$2,'ACTIVE','Retained profile')",
    [id, type]
  );
  return id;
}
const archive = (id: string, locale = 'en', reason = 'Closure requested') =>
  fetch(http.base + '/api/crm/profiles/' + id, {
    method: 'DELETE',
    headers: { ...headers, 'Accept-Language': locale },
    body: JSON.stringify({ reason }),
  });
for (const locale of ['fa', 'en'])
  for (const blocker of ['wallet', 'invoices', 'pendingPayments', 'lastOwner'])
    it('returns specific ' + blocker + ' archival details in ' + locale, async () => {
      const id = await profile(blocker === 'lastOwner' ? 'LEGAL' : 'INDIVIDUAL');
      if (blocker === 'wallet')
        await http.pool.query('INSERT INTO wallets(profile_id,posted_balance) VALUES ($1,100)', [
          id,
        ]);
      if (blocker === 'invoices')
        for (let n = 0; n < 2; n++)
          await http.pool.query(
            "INSERT INTO invoices(profile_id,state,total_amount,paid_amount) VALUES ($1,'Unpaid',100,0)",
            [id]
          );
      if (blocker === 'pendingPayments') {
        await http.pool.query('INSERT INTO wallets(profile_id) VALUES ($1)', [id]);
        await http.pool.query(
          "INSERT INTO wallet_transactions(wallet_id,type,amount,state,idempotency_key) VALUES ($1,'topup',100,'Pending',$2)",
          [id, randomUUID()]
        );
      }
      if (blocker === 'lastOwner')
        await http.pool.query(
          "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'archive-acceptance-agent','Manager'),($1,'archive-acceptance-agent','Finance')",
          [id]
        );
      const response = await archive(id, locale),
        body = (await response.json()) as { error: { code: string; message: string } };
      expect(response.status, http.logs()).toBe(409);
      expect(body.error.code).toBe(
        blocker === 'lastOwner' ? 'CRM:PROFILE:LAST_OWNER' : 'CRM:PROFILE:DELETION_BLOCKED'
      );
      const messages: Record<string, string> =
        locale === 'fa'
          ? {
              wallet: 'موجودی ثبت‌شده یا رزروشده',
              invoices: '۲ فاکتور پرداخت‌نشده',
              pendingPayments: 'تراکنش‌های در انتظار',
              lastOwner: 'نماینده جایگزین مالک قانونی نمی‌شود',
            }
          : {
              wallet: 'posted or reserved',
              invoices: '2 unpaid invoice(s)',
              pendingPayments: 'pending wallet transactions',
              lastOwner: 'An agent cannot replace its legal owner',
            };
      expect(body.error.message).toContain(messages[blocker]);
      expect(
        (await http.pool.query('SELECT user_id,archived FROM profiles WHERE id=$1', [id])).rows[0]
      ).toEqual({ user_id: 'archive-acceptance-owner', archived: false });
      expect(
        (
          await http.pool.query(
            "SELECT id FROM audit_log WHERE event='profile_deleted' AND metadata::jsonb->>'profileId'=$1",
            [id]
          )
        ).rows
      ).toHaveLength(0);
    });
it('soft archival retains business history and records exact target, actor, trimmed reason and time once', async () => {
  const id = await profile(),
    sibling = await profile();
  await http.pool.query(
    "INSERT INTO invoices(profile_id,state,total_amount,paid_amount) VALUES ($1,'Paid',100,100)",
    [id]
  );
  const before = (await http.pool.query('SELECT * FROM invoices WHERE profile_id=$1', [id])).rows;
  const response = await archive(id, 'en', '  Closure requested  '),
    body = (await response.json()) as { success: boolean; profileId: string; archivedAt: string };
  expect(response.status, http.logs()).toBe(200);
  expect(body).toEqual({ success: true, profileId: id, archivedAt: expect.any(String) });
  expect(new Date(body.archivedAt).toISOString()).toBe(body.archivedAt);
  const retained = (
    await http.pool.query(
      'SELECT user_id,archived,archived_reason,archived_at,title FROM profiles WHERE id=$1',
      [id]
    )
  ).rows[0];
  expect(retained).toMatchObject({
    user_id: 'archive-acceptance-owner',
    archived: true,
    archived_reason: 'Closure requested',
    title: 'Retained profile',
  });
  expect(retained.archived_at.toISOString()).toBe(body.archivedAt);
  expect((await http.pool.query('SELECT * FROM invoices WHERE profile_id=$1', [id])).rows).toEqual(
    before
  );
  expect(
    (await http.pool.query('SELECT archived FROM profiles WHERE id=$1', [sibling])).rows[0].archived
  ).toBe(false);
  const events = (
    await http.pool.query(
      "SELECT user_id,metadata::jsonb AS metadata,created_at FROM audit_log WHERE event='profile_deleted' AND metadata::jsonb->>'profileId'=$1",
      [id]
    )
  ).rows;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    user_id: 'archive-acceptance-staff',
    metadata: {
      profileId: id,
      profileOwnerUserId: 'archive-acceptance-owner',
      reason: 'Closure requested',
    },
  });
  expect(events[0].created_at.toISOString()).toBe(body.archivedAt);
  expect((await archive(id)).status).toBe(409);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event='profile_deleted' AND metadata::jsonb->>'profileId'=$1",
        [id]
      )
    ).rows
  ).toHaveLength(1);
});
it('requires a reason without changing the profile or its history', async () => {
  const id = await profile();
  for (const reason of ['', '   ', 'x'.repeat(1001)])
    expect((await archive(id, 'en', reason)).status).toBe(400);
  expect(
    (await http.pool.query('SELECT archived FROM profiles WHERE id=$1', [id])).rows[0].archived
  ).toBe(false);
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string;
let otherProfileId: string;
const ownerHeaders: Record<string, string> = {};
const otherHeaders: Record<string, string> = {};

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const [userId, headers] of [
    ['lifecycle-owner', ownerHeaders],
    ['lifecycle-other', otherHeaders],
  ] as const) {
    await http.pool.query(
      `INSERT INTO users(user_id,username,password_hash)
       VALUES($1,$2,'test-only')`,
      [userId, `${userId}@example.test`]
    );
    const sessionId = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
       VALUES($1,$2,$3,$4,now()+interval '1 day',now()+interval '30 minutes')`,
      [sessionId, userId, csrf, randomUUID()]
    );
    headers.Cookie = `barghsa_session=${sessionId}`;
    headers['X-CSRF-Token'] = csrf;
    headers['Content-Type'] = 'application/json';
  }
  profileId = (
    await http.pool.query(
      `INSERT INTO profiles(user_id,profile_type,status,is_default)
       VALUES('lifecycle-owner','INDIVIDUAL','ACTIVE',true) RETURNING id`
    )
  ).rows[0].id as string;
  otherProfileId = (
    await http.pool.query(
      `INSERT INTO profiles(user_id,profile_type,status,is_default)
       VALUES('lifecycle-other','INDIVIDUAL','ACTIVE',true) RETURNING id`
    )
  ).rows[0].id as string;
}, 40000);

afterAll(async () => {
  await http?.close();
}, 15000);

const preview = () =>
  fetch(`${http.base}/api/tickets/lifecycle-preview`, { headers: ownerHeaders });
const create = (body: unknown, headers = ownerHeaders) =>
  fetch(`${http.base}/api/tickets/lifecycle-requests`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

it('shows active-profile closure blockers and routes each type to one audited support ticket', async () => {
  await http.pool.query(
    `INSERT INTO document_legal_holds(profile_id,reason,initiated_by)
     VALUES($1,'Legal review required','lifecycle-owner')`,
    [profileId]
  );
  await http.pool.query(
    `INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES($1,1000,0)`,
    [profileId]
  );
  const before = await preview();
  expect(before.status, http.logs()).toBe(200);
  const status = await before.json();
  expect(status.profileId).toBe(profileId);
  expect(status.blockers).toContainEqual({
    code: 'legalHold',
    count: 1,
    owner: 'legal',
    nextStep: 'contactSupport',
  });
  expect(status.blockers).toContainEqual({
    code: 'walletBalance',
    count: 1,
    owner: 'customer',
    nextStep: 'settleWallet',
  });
  expect(status.blockers).toContainEqual({
    code: 'securityReview',
    count: 1,
    owner: 'privacy',
    nextStep: 'staffReview',
  });
  const exportKey = randomUUID();
  const exported = await create({ type: 'export', idempotencyKey: exportKey, locale: 'fa' });
  expect(exported.status, http.logs()).toBe(201);
  const exportRequest = await exported.json();
  expect(exportRequest).toMatchObject({ profileId, type: 'export', created: true });
  const repeated = await create({ type: 'export', idempotencyKey: exportKey, locale: 'en' });
  expect(repeated.status, http.logs()).toBe(201);
  expect(await repeated.json()).toMatchObject({
    ticketId: exportRequest.ticketId,
    profileId,
    type: 'export',
    created: false,
  });
  expect((await create({ type: 'closure', idempotencyKey: exportKey, locale: 'en' })).status).toBe(
    409
  );
  const closed = await create({ type: 'closure', idempotencyKey: randomUUID(), locale: 'en' });
  expect(closed.status, http.logs()).toBe(201);
  const closureRequest = await closed.json();
  expect(closureRequest).toMatchObject({ profileId, type: 'closure', created: true });
  const records = await http.pool.query(
    `SELECT id,category,profile_id,privacy_request_type FROM tickets
     WHERE user_id='lifecycle-owner' ORDER BY created_at,id`
  );
  expect(records.rows).toHaveLength(2);
  expect(records.rows.map((row) => row.privacy_request_type).sort()).toEqual(['closure', 'export']);
  expect(
    records.rows.every((row) => row.category === 'privacy' && row.profile_id === profileId)
  ).toBe(true);
  expect(
    (
      await http.pool.query(
        `SELECT count(*)::int AS count FROM audit_log
     WHERE user_id='lifecycle-owner' AND event='profile_lifecycle_requested'`
      )
    ).rows[0].count
  ).toBe(2);
  const secondProfileId = (
    await http.pool.query(
      `INSERT INTO profiles(user_id,profile_type,status,is_default)
       VALUES('lifecycle-owner','LEGAL','ACTIVE',false) RETURNING id`
    )
  ).rows[0].id as string;
  await http.pool.query(
    `INSERT INTO user_profile_contexts(user_id,profile_id)
     VALUES('lifecycle-owner',$1) ON CONFLICT(user_id) DO UPDATE SET profile_id=EXCLUDED.profile_id`,
    [secondProfileId]
  );
  const switched = await (await preview()).json();
  expect(switched.profileId).toBe(secondProfileId);
  expect(switched.requests).toEqual([]);
  expect((await create({ type: 'export', idempotencyKey: exportKey, locale: 'en' })).status).toBe(
    409
  );
  const secondRequest = await create({
    type: 'export',
    idempotencyKey: randomUUID(),
    locale: 'en',
  });
  expect(secondRequest.status, http.logs()).toBe(201);
  expect((await secondRequest.json()).profileId).toBe(secondProfileId);
  await http.pool.query(
    `UPDATE user_profile_contexts SET profile_id=$1 WHERE user_id='lifecycle-owner'`,
    [profileId]
  );
  expect((await (await preview()).json()).requests).toHaveLength(2);
});

it('rejects requests without an active owned profile and never exposes another profile', async () => {
  const other = await fetch(`${http.base}/api/tickets/lifecycle-preview`, {
    headers: otherHeaders,
  });
  expect((await other.json()).profileId).toBe(otherProfileId);
  await http.pool.query(`UPDATE profiles SET archived=true WHERE id=$1`, [otherProfileId]);
  expect(
    (await fetch(`${http.base}/api/tickets/lifecycle-preview`, { headers: otherHeaders })).status
  ).toBe(403);
  expect(
    (await create({ type: 'export', idempotencyKey: randomUUID(), locale: 'en' }, otherHeaders))
      .status
  ).toBe(403);
  expect((await create({ type: 'export', idempotencyKey: 'bad', locale: 'en' })).status).toBe(400);
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { OnboardingDraftsService } from './onboarding-drafts.service.js';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const personal = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const company = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const read = (query = '', user = 'owner') =>
  fetch(`${http.base}/api/onboarding/drafts${query}`, { headers: headers[user]! });
type DraftPage = Awaited<ReturnType<OnboardingDraftsService['list']>>;
async function list(query = '', user = 'owner'): Promise<DraftPage> {
  const response = await read(query, user);
  expect(response.status).toBe(200);
  return (await response.json()) as DraftPage;
}
async function profile(id: string, type = 'INDIVIDUAL', user = 'owner', status = 'DRAFT') {
  await http.pool.query(
    'INSERT INTO profiles(id,user_id,profile_type,status) VALUES($1,$2,$3,$4)',
    [id, user, type, status]
  );
}
async function draft(
  id: string,
  data: Record<string, string> = { firstName: 'Private saved fields', nationalId: '1234567891' },
  days = 0
) {
  await http.pool.query(
    "INSERT INTO profile_onboarding_drafts(profile_id,version,data,updated_at) VALUES($1,4,$2::jsonb,NOW()-($3*INTERVAL '1 day'))",
    [id, JSON.stringify(data), days]
  );
}
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of ['owner', 'other', 'staff']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',$3)",
      [user, `${user}@example.test`, user === 'staff']
    );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
      [session, user, csrf, randomUUID()]
    );
    headers[user] = { Cookie: `barghsa_session=${session}` };
  }
}, 40_000);
afterAll(async () => {
  await http?.close();
}, 15_000);
beforeEach(async () => {
  await http.pool.query('DELETE FROM profile_onboarding_journeys');
  await http.pool.query('DELETE FROM profile_onboarding_drafts');
  await http.pool.query('DELETE FROM profiles');
  await http.pool.query("DELETE FROM app_config WHERE key='electricity.order_draft_ttl_days'");
  await http.pool.query("UPDATE users SET disabled_at=NULL WHERE user_id='owner'");
  await http.pool.query(
    "UPDATE sessions SET revoked_at=NULL,expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes'"
  );
  await profile(personal);
  await profile(company, 'LEGAL');
});
it('lists only owned standalone drafts, with metadata and no saved fields', async () => {
  await draft(personal);
  await http.pool.query("UPDATE profiles SET title='Company base name' WHERE id=$1", [company]);
  await profile(randomUUID(), 'LEGAL', 'other');
  await profile(randomUUID(), 'INDIVIDUAL', 'owner', 'ACTIVE');
  const archived = randomUUID(),
    joined = randomUUID();
  await profile(archived);
  await profile(joined);
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [archived]);
  await http.pool.query(
    "INSERT INTO profile_onboarding_journeys(id,user_id,request_id,individual_profile_id) VALUES($1,'owner',$2,$3)",
    [randomUUID(), randomUUID(), joined]
  );
  const response = await read();
  expect(response.status).toBe(200);
  const body = (await response.json()) as DraftPage;
  expect(body.nextAfter).toBeNull();
  expect(body.drafts.map((p: { id: string }) => p.id)).toEqual([company, personal]);
  expect(body.drafts[0]).toMatchObject({
    name: 'Company base name',
    profileType: 'LEGAL',
    hasDraft: false,
    expired: false,
    updatedAt: null,
  });
  expect(body.drafts[1]).toMatchObject({
    name: null,
    hasDraft: true,
    expired: false,
    updatedAt: expect.any(String),
  });
  expect(Object.keys(body.drafts[1]!).sort()).toEqual([
    'createdAt',
    'expired',
    'hasDraft',
    'id',
    'name',
    'profileType',
    'updatedAt',
  ]);
  expect(JSON.stringify(body)).not.toContain('Private saved fields');
  expect(JSON.stringify(body)).not.toContain('1234567891');
});
it('paginates deterministically and survives finalization of the cursor profile', async () => {
  const ids = Array.from({ length: 51 }, () => randomUUID());
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status) SELECT unnest($1::uuid[]),'owner','INDIVIDUAL','DRAFT'",
    [ids]
  );
  const all = [...ids, personal, company].sort().reverse();
  const first = await list();
  expect(first.drafts.map((p: { id: string }) => p.id)).toEqual(all.slice(0, 50));
  expect(first.nextAfter).toBe(all[49]);
  await http.pool.query("UPDATE profiles SET status='ACTIVE' WHERE id=$1", [first.nextAfter]);
  const second = await list(`?after=${first.nextAfter}`);
  expect(second.drafts.map((p: { id: string }) => p.id)).toEqual(all.slice(50));
  expect(second.nextAfter).toBeNull();
});
it('marks expired data without clearing it, then restarts on the same profile through the existing read', async () => {
  await draft(personal, undefined, 8);
  await draft(company, {}, 8);
  const body = await list();
  expect(body.drafts[1]).toMatchObject({ hasDraft: true, expired: true });
  expect(body.drafts[0]).toMatchObject({ hasDraft: false, expired: false, updatedAt: null });
  expect(
    (
      await http.pool.query(
        'SELECT version,data FROM profile_onboarding_drafts WHERE profile_id=$1',
        [personal]
      )
    ).rows[0]
  ).toMatchObject({ version: 4, data: { firstName: 'Private saved fields' } });
  const restored = await fetch(`${http.base}/api/onboarding/draft/${personal}`, {
    headers: headers.owner!,
  });
  expect(await restored.json()).toEqual({ version: 5, data: {} });
  expect((await list()).drafts[1]).toMatchObject({ id: personal, hasDraft: false, expired: false });
  expect(
    (await http.pool.query("SELECT COUNT(*)::int AS count FROM profiles WHERE user_id='owner'"))
      .rows[0].count
  ).toBe(2);
});
it('uses current shared retention settings and refuses corrupt settings without mutating drafts', async () => {
  await draft(personal, undefined, 8);
  const setting = async (value: unknown) =>
    http.pool.query(
      "INSERT INTO app_config(key,value) VALUES('electricity.order_draft_ttl_days',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
      [JSON.stringify(value)]
    );
  await setting(14);
  expect((await list()).drafts[1]!.expired).toBe(false);
  await setting(3);
  expect((await list()).drafts[1]!.expired).toBe(true);
  await setting('broken');
  expect((await read()).status).toBe(503);
  expect(
    (
      await http.pool.query('SELECT version FROM profile_onboarding_drafts WHERE profile_id=$1', [
        personal,
      ])
    ).rows[0].version
  ).toBe(4);
});
for (const query of [
  '?after=wrong',
  '?after=',
  '?after=' + personal + '&after=' + company,
  '?limit=100',
  '?after[foo]=' + personal,
])
  it(`rejects malformed or unsupported query ${query}`, async () => {
    expect((await read(query)).status).toBe(400);
  });
it('returns no foreign profiles even when a foreign cursor is supplied', async () => {
  const foreign = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  await profile(foreign, 'LEGAL', 'other');
  expect((await list(`?after=${foreign}`)).drafts.map((p: { id: string }) => p.id)).toEqual([
    company,
    personal,
  ]);
  expect((await list('', 'other')).drafts.map((p: { id: string }) => p.id)).toEqual([foreign]);
});
it('requires a live customer session and refuses disabled accounts', async () => {
  expect((await fetch(`${http.base}/api/onboarding/drafts`)).status).toBe(401);
  expect((await read('', 'staff')).status).toBe(403);
  await http.pool.query("UPDATE sessions SET revoked_at=NOW() WHERE user_id='owner'");
  expect((await read()).status).toBe(401);
  await http.pool.query("UPDATE sessions SET revoked_at=NULL WHERE user_id='owner'");
  await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='owner'");
  expect((await read()).status).toBe(401);
});

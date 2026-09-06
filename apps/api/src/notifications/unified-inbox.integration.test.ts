import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { encodeCursor } from './notification-center.service.js';
import { NotificationsService } from './notifications.service.js';
const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => db.pool,
}));
let fixture: Awaited<ReturnType<typeof startHttpFixture>>, profile: string, second: string;
const headers: Record<string, Record<string, string>> = {};
const service = new NotificationsService();
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
  db.pool = fixture.pool;
  for (const user of ['inbox-owner', 'inbox-agent', 'inbox-alone']) {
    await db.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)', [
      user,
      `${user}@example.test`,
      'test-only',
    ]);
    const session = randomUUID(),
      csrf = randomUUID();
    await db.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  profile = (
    await db.pool.query(
      "INSERT INTO profiles(user_id,profile_type,is_default,status) VALUES ('inbox-owner','LEGAL',true,'ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  second = (
    await db.pool.query(
      "INSERT INTO profiles(user_id,status) VALUES ('inbox-owner','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  await db.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'inbox-agent','Finance')",
    [profile]
  );
  await db.pool.query(
    "INSERT INTO user_profile_contexts(user_id,profile_id) VALUES ('inbox-agent',$1)",
    [profile]
  );
}, 40000);
afterAll(async () => {
  await fixture?.close();
});
async function request(user: string, path: string, method = 'GET') {
  return fetch(`${fixture.base}/api/${path}`, { method, headers: headers[user]! });
}
it('shows account notices without a profile and keeps read actions private on both APIs', async () => {
  const notice = await service.create({
    userId: 'inbox-alone',
    type: 'general',
    title: 'Account notice',
    body: 'Original text',
    link: '/app/settings/profile',
  });
  const page = (await (await request('inbox-alone', 'v1/notifications')).json()) as {
    data: Array<{ id: string; linkRoute: string; localizedContent: unknown }>;
    unread_count: number;
  };
  expect(page.data).toHaveLength(1);
  expect(page.data[0]).toMatchObject({
    id: notice.id,
    linkRoute: '/settings/profile',
    localizedContent: { original: { title: 'Account notice', body: 'Original text' } },
  });
  expect(page.unread_count).toBe(1);
  expect((await request('inbox-owner', `v1/notifications/${notice.id}/read`, 'PATCH')).status).toBe(
    404
  );
  expect((await request('inbox-alone', `notifications/${notice.id}/read`, 'PATCH')).status).toBe(
    200
  );
  expect(await (await request('inbox-alone', 'v1/notifications/unread-count')).json()).toEqual({
    unread_count: 0,
  });
  expect(
    (
      await db.pool.query('SELECT count(*)::int AS count FROM notifications WHERE id=$1', [
        notice.id,
      ])
    ).rows[0].count
  ).toBe(0);
});
it('filters private profile notices from agents and other profile selections', async () => {
  const first = await service.create({
    userId: 'inbox-owner',
    profileId: profile,
    type: 'profile_verified',
    title: 'Verified profile',
  });
  const other = await service.create({
    userId: 'inbox-owner',
    profileId: second,
    type: 'general',
    title: 'Second profile',
  });
  const publicId = (
    await db.pool.query(
      "INSERT INTO in_app_notifications(profile_id,type,title_i18n_key,body_i18n_key) VALUES ($1,'general','public.title','public.body') RETURNING id",
      [profile]
    )
  ).rows[0].id;
  const owner = (await (await request('inbox-owner', 'v1/notifications')).json()) as {
    data: Array<{ id: string }>;
  };
  expect(owner.data.map((row) => row.id).sort()).toEqual([first.id, publicId].sort());
  const agent = (await (await request('inbox-agent', 'v1/notifications')).json()) as {
    data: Array<{ id: string }>;
  };
  expect(agent.data.map((row) => row.id)).toEqual([publicId]);
  expect((await request('inbox-agent', `v1/notifications/${first.id}/read`, 'PATCH')).status).toBe(
    404
  );
  expect((await request('inbox-owner', `notifications/${other.id}/read`, 'PATCH')).status).toBe(
    404
  );
  await db.pool.query(
    "INSERT INTO user_profile_contexts(user_id,profile_id) VALUES ('inbox-owner',$1)",
    [second]
  );
  const switched = (await (await request('inbox-owner', 'v1/notifications')).json()) as {
    data: Array<{ id: string }>;
  };
  expect(switched.data.map((row) => row.id)).toEqual([other.id]);
  await db.pool.query("DELETE FROM profile_agents WHERE profile_id=$1 AND user_id='inbox-agent'", [
    profile,
  ]);
  expect(await (await request('inbox-agent', 'v1/notifications/unread-count')).json()).toEqual({
    unread_count: 0,
  });
});

it('walks all newer and older pages without skipping notices, including equal timestamps', async () => {
  await db.pool.query("DELETE FROM in_app_notifications WHERE recipient_user_id='inbox-alone'");
  const ids: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    ids.push(id);
    await db.pool.query(
      `INSERT INTO in_app_notifications(id,recipient_user_id,type,title_i18n_key,body_i18n_key,created_at)
      VALUES ($1,'inbox-alone','general','title','body','2026-09-01T00:00:00Z')`,
      [id]
    );
  }
  for (const direction of ['older', 'newer']) {
    let cursor = encodeCursor(
      '2026-09-01T00:00:00Z',
      direction === 'newer'
        ? '00000000-0000-4000-8000-000000000000'
        : 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    );
    const seen: string[] = [];
    for (let n = 0; n < 10; n++) {
      const response = await request(
        'inbox-alone',
        `v1/notifications?limit=2&direction=${direction}&cursor=${cursor}`
      );
      expect(response.status).toBe(200);
      const page = (await response.json()) as {
        data: Array<{ id: string }>;
        next_cursor: string | null;
      };
      const pageIds = page.data.map((row) => row.id);
      expect(pageIds).toEqual([...pageIds].sort().reverse());
      seen.push(...pageIds);
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    expect(seen).toHaveLength(ids.length);
    expect([...seen].sort()).toEqual(ids);
  }
  const newest = (await (
    await request('inbox-alone', 'v1/notifications?limit=2&direction=newer')
  ).json()) as { data: Array<{ id: string }> };
  expect(newest.data.map((row) => row.id)).toEqual(ids.slice(-2).reverse());
});
it('rejects malformed cursor UUIDs and read IDs without database errors', async () => {
  const cursor = Buffer.from('2026-09-01T00:00:00Z|not-a-uuid').toString('base64url');
  expect((await request('inbox-alone', `v1/notifications?cursor=${cursor}`)).status).toBe(400);
  for (const prefix of ['v1/notifications', 'notifications']) {
    expect((await request('inbox-alone', `${prefix}/not-a-uuid/read`, 'PATCH')).status).toBe(400);
  }
});

it('preserves sub-millisecond database timestamps in page cursors', async () => {
  await db.pool.query("DELETE FROM in_app_notifications WHERE recipient_user_id='inbox-alone'");
  const ids: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const id = randomUUID();
    ids.push(id);
    await db.pool.query(
      `INSERT INTO in_app_notifications(id,recipient_user_id,type,title_i18n_key,body_i18n_key,created_at)
      VALUES ($1,'inbox-alone','general','title','body',$2)`,
      [id, `2026-09-01T00:00:00.00000${i}Z`]
    );
  }
  for (const direction of ['newer', 'older']) {
    let cursor = encodeCursor(
      direction === 'newer' ? '2026-08-31T00:00:00Z' : '2026-09-02T00:00:00Z',
      randomUUID()
    );
    const seen: string[] = [];
    for (let n = 0; n < 5; n++) {
      const page = (await (
        await request(
          'inbox-alone',
          `v1/notifications?limit=1&direction=${direction}&cursor=${cursor}`
        )
      ).json()) as { data: Array<{ id: string }>; next_cursor: string | null };
      seen.push(...page.data.map((row) => row.id));
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    expect(seen).toEqual(direction === 'newer' ? ids : [...ids].reverse());
  }
});

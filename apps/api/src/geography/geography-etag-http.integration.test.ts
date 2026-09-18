import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let session: string;
let province: string;
let profile: string;
let cookie: string;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('etag-reader','etag-reader@example.test','test')"
  );
  session = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'etag-reader',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour')",
    [session, randomUUID(), randomUUID()]
  );
  cookie = `barghsa_session=${session}`;
  province = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES ('استان','Province') RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    "INSERT INTO cities(province_id,name_fa,name_en) VALUES ($1,'شهر','City')",
    [province]
  );
  await http.pool.query(
    "INSERT INTO company_types(id,name_fa,name_en) VALUES ('etag-company','شرکت','Company')"
  );
  profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('etag-reader','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
}, 40000);
afterAll(async () => http?.close());
const get = (path: string, etag?: string, authenticated = true) =>
  fetch(`${http.base}/api/${path}`, {
    cache: 'force-cache',
    headers: { ...(authenticated ? { cookie } : {}), ...(etag ? { 'If-None-Match': etag } : {}) },
  });

it.each(['provinces', 'cities', 'company-types'])(
  'negotiates current %s reference data without exposing it publicly',
  async (kind) => {
    const path = `geography/${kind === 'cities' ? `provinces/${province}/cities` : kind}`;
    const first = await get(path);
    expect(first.status).toBe(200);
    const tag = first.headers.get('etag');
    expect(tag).toMatch(/^"[A-Za-z0-9+/=]+"$/);
    expect(first.headers.get('cache-control')).toBe('private, no-cache, no-store, must-revalidate');
    const { createHash } = await import('node:crypto');
    expect(tag).toBe(
      `"${createHash('sha256')
        .update(await first.text())
        .digest('base64')}"`
    );
    for (const match of [tag!, `W/${tag}`, `"other", W/${tag}`, '*']) {
      const response = await get(path, match);
      expect(response.status).toBe(304);
      expect(await response.text()).toBe('');
      expect(response.headers.get('etag')).toBe(tag);
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    expect((await get(path, tag!, false)).status).toBe(401);
  }
);
it('returns new reference data after a committed change instead of trusting the old tag', async () => {
  const first = await get('geography/provinces');
  const tag = first.headers.get('etag')!;
  await http.pool.query("UPDATE provinces SET name_en='Changed' WHERE id=$1", [province]);
  const changed = await get('geography/provinces', tag);
  expect(changed.status).toBe(200);
  expect(changed.headers.get('etag')).not.toBe(tag);
  expect(await changed.json()).toContainEqual(
    expect.objectContaining({ id: province, nameEn: 'Changed' })
  );
});
it('never negotiates profile-scoped or financial payloads', async () => {
  for (const path of ['profiles', `wallet/${profile}`]) {
    const response = await get(path, '*');
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).not.toBe('');
    const head = await fetch(`${http.base}/api/${path}`, {
      method: 'HEAD',
      cache: 'force-cache',
      headers: { cookie, 'If-None-Match': '*' },
    });
    expect(head.status).toBe(200);
    expect(head.headers.get('etag')).toBeNull();
    expect(await head.text()).toBe('');
  }
});
it('checks session revocation before a matching-tag response', async () => {
  const first = await get('geography/provinces');
  await http.pool.query('DELETE FROM sessions WHERE session_id=$1', [session]);
  const revoked = await get('geography/provinces', first.headers.get('etag')!);
  expect(revoked.status).toBe(401);
  expect(revoked.headers.get('etag')).toBeNull();
});

import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin,is_staff) VALUES ('branding-review','branding-review@example.test','test-only',true,true)"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'branding-review',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
    [session, csrf, randomUUID()]
  );
  headers = {
    cookie: `barghsa_session=${session}`,
    'x-csrf-token': csrf,
    'content-type': 'application/json',
  };
}, 40_000);
beforeEach(async () => {
  await http.pool.query('DELETE FROM brand_config');
});
afterAll(async () => {
  await http?.close();
});
const request = (path: string, method = 'GET', body?: unknown) =>
  fetch(`${http.base}/api/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const publicConfig = async () => {
  const response = await fetch(`${http.base}/api/public/branding/config`);
  expect(response.status).toBe(200);
  return response.json();
};
it('does not publish the first draft and still lets staff preview it', async () => {
  const draft = await request('admin/branding/config', 'PUT', {
    config: { appTitle: 'Unpublished title' },
  });
  expect(draft.status).toBe(200);
  expect(await publicConfig()).toMatchObject({ appTitle: 'Barghsa' });
  expect(await (await request('admin/branding/config')).json()).toMatchObject({
    config: { appTitle: 'Unpublished title' },
    status: 'draft',
  });
});
it('publishes only after activation and retains the active values while editing the next draft', async () => {
  expect(
    (await request('admin/branding/config', 'PUT', { config: { appTitle: 'Published title' } }))
      .status
  ).toBe(200);
  expect((await request('admin/branding/activate', 'POST')).status).toBe(200);
  expect(await publicConfig()).toMatchObject({ appTitle: 'Published title' });
  expect(
    (await request('admin/branding/config', 'PUT', { config: { appTitle: 'Next draft' } })).status
  ).toBe(200);
  expect(await publicConfig()).toMatchObject({ appTitle: 'Published title' });
});

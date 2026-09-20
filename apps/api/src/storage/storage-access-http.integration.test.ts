import { ErrorCodes } from '@barghsa/shared/errors';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let adminHeaders: Record<string, string>, financeHeaders: Record<string, string>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const [userId, admin] of [
    ['storage-admin', true],
    ['storage-finance', false],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_admin,is_staff) VALUES ($1,$2,'test-only',$3,true)",
      [userId, `${userId}@example.test`, admin]
    );
    if (!admin)
      await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-finance')", [
        userId,
      ]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
      [session, userId, csrf, randomUUID()]
    );
    const headers = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    if (admin) adminHeaders = headers;
    else financeHeaders = headers;
  }
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
const paths = [
  ['GET', 'config'],
  ['PUT', 'config'],
  ['POST', 'test-connection'],
  ['GET', 'records/example'],
  ['POST', 'records/example/sign'],
  ['DELETE', 'records/example'],
] as const;
it('requires authentication and storage permission for every storage administration route', async () => {
  for (const [method, path] of paths) {
    const request = (headers: Record<string, string>) =>
      fetch(`${http.base}/api/admin/storage/${path}`, {
        method,
        headers,
        ...(method !== 'GET' && method !== 'DELETE' ? { body: '{}' } : {}),
      });
    expect(
      (await request({ 'Content-Type': 'application/json' })).status,
      `${method} ${path}`
    ).toBe(401);
    expect((await request(financeHeaders)).status, `${method} ${path}`).toBe(403);
  }
});
it('requires CSRF and recent step-up before any storage mutation or connection probe', async () => {
  for (const [method, path] of paths.filter(([method]) => method !== 'GET')) {
    const withoutCsrf = await fetch(`${http.base}/api/admin/storage/${path}`, {
      method,
      headers: { Cookie: adminHeaders.Cookie!, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(withoutCsrf.status).toBe(403);
    expect(await withoutCsrf.json()).not.toHaveProperty('requiresStepUp');
    const response = await fetch(`${http.base}/api/admin/storage/${path}`, {
      method,
      headers: adminHeaders,
      body: '{}',
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { requiresStepUp?: boolean; error?: unknown };
    expect(body, `${method} ${path}`).toMatchObject({
      error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code },
      requiresStepUp: true,
    });
  }
});
it('allows an administrator to read configuration without returning the secret key', async () => {
  const response = await fetch(`${http.base}/api/admin/storage/config`, { headers: adminHeaders });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data).toHaveProperty('hasSecretKey');
  expect(data).not.toHaveProperty('secretAccessKey');
  expect(data).not.toHaveProperty('S3_SECRET_ACCESS_KEY');
});

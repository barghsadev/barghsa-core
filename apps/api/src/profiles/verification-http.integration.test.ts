import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('verification-user','verification@example.test','test-only')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
    VALUES ($1,'verification-user',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
async function post(path: string, body: unknown = {}) {
  return fetch(`${http.base}/api/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
it.each(['API', 'MANUAL', 'DISABLED'])(
  'uses canonical %s mode for submission and never manufactures approval',
  async (mode) => {
    // Deliberately conflicting old keys: canonical admin configuration must win.
    await http.pool.query(
      `INSERT INTO app_config(key,value) VALUES
    ('profile_verification_mode',$1::jsonb),('verification.required','false'),('verification.method','"api"')`,
      [JSON.stringify(mode)]
    );
    const started = await post('onboarding/start', { profileType: 'INDIVIDUAL' });
    expect(started.status).toBe(201);
    const { profileId } = (await started.json()) as { profileId: string };
    const completed = await post(`onboarding/complete/${profileId}`);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      status: mode === 'DISABLED' ? 'ACTIVE' : 'PENDING_VERIFICATION',
    });
    const context = await fetch(`${http.base}/api/profiles/verification-status`, { headers });
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({
      activeProfileId: profileId,
      verificationRequired: mode !== 'DISABLED',
      canAutoVerify: false,
      isVerified: false,
    });
    for (let i = 0; i < 2; i++) {
      const result = await post(`profiles/${profileId}/verify`);
      expect(result.status).toBe(503);
      expect(await result.json()).toMatchObject({
        error: {
          code: 'VERIFICATION:PROVIDER:UNAVAILABLE',
          message: 'Automatic identity verification is currently unavailable.',
        },
      });
    }
    expect(
      (await http.pool.query('SELECT status,is_default FROM profiles WHERE id=$1', [profileId]))
        .rows[0]
    ).toEqual({
      status: mode === 'DISABLED' ? 'ACTIVE' : 'PENDING_VERIFICATION',
      is_default: true,
    });
    expect(
      (
        await http.pool.query(
          "SELECT count(*)::int AS count FROM notifications WHERE user_id='verification-user'"
        )
      ).rows[0].count
    ).toBe(0);
  }
);

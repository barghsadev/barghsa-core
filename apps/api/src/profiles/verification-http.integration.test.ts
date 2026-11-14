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
    expect((await post(`onboarding/complete/${profileId}`)).status).toBe(400);
    const provinceId = (
      await http.pool.query(
        "INSERT INTO provinces(name_fa,name_en) VALUES ('استان','Province') RETURNING id"
      )
    ).rows[0].id;
    const cityId = (
      await http.pool.query(
        "INSERT INTO cities(province_id,name_fa,name_en) VALUES ($1,'شهر','City') RETURNING id",
        [provinceId]
      )
    ).rows[0].id;
    expect(
      (
        await post(`onboarding/individual/${profileId}`, {
          firstName: 'Person',
          lastName: 'Owner',
          nationalId: '1234567891',
          provinceId,
          cityId,
          fullAddress: 'Street',
          postalCode: '1234567890',
        })
      ).status
    ).toBe(200);
    const completed = await post(`onboarding/complete/${profileId}`);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      status: mode === 'DISABLED' ? 'ACTIVE' : 'PENDING_VERIFICATION',
    });
    const context = await fetch(`${http.base}/api/profiles/verification-status`, { headers });
    expect(context.status, http.logs()).toBe(200);
    const contextBody = (await context.json()) as Record<string, unknown>;
    expect(contextBody).toMatchObject({
      activeProfileId: profileId,
      verificationRequired: mode !== 'DISABLED',
      canAutoVerify: false,
      isVerified: false,
    });
    const submission = (
      await http.pool.query(
        `SELECT created_at FROM audit_log WHERE event IN ('individual_profile_saved','profile_onboarding_completed')
         AND metadata::jsonb->>'profileId'=$1::text ORDER BY created_at DESC,id DESC LIMIT 1`,
        [profileId]
      )
    ).rows[0];
    if (mode === 'DISABLED') {
      expect(contextBody.verificationSubmittedAt).toBeNull();
    } else {
      expect(submission).toBeDefined();
      expect(contextBody.verificationSubmittedAt).toBe(submission.created_at.toISOString());
      await http.pool.query(
        "UPDATE in_app_notifications SET is_read=true WHERE recipient_user_id='verification-user'"
      );
      expect(
        await (await fetch(`${http.base}/api/profiles/verification-status`, { headers })).json()
      ).toMatchObject({
        verificationSubmittedAt: contextBody.verificationSubmittedAt,
        verificationNotice: null,
      });
      const later = new Date(submission.created_at.getTime() + 60_000).toISOString();
      await http.pool.query(
        `INSERT INTO users(user_id,username,password_hash) VALUES ('other-verification-user','other-verification@example.test','test-only')`
      );
      await http.pool.query(
        `INSERT INTO in_app_notifications(id,recipient_user_id,profile_id,type,title_i18n_key,body_i18n_key,is_read,created_at)
         VALUES (uuid_generate_v7(),'verification-user',$1,'profile_pending','pending','pending',true,$2),
                (uuid_generate_v7(),'other-verification-user',$1,'profile_pending','private','private',false,$2::timestamptz+INTERVAL '1 minute')`,
        [profileId, later]
      );
      expect(
        await (await fetch(`${http.base}/api/profiles/verification-status`, { headers })).json()
      ).toMatchObject({ verificationSubmittedAt: later, verificationNotice: null });
    }
    const verifyPath = `profiles/${profileId}/verify`;
    const invalid = await post(verifyPath, { profileId: randomUUID() });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'VALIDATION:INPUT:INVALID' } });
    for (const result of [
      await post(verifyPath),
      await fetch(`${http.base}/api/${verifyPath}`, { method: 'POST', headers }),
    ]) {
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

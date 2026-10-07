import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { fetchWithPreauth } from '../test/public-auth.js';
import { startHttpFixture } from '../test/http-fixture.js';
import {
  sessionNoticeState,
  failNewDeviceSink,
  expectNewDeviceNotice,
} from '../test/session-notification-proof.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const user = 'login-notice-user',
  device = 'ab'.repeat(32),
  fingerprint = createHash('sha256').update(device).digest('hex');
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,'login-notice@example.test','fixture')",
    [user]
  );
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
async function challenge() {
  const id = randomUUID();
  await http.pool.query(
    "INSERT INTO otp_challenges(challenge_id,destination,otp_hash,purpose,user_id,auth_version,expires_at) SELECT $1,username,$2,'login',user_id,auth_version,clock_timestamp()+interval '5 minutes' FROM users WHERE user_id=$3",
    [id, createHash('sha256').update('123456').digest('hex'), user]
  );
  return id;
}
const complete = (id: string, trustDevice = true) =>
  fetchWithPreauth(`${http.base}/api/auth/login/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `barghsa_device=${device}` },
    body: JSON.stringify({ challengeId: id, otp: '123456', trustDevice }),
  });
const failures = [
  'audit_log',
  'notification_outbox',
  'in_app_notifications',
  'notification_job',
  'notification_delivery_log',
].flatMap((table) => (['raise', 'suppress'] as const).map((mode) => ({ table, mode })));
it.each(failures)('rolls back OTP,session,trust and $table on $mode', async ({ table, mode }) => {
  const id = await challenge(),
    before = await sessionNoticeState(http.pool),
    drop = await failNewDeviceSink(http.pool, table, mode);
  try {
    expect((await complete(id)).status).toBe(500);
    expect(await sessionNoticeState(http.pool)).toEqual(before);
  } finally {
    await drop();
  }
  const response = await complete(id);
  expect(response.status, http.logs()).toBe(200);
  const result = (await response.json()) as {
    sessionId: string;
    csrfToken: string;
    refreshToken: string;
  };
  await expectNewDeviceNotice(http.pool, user, 'new_device_login', [
    id,
    device,
    fingerprint,
    result.sessionId,
    result.csrfToken,
    result.refreshToken,
    '123456',
  ]);
  expect(
    (await http.pool.query('SELECT consumed_at FROM otp_challenges WHERE challenge_id=$1', [id]))
      .rows[0].consumed_at
  ).not.toBeNull();
  expect(
    (await http.pool.query('SELECT device_fingerprint FROM device_trusts WHERE user_id=$1', [user]))
      .rows
  ).toEqual([{ device_fingerprint: fingerprint }]);
  const delivered = await sessionNoticeState(http.pool);
  expect((await complete(id)).status).toBe(409);
  expect(await sessionNoticeState(http.pool)).toEqual(delivered);
});
it('serializes concurrent first-device logins into one alert and preserves known-device no-op', async () => {
  const first = await challenge(),
    second = await challenge();
  const responses = await Promise.all([complete(first), complete(second)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  await expectNewDeviceNotice(http.pool, user, 'new_device_login', [
    device,
    fingerprint,
    first,
    second,
    '123456',
  ]);
  const third = await challenge();
  expect((await complete(third)).status).toBe(200);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM notification_outbox WHERE event_key='auth.new_device_login'"
      )
    ).rows
  ).toHaveLength(1);
  expect(
    (await http.pool.query('SELECT session_id FROM sessions WHERE user_id=$1', [user])).rows
  ).toHaveLength(3);
});
it('alerts an authenticated unrecognized device without granting requested trust or exposing its hints', async () => {
  const id = await challenge();
  expect((await complete(id, false)).status).toBe(200);
  await expectNewDeviceNotice(http.pool, user, 'new_device_login', [
    id,
    device,
    fingerprint,
    '123456',
  ]);
  expect((await http.pool.query('SELECT id FROM device_trusts')).rows).toEqual([]);
});
it('does not publish an alert for invalid or disabled login attempts', async () => {
  const id = await challenge();
  const response = await fetchWithPreauth(`${http.base}/api/auth/login/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId: id, otp: '654321', trustDevice: true }),
  });
  expect(response.status).toBe(401);
  await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [user]);
  expect((await complete(id)).status).toBe(403);
  expect((await http.pool.query('SELECT * FROM in_app_notifications')).rows).toEqual([]);
  expect((await http.pool.query('SELECT * FROM notification_outbox')).rows).toEqual([]);
});
it('rolls back the alert and authorization if mandatory persistence crosses challenge expiry', async () => {
  const id = await challenge();
  await http.pool.query(
    "UPDATE otp_challenges SET expires_at=clock_timestamp()+interval '1 second' WHERE challenge_id=$1",
    [id]
  );
  await http.pool.query(
    "CREATE SEQUENCE login_notice_delay_witness; CREATE FUNCTION delay_login_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='new_device_login' THEN PERFORM nextval('login_notice_delay_witness'); PERFORM pg_sleep(1.2); END IF; RETURN NEW; END $$; CREATE TRIGGER delay_login_notice BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION delay_login_notice()"
  );
  const before = await sessionNoticeState(http.pool);
  expect((await complete(id)).status).toBe(401);
  expect(
    (await http.pool.query('SELECT is_called FROM login_notice_delay_witness')).rows[0].is_called
  ).toBe(true);
  expect(await sessionNoticeState(http.pool)).toEqual(before);
});

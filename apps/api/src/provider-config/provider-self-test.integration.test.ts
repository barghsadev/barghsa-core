import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { EmailProviderConfigService } from './email-provider-config.service.js';
import { SmsProviderConfigService } from './sms-provider-config.service.js';
import { SmtpConnectionTesterService } from './smtp-connection-tester.service.js';
import { ResendConnectionTesterService } from './resend-connection-tester.service.js';
import { SmsirConnectionTesterService } from './smsir-connection-tester.service.js';
import { ProviderSecretsService } from './provider-secrets.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const actor = { userId: 'provider-self', sessionId: randomUUID(), csrfToken: randomUUID() };
const email = 'staff@example.test',
  mobile = '+989121234567';
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('provider-self','Provider self','Fixture','[\"admin:notification-providers:edit\"]')"
  );
  await http.pool.query(
    "INSERT INTO users(user_id,username,email,mobile,password_hash,is_staff) VALUES ($1,$2,$2,$3,'test-only',true)",
    [actor.userId, email, mobile]
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ($1,'provider-self')", [
    actor.userId,
  ]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
    [actor.sessionId, actor.userId, actor.csrfToken, randomUUID()]
  );
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
beforeEach(async () => {
  vi.restoreAllMocks();
  await http.pool.query(
    "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '1 hour',step_up_verified_at=NOW() WHERE session_id=$1",
    [actor.sessionId]
  );
  await http.pool.query('DELETE FROM email_provider_configs');
  await http.pool.query('DELETE FROM sms_provider_configs');
  await http.pool.query('DELETE FROM audit_log WHERE user_id=$1', [actor.userId]);
  await http.pool.query('UPDATE users SET username=$2,email=$2,mobile=$3 WHERE user_id=$1', [
    actor.userId,
    email,
    mobile,
  ]);
});

for (const transport of ['smtp', 'resend', 'smsir'] as const) {
  const channel = transport === 'smsir' ? 'sms' : 'email';
  async function fixture() {
    const probe = vi.fn(async () => {}),
      dispatch = vi.fn();
    const send = vi.fn(
      async (
        _config: unknown,
        _recipient?: string,
        eventOrAuthorize?: string | (() => Promise<void>),
        beforeSend?: () => Promise<void>
      ) => {
        await probe();
        const authorize = typeof eventOrAuthorize === 'function' ? eventOrAuthorize : beforeSend;
        if (!authorize) throw new Error('Missing send authorization callback');
        await authorize();
        dispatch();
        return { ok: true };
      }
    );
    const smtp = new SmtpConnectionTesterService(),
      resend = new ResendConnectionTesterService(),
      sms = new SmsirConnectionTesterService();
    vi.spyOn(smtp, 'test').mockImplementation(send);
    vi.spyOn(resend, 'test').mockImplementation(send);
    vi.spyOn(sms, 'test').mockImplementation(send);
    const secrets = new ProviderSecretsService('provider-self-fixture-key');
    const service =
      transport === 'smsir'
        ? new SmsProviderConfigService(http.pool, sms, secrets)
        : new EmailProviderConfigService(http.pool, smtp, resend, secrets);
    const config =
      transport === 'smtp'
        ? { host: 'smtp.example.test', from_email: 'sender@example.test' }
        : transport === 'resend'
          ? { api_key: 'fixture-key', from_email: 'sender@example.test' }
          : {
              api_key: 'fixture-key',
              sender: '9830000000',
              timeout: 15,
              throughput_limit: 100,
              low_credit_threshold: 0,
              template_mappings: [
                { event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } },
              ],
            };
    const row =
      service instanceof EmailProviderConfigService
        ? await service.create(
            {
              transport: transport as 'smtp' | 'resend',
              label: 'Self test',
              config,
              createdBy: actor.userId,
            },
            actor
          )
        : await service.create({ label: 'Self test', config, createdBy: actor.userId }, actor);
    const test = (recipient?: string) =>
      service instanceof EmailProviderConfigService
        ? service.testConnection(row.id, recipient, actor.userId, actor)
        : service.testConnection(row.id, recipient, undefined, actor.userId, actor);
    const snapshot = async () => ({
      provider: (
        await http.pool.query(`SELECT * FROM ${channel}_provider_configs WHERE id=$1`, [row.id])
      ).rows,
      audit: (
        await http.pool.query('SELECT * FROM audit_log WHERE user_id=$1 ORDER BY id', [
          actor.userId,
        ])
      ).rows,
    });
    return { test, send, snapshot, probe, dispatch };
  }
  it(`${transport}: rechecks session expiry after a delayed provider probe`, async () => {
    const { test, probe, dispatch, snapshot } = await fixture(),
      before = await snapshot();
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '300 milliseconds' WHERE session_id=$1",
      [actor.sessionId]
    );
    probe.mockImplementation(async () => {
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT clock_timestamp()>=expires_at AS expired FROM sessions WHERE session_id=$1',
                [actor.sessionId]
              )
            ).rows[0].expired,
          { timeout: 3000 }
        )
        .toBe(true);
    });
    await expect(test()).rejects.toMatchObject({ status: 401 });
    expect(probe).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
  it(`${transport}: rejects a foreign test recipient before dispatch`, async () => {
    const { test, send, snapshot } = await fixture(),
      before = await snapshot();
    await expect(
      test(channel === 'email' ? 'stranger@example.test' : '+989120000000')
    ).rejects.toMatchObject({ status: 403 });
    expect(send).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
  it(`${transport}: defaults to the current verified contact`, async () => {
    const { test, send } = await fixture();
    expect(await test()).toMatchObject({ ok: true, result: { lastTestStatus: 'passed' } });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![1]).toBe(channel === 'email' ? email : mobile);
  });
  it(`${transport}: accepts normalized own contact`, async () => {
    const { test, send } = await fixture();
    expect(await test(channel === 'email' ? email.toUpperCase() : mobile.slice(1))).toMatchObject({
      ok: true,
    });
    expect(send.mock.calls[0]![1]).toBe(channel === 'email' ? email : mobile);
  });
  it(`${transport}: rejects a contact removed since the page was opened`, async () => {
    const { test, send, snapshot } = await fixture(),
      before = await snapshot();
    await http.pool.query('UPDATE users SET username=$2,email=$2,mobile=$3 WHERE user_id=$1', [
      actor.userId,
      'changed@example.test',
      '+989129999999',
    ]);
    await expect(test(channel === 'email' ? email : mobile)).rejects.toMatchObject({ status: 403 });
    expect(send).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
  it(`${transport}: cannot pass a self-test without a verified contact`, async () => {
    const { test, send, snapshot } = await fixture(),
      before = await snapshot();
    await http.pool.query('UPDATE users SET username=$2,email=NULL,mobile=NULL WHERE user_id=$1', [
      actor.userId,
      channel === 'email' ? mobile : email,
    ]);
    await expect(test()).rejects.toMatchObject({ status: 400 });
    expect(send).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });
}

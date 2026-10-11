import { randomUUID } from 'node:crypto';
import {
  createEmailSender,
  createSmsSender,
  EmailCircuitBreaker,
  SmsCircuitBreaker,
} from '@barghsa/shared/notification-delivery';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { SmsProviderConfigService } from './sms-provider-config.service.js';
import { readProviderAlertHistory } from './provider-alert-history.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
let providerId: string;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('sms-breaker-staff','sms-breaker@example.test','test-only')"
  );
}, 40_000);

afterAll(async () => {
  await fixture?.close();
});

beforeEach(async () => {
  await fixture.pool.query(
    "UPDATE sms_provider_configs SET status='superseded' WHERE status='active'"
  );
  providerId = randomUUID();
  const config = {
    api_key: 'fixture-only',
    sender: '9830000000',
    timeout: 15,
    throughput_limit: 100,
    low_credit_threshold: 0,
    template_mappings: [
      { event_key: 'invoice.created', template_id: '42', variables: { amount: 'AMOUNT' } },
    ],
  };
  await fixture.pool.query(
    `INSERT INTO sms_provider_configs
       (id,transport,label,status,config,created_by,last_test_status,last_test_at,
        delivery_verified_at,delivery_config_hash)
     VALUES ($1,'smsir','Breaker fixture','active',$2,'sms-breaker-staff','passed',NOW(),NOW(),
       encode(sha256(convert_to(jsonb_build_array('smsir'::text,$2::jsonb)::text,'UTF8')),'hex'))`,
    [providerId, config]
  );
});

const message = (providerId: string) => ({
  providerId,
  destination: '09121234567',
  templateId: '42',
  parameters: [{ name: 'AMOUNT', value: '5000' }],
});

it('trips after transient SMS.ir errors, refuses sends, and recovers with one probe', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }));
  const send = createSmsSender(fixture.pool, request);
  for (let i = 0; i < 5; i++)
    await expect(send(message(providerId))).rejects.toThrow('SMS.ir request failed');
  const breaker = new SmsCircuitBreaker(fixture.pool);
  expect(await breaker.readState(providerId)).toMatchObject({
    degraded: true,
    windowFailures: 5,
  });
  expect(
    (await new SmsProviderConfigService(fixture.pool).list()).find((row) => row.id === providerId)
  ).toMatchObject({
    degraded: true,
    degradedReason: 'SMS provider failure threshold reached',
    alertHistory: [{ kind: 'circuit_open' }],
  });
  await expect(send(message(providerId))).rejects.toThrow('SMS provider circuit is open');
  expect(request).toHaveBeenCalledTimes(5);

  await fixture.pool.query(
    "UPDATE sms_provider_configs SET cooldown_until=NOW()-INTERVAL '1 second' WHERE id=$1",
    [providerId]
  );
  request.mockResolvedValue(
    new Response(JSON.stringify({ status: 1, data: { messageId: 321 } }), { status: 200 })
  );
  expect(await send(message(providerId))).toBe('321');
  expect(await breaker.readState(providerId)).toMatchObject({
    degraded: false,
    windowFailures: 0,
  });
  expect(
    (await readProviderAlertHistory(fixture.pool, [providerId], 'sms'))
      .get(providerId)
      ?.map((event) => event.kind)
      .sort()
  ).toEqual(['circuit_open', 'circuit_recovered']);
});

it('pauses credential rejection immediately without counting transient failures or probing', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
  const send = createSmsSender(fixture.pool, request);
  await expect(send(message(providerId))).rejects.toThrow('SMS.ir request failed');
  const breaker = new SmsCircuitBreaker(fixture.pool);
  expect(await breaker.readState(providerId)).toMatchObject({
    degraded: true,
    degradedReason: 'provider_configuration_pause',
    cooldownUntil: null,
    windowFailures: 0,
  });
  for (let i = 0; i < 5; i++)
    await expect(send(message(providerId))).rejects.toThrow('SMS provider circuit is open');
  expect(request).toHaveBeenCalledTimes(1);
  await breaker.recordOutcome(providerId, { ok: true });
  await breaker.recordOutcome(providerId, { ok: false, transient: true });
  expect(await breaker.decision(providerId)).toMatchObject({ allow: false, cooldownUntil: null });
  // Simulate an older binary's automatic probe and reset after rollback.
  await expect(
    fixture.pool.query('UPDATE sms_provider_configs SET cooldown_until=NOW() WHERE id=$1', [
      providerId,
    ])
  ).rejects.toThrow('replacement version');
  await expect(
    fixture.pool.query(
      'UPDATE sms_provider_configs SET degraded=false,degraded_reason=NULL WHERE id=$1',
      [providerId]
    )
  ).rejects.toThrow('replacement version');
  expect(
    (await readProviderAlertHistory(fixture.pool, [providerId], 'sms'))
      .get(providerId)
      ?.map((event) => event.kind)
  ).toEqual(['circuit_open']);
});

it('keeps recipient rejection local and holds sender-activation HTTP uncertainty while pausing', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 0, data: null })));
  const send = createSmsSender(fixture.pool, request);
  await expect(send(message(providerId))).rejects.toThrow('SMS.ir rejected request');
  const breaker = new SmsCircuitBreaker(fixture.pool);
  expect(await breaker.readState(providerId)).toMatchObject({ degraded: false, windowFailures: 0 });
  request.mockResolvedValueOnce(
    new Response(JSON.stringify({ status: 123, data: null }), { status: 400 })
  );
  await expect(send(message(providerId))).rejects.toMatchObject({
    httpStatus: 400,
    smsirStatus: 123,
  });
  expect(await breaker.readState(providerId)).toMatchObject({
    degraded: true,
    degradedReason: 'provider_configuration_pause',
  });
  await expect(send(message(providerId))).rejects.toThrow('SMS provider circuit is open');
  expect(request).toHaveBeenCalledTimes(2);
});

it('pauses a rejected provider template without retrying the uncertain HTTP send', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 113, data: null }), { status: 400 })
    );
  const send = createSmsSender(fixture.pool, request);
  await expect(send(message(providerId))).rejects.toMatchObject({
    httpStatus: 400,
    smsirStatus: 113,
  });
  expect(await new SmsCircuitBreaker(fixture.pool).decision(providerId)).toMatchObject({
    allow: false,
    cooldownUntil: null,
  });
  await expect(send(message(providerId))).rejects.toThrow('circuit is open');
  expect(request).toHaveBeenCalledTimes(1);
});

it('pauses email credentials and fences an in-flight recovery success', async () => {
  await fixture.pool.query(
    "UPDATE email_provider_configs SET status='superseded' WHERE status='active'"
  );
  const id = randomUUID();
  const config = { api_key: 'fixture-only', from_email: 'sender@example.test' };
  await fixture.pool.query(
    `INSERT INTO email_provider_configs
    (id,transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
    VALUES($1,'resend','Email pause fixture','active',$2,'sms-breaker-staff','passed',NOW(),NOW(),
      encode(sha256(convert_to(jsonb_build_array('resend'::text,$2::jsonb)::text,'UTF8')),'hex'))`,
    [id, config]
  );
  const breaker = new EmailCircuitBreaker(fixture.pool);
  for (let i = 0; i < 5; i++) await breaker.recordOutcome(id, { ok: false, transient: true });
  await fixture.pool.query(
    "UPDATE email_provider_configs SET cooldown_until=NOW()-INTERVAL '1 second' WHERE id=$1",
    [id]
  );
  const probe = await breaker.decision(id);
  expect(probe.allow).toBe(true);
  if (!probe.allow || !probe.probeToken) throw new Error('Expected owned recovery probe');
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}', { status: 401 }));
  // A concurrent request confirms invalid credentials while the old probe is in flight.
  await breaker.recordOutcome(id, { ok: false, transient: false, configurationFailure: true });
  await breaker.recordOutcome(id, { ok: true, probeToken: probe.probeToken });
  expect(await breaker.decision(id)).toMatchObject({ allow: false, cooldownUntil: null });
  const send = createEmailSender(fixture.pool, request);
  await expect(
    send({
      destination: 'recipient@example.test',
      subject: 'test',
      text: 'test',
      idempotencyKey: 'pause-test',
    })
  ).rejects.toThrow('circuit is open');
  expect(request).not.toHaveBeenCalled();
});

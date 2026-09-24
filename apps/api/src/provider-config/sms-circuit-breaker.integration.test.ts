import { randomUUID } from 'node:crypto';
import { createSmsSender, SmsCircuitBreaker } from '@barghsa/shared/notification-delivery';
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

it('keeps permanent SMS.ir credential rejection out of the transient breaker', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
  const send = createSmsSender(fixture.pool, request);
  for (let i = 0; i < 6; i++)
    await expect(send(message(providerId))).rejects.toThrow('SMS.ir request failed');
  expect(await new SmsCircuitBreaker(fixture.pool).readState(providerId)).toMatchObject({
    degraded: false,
    windowFailures: 0,
  });
  expect(request).toHaveBeenCalledTimes(6);
});

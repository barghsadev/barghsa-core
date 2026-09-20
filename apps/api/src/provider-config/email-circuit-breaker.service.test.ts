import { createEmailSender } from '@barghsa/shared/notification-delivery';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { EmailCircuitBreakerService } from './email-circuit-breaker.service.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>, provider: string, time: number;
let service: EmailCircuitBreakerService;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('breaker-staff','breaker@example.test','test-only')"
  );
}, 40000);
afterAll(async () => {
  await fixture?.close();
});
beforeEach(async () => {
  await fixture.pool.query(
    "UPDATE email_provider_configs SET status='superseded' WHERE status='active'"
  );
  provider = randomUUID();
  time = Date.UTC(2026, 0, 1);
  await fixture.pool.query(
    `INSERT INTO email_provider_configs(id,transport,label,config,created_by,supersedes_id)
    VALUES ($1,'resend','Circuit test','{}','breaker-staff',NULL)`,
    [provider]
  );
  service = new EmailCircuitBreakerService(fixture.pool, undefined, { now: () => new Date(time) });
});
async function trip() {
  for (let i = 0; i < 5; i++) await service.recordOutcome(provider, { ok: false });
}
it('allows healthy providers and refuses missing providers', async () => {
  expect(await service.decision(provider)).toMatchObject({ allow: true, kind: 'closed' });
  await expect(service.decision(randomUUID())).rejects.toThrow('unavailable');
});
it('atomically counts concurrent failures and stops at the trip threshold', async () => {
  await Promise.all(
    Array.from({ length: 12 }, () => service.recordOutcome(provider, { ok: false }))
  );
  expect(await service.readState(provider)).toMatchObject({
    degraded: true,
    windowFailures: 5,
    consecutiveFailures: 5,
  });
  expect(await service.decision(provider)).toMatchObject({ allow: false });
});
it('expires spaced failure windows and resets healthy failures after success', async () => {
  for (let i = 0; i < 5; i++) {
    time += 360_000;
    expect(await service.recordOutcome(provider, { ok: false })).toMatchObject({
      windowFailures: 1,
      degraded: false,
    });
  }
  await service.recordOutcome(provider, { ok: true });
  expect(await service.recordOutcome(provider, { ok: false })).toMatchObject({
    windowFailures: 1,
    consecutiveFailures: 1,
  });
});
it('allows exactly one concurrent recovery probe and binds its successful result', async () => {
  await trip();
  time += 60_001;
  const decisions = await Promise.all(Array.from({ length: 12 }, () => service.decision(provider)));
  const allowed = decisions.filter((decision) => decision.allow);
  expect(allowed).toHaveLength(1);
  const probe = allowed[0]!;
  if (!probe.allow || !probe.probeToken) throw new Error('No probe claim');
  expect(await service.recordOutcome(provider, { ok: true, isProbe: true })).toMatchObject({
    degraded: true,
  });
  expect(
    await service.recordOutcome(provider, { ok: true, probeToken: probe.probeToken })
  ).toMatchObject({ degraded: false, windowFailures: 0 });
});
it('ignores expired/replaced probe results and extends cooldown after the current probe fails', async () => {
  await trip();
  time += 60_001;
  const first = await service.decision(provider);
  if (!first.allow || !first.probeToken) throw new Error('No first probe');
  time += 60_001;
  const next = await service.decision(provider);
  if (!next.allow || !next.probeToken) throw new Error('No next probe');
  expect(
    await service.recordOutcome(provider, { ok: true, probeToken: first.probeToken })
  ).toMatchObject({ degraded: true });
  expect(
    await service.recordOutcome(provider, { ok: false, probeToken: next.probeToken })
  ).toMatchObject({ degraded: true });
  expect(await service.decision(provider)).toMatchObject({ allow: false });
});
it('uses the database clock without an injected test clock', async () => {
  const real = new EmailCircuitBreakerService(fixture.pool);
  expect(await real.recordOutcome(provider, { ok: false })).toMatchObject({
    degraded: false,
    windowFailures: 1,
  });
});

it('the actual sender trips on provider failures and admits one pending recovery request', async () => {
  await fixture.pool.query(
    `UPDATE email_provider_configs SET status='active',last_test_status='passed',config=$2,
      last_test_at=NOW(),delivery_verified_at=NOW(),
      delivery_config_hash=encode(sha256(convert_to(jsonb_build_array(transport,$2::jsonb)::text,'UTF8')),'hex') WHERE id=$1`,
    [provider, JSON.stringify({ api_key: 'local-test-only', from_email: 'sender@example.test' })]
  );
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }));
  const send = createEmailSender(fixture.pool, request);
  const message = {
    destination: 'staff@example.test',
    subject: 'Test',
    text: 'Test',
    idempotencyKey: 'breaker-test',
  };
  for (let i = 0; i < 5; i++) await expect(send(message)).rejects.toThrow('rejected');
  await expect(send(message)).rejects.toThrow('circuit is open');
  expect(request).toHaveBeenCalledTimes(5);
  await fixture.pool.query(
    "UPDATE email_provider_configs SET cooldown_until=NOW()-INTERVAL '1 second' WHERE id=$1",
    [provider]
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  request.mockImplementation(async () => {
    await gate;
    return new Response('{"id":"recovered-receipt"}', { status: 200 });
  });
  let rejected = 0;
  const attempts = Array.from({ length: 10 }, () =>
    send(message).catch((error) => {
      rejected++;
      throw error;
    })
  );
  const outcomes = Promise.allSettled(attempts);
  try {
    await vi.waitFor(() => expect(rejected).toBe(9));
    expect(request).toHaveBeenCalledTimes(6);
  } finally {
    release();
  }
  expect((await outcomes).filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(await service.readState(provider)).toMatchObject({
    degraded: false,
    consecutiveFailures: 0,
  });
});

it('trips on five recent failures even when the first failure of the run is outside the rolling window', async () => {
  await service.recordOutcome(provider, { ok: false });
  time += 299_000;
  for (let i = 0; i < 3; i++) await service.recordOutcome(provider, { ok: false });
  time += 2_000;
  await service.recordOutcome(provider, { ok: false });
  expect(await service.recordOutcome(provider, { ok: false })).toMatchObject({
    degraded: true,
    windowFailures: 5,
  });
});

it('a permanent failure interrupts the transient sequence but cannot close a failed recovery probe', async () => {
  for (let i = 0; i < 4; i++) await service.recordOutcome(provider, { ok: false });
  expect(await service.recordOutcome(provider, { ok: false, transient: false })).toMatchObject({
    degraded: false,
    windowFailures: 0,
  });
  expect(await service.recordOutcome(provider, { ok: false })).toMatchObject({
    degraded: false,
    windowFailures: 1,
  });
  await trip();
  time += 60_001;
  const probe = await service.decision(provider);
  if (!probe.allow || !probe.probeToken) throw new Error('No recovery probe');
  expect(
    await service.recordOutcome(provider, {
      ok: false,
      transient: false,
      probeToken: probe.probeToken,
    })
  ).toMatchObject({ degraded: true });
  expect(await service.decision(provider)).toMatchObject({ allow: false });
});

for (const failure of ['permanent-response', 'local-ownership', 'accepted-persistence'] as const) {
  it(`does not trip the provider on repeated ${failure} failures`, async () => {
    await fixture.pool.query(
      `UPDATE email_provider_configs SET status='active',last_test_status='passed',config=$2,
      last_test_at=NOW(),delivery_verified_at=NOW(),
      delivery_config_hash=encode(sha256(convert_to(jsonb_build_array(transport,$2::jsonb)::text,'UTF8')),'hex') WHERE id=$1`,
      [provider, JSON.stringify({ api_key: 'fixture', from_email: 'sender@example.test' })]
    );
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        failure === 'permanent-response'
          ? new Response('{}', { status: 422 })
          : new Response(JSON.stringify({ id: 'accepted' }), { status: 200 })
      );
    const execute =
      failure === 'permanent-response'
        ? undefined
        : async (_provider: unknown, send: () => Promise<string>) => {
            if (failure === 'accepted-persistence') await send();
            throw new Error('Local receipt unavailable');
          };
    const send = createEmailSender(fixture.pool, request, execute);
    for (let i = 0; i < 6; i++)
      await expect(
        send({
          destination: 'staff@example.test',
          subject: 'Test',
          text: 'Test',
          idempotencyKey: randomUUID(),
        })
      ).rejects.toThrow();
    expect(await service.readState(provider)).toMatchObject({ degraded: false, windowFailures: 0 });
    expect(request).toHaveBeenCalledTimes(failure === 'local-ownership' ? 0 : 6);
    await fixture.pool.query("UPDATE email_provider_configs SET status='superseded' WHERE id=$1", [
      provider,
    ]);
  });
}

it('caller cancellation preserves the existing transient failure sequence', async () => {
  await fixture.pool.query(
    `UPDATE email_provider_configs SET status='active',last_test_status='passed',config=$2,
    last_test_at=NOW(),delivery_verified_at=NOW(),
    delivery_config_hash=encode(sha256(convert_to(jsonb_build_array(transport,$2::jsonb)::text,'UTF8')),'hex') WHERE id=$1`,
    [provider, JSON.stringify({ api_key: 'fixture', from_email: 'sender@example.test' })]
  );
  const real = new EmailCircuitBreakerService(fixture.pool);
  for (let i = 0; i < 4; i++) await real.recordOutcome(provider, { ok: false });
  const controller = new AbortController();
  const request = vi.fn<typeof fetch>().mockImplementation(async () => {
    controller.abort();
    throw controller.signal.reason;
  });
  const send = createEmailSender(fixture.pool, request);
  await expect(
    send({
      destination: 'staff@example.test',
      subject: 'Test',
      text: 'Test',
      idempotencyKey: randomUUID(),
      signal: controller.signal,
    })
  ).rejects.toThrow();
  expect(await real.readState(provider)).toMatchObject({ degraded: false, windowFailures: 4 });
});

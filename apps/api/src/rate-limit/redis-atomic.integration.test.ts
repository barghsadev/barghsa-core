import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Redis } from 'ioredis';
import { CompositeRateLimiterStore, PostgresRateLimiterStore } from '@barghsa/shared/rate-limit';

import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
let pgStore: PostgresRateLimiterStore;
let container: StartedTestContainer;
let redis: Redis;
let store: CompositeRateLimiterStore;

beforeAll(async () => {
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  pgStore = new PostgresRateLimiterStore((text, params) => fixture.pool.query(text, params));
  container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
  redis = new Redis({
    host: container.getHost(),
    port: container.getMappedPort(6379),
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
  });
  await redis.ping();
  store = new CompositeRateLimiterStore(pgStore, redis);
}, 60_000);

afterAll(async () => {
  redis?.disconnect();
  await container?.stop();
  await fixture?.close();
});

it('admits exactly the quota under concurrent requests and keeps a bounded expiry', async () => {
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 100 }, () => store.increment(key, 20, 60_000))
  );
  expect(results.filter((result) => result.allowed)).toHaveLength(20);
  expect(await redis.get(key)).toBe('100');
  expect(await redis.pttl(key)).toBeGreaterThan(0);
  expect(await redis.pttl(key)).toBeLessThanOrEqual(60_000);
  const { rows } = await fixture.pool.query(
    'SELECT cardinality(events) AS count FROM rate_limit_windows WHERE NOT security AND key = $1',
    [key]
  );
  expect(rows[0].count).toBe(21);
});

it('preserves the existing deadline instead of extending it for later requests', async () => {
  const key = randomUUID();
  await redis.set(key, '1', 'PX', 10_000);
  const result = await store.increment(key, 2, 60_000);
  expect(result.allowed).toBe(true);
  expect(result.resetMs).toBeGreaterThan(0);
  expect(await redis.pttl(key)).toBeLessThanOrEqual(10_000);
  expect((await store.increment(key, 2, 60_000)).allowed).toBe(false);
});

it('repairs a legacy counter without expiry without granting a fresh quota', async () => {
  const key = randomUUID();
  await redis.set(key, '20');
  const result = await store.increment(key, 20, 60_000);
  expect(result.allowed).toBe(false);
  expect(await redis.get(key)).toBe('21');
  expect(await redis.pttl(key)).toBeGreaterThan(0);
});

it('starts a fresh bounded quota after the prior key has expired', async () => {
  const key = randomUUID();
  await redis.set(key, '20');
  await redis.pexpireat(key, Date.now() - 1000);
  expect(await redis.exists(key)).toBe(0);
  const result = await store.increment(key, 20, 60_000);
  expect(result.remaining).toBe(19);
  expect(await redis.pttl(key)).toBeGreaterThan(0);
});

it('retains spent quota through missing Redis, deleted counters and a new client', async () => {
  const key = randomUUID();
  const degraded = new CompositeRateLimiterStore(pgStore, null);
  expect((await store.increment(key, 2, 3_600_000)).allowed).toBe(true);
  expect((await degraded.increment(key, 2, 3_600_000)).allowed).toBe(true);
  await redis.del(key);
  expect((await store.increment(key, 2, 3_600_000)).allowed).toBe(false);
  const replacement = redis.duplicate();
  try {
    await replacement.del(key);
    const recovered = new CompositeRateLimiterStore(pgStore, replacement);
    expect((await recovered.increment(key, 2, 3_600_000)).allowed).toBe(false);
    expect((await degraded.increment(key, 2, 3_600_000)).allowed).toBe(false);
  } finally {
    replacement.disconnect();
  }
});

it('denies excess traffic across concurrent connected and degraded instances', async () => {
  const key = randomUUID();
  const degraded = new CompositeRateLimiterStore(pgStore, null);
  const results = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      (index % 2 ? store : degraded).increment(key, 20, 3_600_000)
    )
  );
  expect(results.filter((result) => result.allowed)).toHaveLength(20);
});

it('uses durable quota after a Redis connection fails', async () => {
  const key = randomUUID();
  expect((await store.increment(key, 1, 3_600_000)).allowed).toBe(true);
  const failedRedis = redis.duplicate();
  await failedRedis.ping();
  failedRedis.disconnect();
  const degraded = new CompositeRateLimiterStore(pgStore, failedRedis);
  expect((await degraded.increment(key, 1, 3_600_000)).allowed).toBe(false);
});

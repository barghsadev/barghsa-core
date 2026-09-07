import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Redis } from 'ioredis';
import { CompositeRateLimiterStore, PostgresRateLimiterStore } from '@barghsa/shared/rate-limit';

let container: StartedTestContainer;
let redis: Redis;
const fallback = vi.fn(async () => {
  throw new Error('Unexpected PostgreSQL fallback');
});
let store: CompositeRateLimiterStore;

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
  redis = new Redis({
    host: container.getHost(),
    port: container.getMappedPort(6379),
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
  });
  await redis.ping();
  store = new CompositeRateLimiterStore(new PostgresRateLimiterStore(fallback), redis);
}, 60_000);

afterAll(async () => {
  redis?.disconnect();
  await container?.stop();
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
  expect(fallback).not.toHaveBeenCalled();
});

it('preserves the existing deadline instead of extending it for later requests', async () => {
  const key = randomUUID();
  await redis.set(key, '1', 'PX', 10_000);
  const result = await store.increment(key, 2, 60_000);
  expect(result.allowed).toBe(true);
  expect(result.resetMs).toBeGreaterThan(0);
  expect(result.resetMs).toBeLessThanOrEqual(10_000);
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

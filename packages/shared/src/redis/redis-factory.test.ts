import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Redis, type RedisOptions } from 'ioredis';
import { createRedisClient, pingRedis } from './redis-factory.js';

vi.mock('ioredis', () => ({ Redis: vi.fn() }));
const client = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  ping: vi.fn(),
  status: 'ready',
};
const logger = { warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('REDIS_URL', '');
  client.connect.mockResolvedValue(undefined);
  client.ping.mockResolvedValue('PONG');
  client.status = 'ready';
  vi.mocked(Redis).mockImplementation(function () {
    return client as unknown as Redis;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('skips an absent target without constructing a client', async () => {
  expect(await createRedisClient({})).toBeNull();
  expect(Redis).not.toHaveBeenCalled();
});
it('rejects invalid configuration without constructing a client', async () => {
  expect(await createRedisClient({ host: 'cache', port: -1 }, logger)).toBeNull();
  expect(logger.error).toHaveBeenCalledOnce();
  expect(Redis).not.toHaveBeenCalled();
});
it('uses the environment URL and lets explicit configuration override it', async () => {
  vi.stubEnv('REDIS_URL', 'redis://environment:6379');
  expect(await createRedisClient({})).toBe(client);
  expect(Redis).toHaveBeenLastCalledWith('redis://environment:6379', expect.any(Object));
  await createRedisClient({ url: 'redis://explicit:6379' });
  expect(Redis).toHaveBeenLastCalledWith('redis://explicit:6379', expect.any(Object));
});
it('keeps TLS certificate and hostname options intact', async () => {
  const tls = { ca: 'test-ca', servername: 'cache.example', rejectUnauthorized: true };
  await createRedisClient({
    host: 'cache',
    port: 6380,
    tls,
    password: 'fixture',
    keyPrefix: 'test:',
  });
  expect(Redis).toHaveBeenCalledWith(
    expect.objectContaining({
      host: 'cache',
      port: 6380,
      tls,
      password: 'fixture',
      keyPrefix: 'test:',
    })
  );
});
it('treats a synchronous constructor error as optional dependency failure', async () => {
  vi.mocked(Redis).mockImplementationOnce(function () {
    throw new Error('invalid target');
  });
  await expect(createRedisClient({ host: 'cache' }, logger)).resolves.toBeNull();
  expect(logger.warn).toHaveBeenCalledOnce();
});
for (const error of [new Error('offline'), 'offline']) {
  it(`disconnects after a failed initial connection (${typeof error})`, async () => {
    client.connect.mockRejectedValueOnce(error);
    expect(await createRedisClient({ host: 'cache' }, logger)).toBeNull();
    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), 'offline');
  });
}
it('uses finite command waits and refuses queued offline work by default', async () => {
  await createRedisClient({ host: 'cache' });
  const options = (vi.mocked(Redis).mock.calls as unknown as [RedisOptions][])[0]![0];
  expect(options.maxRetriesPerRequest).toBe(1);
  expect(options.enableOfflineQueue).toBe(false);
  expect(options.commandTimeout).toBe(1000);
  expect([1, 2, 3, 4].map((n) => options.retryStrategy!(n))).toEqual([200, 400, 600, null]);
});
it('reports client errors without an unhandled error event', async () => {
  await createRedisClient({ host: 'cache', tls: true }, logger);
  const handler = client.on.mock.calls[0]![1] as (error: Error) => void;
  handler(new Error('connection lost'));
  expect(logger.warn).toHaveBeenCalledWith(expect.any(String), 'connection lost');
});
it('reports absent and non-ready clients without issuing a command', async () => {
  expect(await pingRedis(null)).toEqual({ ok: false, latencyMs: 0, error: 'not connected' });
  client.status = 'reconnecting';
  expect(await pingRedis(client as unknown as Redis)).toEqual({
    ok: false,
    latencyMs: 0,
    error: 'status=reconnecting',
  });
  expect(client.ping).not.toHaveBeenCalled();
});
it('measures successful ping latency', async () => {
  vi.spyOn(Date, 'now').mockReturnValueOnce(10).mockReturnValueOnce(17);
  expect(await pingRedis(client as unknown as Redis)).toEqual({ ok: true, latencyMs: 7 });
});
for (const error of [new Error('ping failed'), 'ping failed']) {
  it(`reports ping failure (${typeof error})`, async () => {
    client.ping.mockRejectedValueOnce(error);
    vi.spyOn(Date, 'now').mockReturnValueOnce(10).mockReturnValueOnce(14);
    expect(await pingRedis(client as unknown as Redis)).toEqual({
      ok: false,
      latencyMs: 4,
      error: 'ping failed',
    });
  });
}

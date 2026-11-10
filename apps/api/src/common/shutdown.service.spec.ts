import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpAdapterHost } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { closeDbPools } from '@barghsa/db';
import { ShutdownService } from './shutdown.service.js';
vi.mock('@barghsa/db', () => ({ closeDbPools: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.mocked(closeDbPools).mockReset();
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
it.each([false, true])(
  'closes Redis/storage and removes watchdog listeners despite pool failure=%s',
  async (fails) => {
    vi.mocked(closeDbPools).mockImplementation(async () => {
      if (fails) throw new Error('pool failure');
    });
    const redis = { quit: vi.fn(async () => 'OK'), disconnect: vi.fn() };
    const storage = { destroy: vi.fn() };
    const service = new ShutdownService(new HttpAdapterHost(), redis as unknown as Redis, storage);
    const before = process.listenerCount('SIGTERM');
    service.onModuleInit();
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    await service.onApplicationShutdown();
    expect(closeDbPools).toHaveBeenCalledTimes(1);
    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
    expect(storage.destroy).toHaveBeenCalledTimes(1);
    expect(process.listenerCount('SIGTERM')).toBe(before);
  }
);

it('logs a fixed HTTP close failure and still closes the remaining resources', async () => {
  const adapter = new HttpAdapterHost();
  adapter.httpAdapter = {
    getHttpServer: () => ({
      listening: true,
      close: (callback: (error: Error) => void) => callback(new Error('PRIVATE_SHUTDOWN_FIXTURE')),
    }),
  } as HttpAdapterHost['httpAdapter'];
  const storage = { destroy: vi.fn() };
  const service = new ShutdownService(adapter, null, storage);
  await service.onApplicationShutdown();
  expect(Logger.prototype.error).toHaveBeenCalledExactlyOnceWith('HTTP server close error');
  expect(closeDbPools).toHaveBeenCalledOnce();
  expect(storage.destroy).toHaveBeenCalledOnce();
});

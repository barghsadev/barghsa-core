import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dbHealth } from '@barghsa/db';
import { HealthService } from './health.service.js';

vi.mock('@barghsa/db', () => ({ dbHealth: vi.fn() }));
vi.mock('@barghsa/shared/redis', () => ({ pingRedis: vi.fn() }));
beforeEach(() => {
  vi.mocked(dbHealth).mockResolvedValue({
    ok: true,
    latencyMs: 1,
    poolStats: { totalCount: 1, idleCount: 1, waitingCount: 0 },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('reports optional storage failure safely while PostgreSQL alone controls readiness', async () => {
  const storage = {
    checkHealth: vi.fn().mockRejectedValue(new Error('secret at private-storage.example')),
  };
  const service = new HealthService(null, storage);
  const result = await service.readiness();
  expect(result.status).toBe('degraded');
  expect(result.warnings).toContain('object-storage-unavailable');
  expect(JSON.stringify(result)).not.toMatch(/secret|private-storage/);
  storage.checkHealth.mockResolvedValue(undefined);
  expect((await service.readiness()).status).toBe('ok');
  vi.mocked(dbHealth).mockResolvedValue({
    ok: false,
    latencyMs: 1,
    poolStats: { totalCount: 0, idleCount: 0, waitingCount: 0 },
  });
  expect((await service.readiness()).status).toBe('down');
  expect(service.liveness()).toEqual({ status: 'ok' });
});

it('bounds and shares stuck storage work until settlement, then allows recovery', async () => {
  vi.useFakeTimers();
  let settle!: () => void;
  const storage = {
    checkHealth: vi.fn(
      (_signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          settle = resolve;
        })
    ),
  };
  const service = new HealthService(null, storage);
  const probes = Array.from({ length: 20 }, () => service.readiness());
  await vi.advanceTimersByTimeAsync(1501);
  expect((await Promise.all(probes)).every((r) => r.status === 'degraded')).toBe(true);
  expect(storage.checkHealth).toHaveBeenCalledTimes(1);
  expect(storage.checkHealth.mock.calls[0]![0]!.aborted).toBe(true);
  expect((await service.readiness()).status).toBe('degraded');
  expect(storage.checkHealth).toHaveBeenCalledTimes(1);
  settle();
  await vi.advanceTimersByTimeAsync(0);
  storage.checkHealth.mockResolvedValue(undefined);
  expect((await service.readiness()).status).toBe('ok');
  expect(storage.checkHealth).toHaveBeenCalledTimes(2);
});

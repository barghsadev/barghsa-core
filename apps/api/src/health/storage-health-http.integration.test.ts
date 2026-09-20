import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ReadinessResult } from './health.service.js';

async function storageStatus(response: Response): Promise<string> {
  const body = (await response.json()) as ReadinessResult;
  return body.checks.objectStorage.status;
}

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
let storage: Server;
let mode: 'ok' | 'denied' | 'stalled' = 'ok';
const observed: Array<{ method: string | undefined; url: string | undefined }> = [];
beforeAll(async () => {
  storage = createServer((request, response) => {
    observed.push({ method: request.method, url: request.url });
    if (mode === 'stalled') return;
    response.writeHead(mode === 'ok' ? 200 : 403).end();
  });
  await new Promise<void>((resolve) => storage.listen(0, '127.0.0.1', resolve));
  const address = storage.address();
  if (!address || typeof address === 'string') throw new Error('Missing storage address');
  fixture = await startHttpFixture(
    process.env.TEST_DATABASE_URL!,
    `http://127.0.0.1:${address.port}`
  );
}, 60_000);
afterAll(async () => {
  await fixture?.close();
  storage?.closeAllConnections();
  if (storage) await new Promise<void>((resolve) => storage.close(() => resolve()));
});

it('probes actual bucket access, degrades on denial/timeout, and recovers without failing readiness', async () => {
  const check = () => fetch(`${fixture.base}/api/health/ready`);
  const healthy = await check();
  expect(healthy.status).toBe(200);
  expect(await storageStatus(healthy)).toBe('ok');
  expect(observed).toContainEqual({ method: 'HEAD', url: '/test-evidence/' });
  mode = 'denied';
  const denied = await check();
  expect(denied.status).toBe(200);
  expect(denied.headers.get('x-health-warning')).toContain('object-storage-unavailable');
  expect(await storageStatus(denied)).toBe('degraded');
  mode = 'stalled';
  const started = Date.now();
  const delayed = await Promise.all(Array.from({ length: 8 }, check));
  expect(Date.now() - started).toBeLessThan(3000);
  for (const response of delayed) {
    expect(response.status).toBe(200);
    expect(await storageStatus(response)).toBe('degraded');
  }
  mode = 'ok';
  await expect.poll(async () => await storageStatus(await check())).toBe('ok');
  expect(observed.every((request) => request.method === 'HEAD')).toBe(true);
}, 15_000);

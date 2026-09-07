import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
let receiver: Server;
let requests = 0;
const accepted: unknown[] = [];
beforeAll(async () => {
  receiver = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests++;
    if (requests === 1) {
      response.writeHead(503).end();
      return;
    }
    accepted.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise<void>((done) => receiver.listen(0, '127.0.0.1', done));
  const address = receiver.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector address');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!, undefined, '', 10, '', false, {
    endpoint: `http://127.0.0.1:${address.port}/v1/metrics`,
    intervalMs: 1000,
    timeoutMs: 1000,
  });
}, 60_000);
afterAll(async () => {
  await fixture?.close();
  if (receiver) await new Promise<void>((done) => receiver.close(() => done()));
});

it('exports database metrics over OTLP and keeps serving after a collector failure', async () => {
  const response = await fetch(`${fixture.base}/metrics`);
  expect(response.status).toBe(200);
  await expect
    .poll(() => JSON.stringify(accepted), { timeout: 15_000 })
    .toContain('postgresql.connections.active');
  const payload = JSON.stringify(accepted);
  expect(payload).toContain('barghsa.postgresql');
  expect(payload).toContain('postgresql.cache.hit_ratio');
  expect(payload).toContain('postgresql.scans.sequential');
  expect(payload).toContain('postgresql.scans.index');
  expect(payload).toContain('postgresql.tuples.fetched');
  expect(payload).not.toContain('SELECT ');
  expect(requests).toBeGreaterThanOrEqual(2);
  expect((await fetch(`${fixture.base}/api/health/live`)).status).toBe(200);
}, 25_000);

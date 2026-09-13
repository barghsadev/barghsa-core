import { afterEach, expect, it, vi } from 'vitest';
import { connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>> | undefined;
let socket: Socket | undefined;
afterEach(async () => {
  socket?.destroy();
  await fixture?.close();
  vi.unstubAllEnvs();
});

async function incompleteRequest() {
  socket = connect(Number(new URL(fixture!.base).port), '127.0.0.1');
  await once(socket, 'connect');
  const accepted = once(socket, 'data');
  socket.write(
    'POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n'
  );
  expect(String((await accepted)[0])).toContain('100 Continue');
}

it('enforces the signal deadline while Nest is still draining an unfinished HTTP body', async () => {
  vi.stubEnv('SHUTDOWN_GRACE_PERIOD_MS', '300');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await incompleteRequest();
  const exited = once(fixture.process!, 'exit');
  const started = Date.now();
  fixture.process!.kill('SIGTERM');
  const result = await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Shutdown exceeded two seconds')), 2000)
    ),
  ]);
  expect(result).toEqual([1, null]);
  expect(Date.now() - started).toBeLessThan(2000);
}, 40_000);

it('finishes an accepted HTTP response before a clean signal exit', async () => {
  vi.stubEnv('SHUTDOWN_GRACE_PERIOD_MS', '3000');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await incompleteRequest();
  const exited = once(fixture.process!, 'exit');
  let body = '';
  socket!.on('data', (part) => {
    body += String(part);
  });
  const finished = once(socket!, 'end');
  fixture.process!.kill('SIGTERM');
  // Wait for the listening socket to close while this accepted request remains open.
  await expect
    .poll(
      async () => {
        const probe = connect(Number(new URL(fixture!.base).port), '127.0.0.1');
        return new Promise<boolean>((resolve) => {
          probe.once('error', () => resolve(true));
          probe.once('connect', () => {
            probe.destroy();
            resolve(false);
          });
        });
      },
      { timeout: 1500 }
    )
    .toBe(true);
  socket!.write('{}');
  await finished;
  expect(body).toContain('HTTP/1.1 403');
  expect(body).toContain('correlationId');
  expect(await exited).toEqual([0, null]);
}, 40_000);

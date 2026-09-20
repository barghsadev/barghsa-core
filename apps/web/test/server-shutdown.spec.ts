// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { get, type IncomingMessage } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, mkdir, open, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let child: ChildProcess | undefined;
let directory: string | undefined;
let response: IncomingMessage | undefined;
afterEach(async () => {
  response?.destroy();
  if (child && child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit');
    child.kill('SIGKILL');
    await ended;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function start(grace: number) {
  directory = await mkdtemp(join(tmpdir(), 'barghsa-web-shutdown-'));
  await mkdir(join(directory, 'assets'));
  const file = await open(join(directory, 'assets/large.js'), 'w');
  await file.truncate(16 * 1024 * 1024);
  await file.close();
  const entry = join(directory, 'server.mjs');
  await writeFile(
    entry,
    `import { createStaticServer } from ${JSON.stringify(pathToFileURL(resolve(__dirname, '../server.js')).href)};
const server = createStaticServer({ distDir: ${JSON.stringify(directory)} });
process.on('SIGTERM', () => server.shutdown('SIGTERM'));
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));`
  );
  child = fork(entry, [], {
    silent: true,
    env: { ...process.env, SHUTDOWN_GRACE_PERIOD_MS: String(grace) },
  });
  let output = '';
  child.stderr?.on('data', (part) => {
    output += String(part);
  });
  const [message] = await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(([code]) => {
      throw new Error(`Static server exited ${code}: ${output}`);
    }),
  ]);
  return { port: (message as { port: number }).port, exited: once(child, 'exit') };
}
async function pauseDownload(port: number) {
  response = await new Promise<IncomingMessage>((resolve, reject) => {
    get(`http://127.0.0.1:${port}/assets/large.js`, (res) => {
      res.pause();
      resolve(res);
    }).on('error', reject);
  });
  expect(response.statusCode).toBe(200);
}
it('exits cleanly after SIGTERM with no active request', async () => {
  const server = await start(1000);
  child!.kill('SIGTERM');
  expect(await server.exited).toEqual([0, null]);
});
it('forces an unfinished static response closed at the deadline', async () => {
  const server = await start(300);
  await pauseDownload(server.port);
  child!.kill('SIGTERM');
  expect(await server.exited).toEqual([1, null]);
});
it('drains an accepted static response before exiting cleanly', async () => {
  const server = await start(3000);
  await pauseDownload(server.port);
  let bytes = 0;
  response!.on('data', (part: Buffer) => {
    bytes += part.length;
  });
  const ended = once(response!, 'end');
  child!.kill('SIGTERM');
  await expect
    .poll(
      () =>
        new Promise<boolean>((resolve) => {
          const socket = connect(server.port, '127.0.0.1');
          socket.once('error', () => resolve(true));
          socket.once('connect', () => {
            socket.destroy();
            resolve(false);
          });
        }),
      { timeout: 1500 }
    )
    .toBe(true);
  response!.resume();
  await ended;
  expect(bytes).toBe(16 * 1024 * 1024);
  expect(await server.exited).toEqual([0, null]);
});

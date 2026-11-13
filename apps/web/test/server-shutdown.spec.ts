// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, get, type IncomingMessage } from 'node:http';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, open, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let child: ChildProcess | undefined;
let directory: string | undefined;
let response: IncomingMessage | undefined;
const resolvePackage = createRequire(import.meta.url).resolve;
afterEach(async () => {
  response?.destroy();
  if (child && child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit');
    child.kill('SIGKILL');
    await ended;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function start(grace: number, traceEndpoint = '') {
  directory = await mkdtemp(join(tmpdir(), 'barghsa-web-shutdown-'));
  await mkdir(join(directory, 'assets'));
  const file = await open(join(directory, 'assets/large.js'), 'w');
  await file.truncate(16 * 1024 * 1024);
  await file.close();
  const entry = join(directory, 'server.mjs');
  await writeFile(
    entry,
    `import { createStaticServer } from ${JSON.stringify(pathToFileURL(resolve(__dirname, '../server.js')).href)};
import { createTraceProvider } from ${JSON.stringify(pathToFileURL(resolvePackage('@barghsa/telemetry')).href)};
const server = createStaticServer({ distDir: ${JSON.stringify(directory)}, traceProvider: createTraceProvider('barghsa-web') });
if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
  server.prependListener('request', (_request, response) => {
    response.end = () => { response.flushHeaders(); return response; };
  });
}
process.on('SIGTERM', () => server.shutdown('SIGTERM'));
process.on('message', (message) => {
  if (message === 'close-active-connection') server.closeAllConnections();
});
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));`
  );
  child = fork(entry, [], {
    silent: true,
    env: {
      ...process.env,
      SHUTDOWN_GRACE_PERIOD_MS: String(grace),
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: traceEndpoint,
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: '',
      OTEL_EXPORTER_OTLP_HEADERS: '',
      OTEL_TRACE_SUCCESS_SAMPLE_RATE: '0',
    },
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
  return {
    port: (message as { port: number }).port,
    exited: once(child, 'exit'),
    logs: () => output,
  };
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
it('exports an interrupted response once and logs the same trace before clean shutdown', async () => {
  const batches: Array<{
    resourceSpans: Array<{
      scopeSpans: Array<{
        spans: Array<Record<string, unknown>>;
      }>;
    }>;
  }> = [];
  const collector = createServer(async (incoming, result) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    batches.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    result.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise<void>((done) => collector.listen(0, '127.0.0.1', done));
  try {
    const address = collector.address();
    if (!address || typeof address === 'string') throw new Error('Collector port missing');
    const server = await start(3000, `http://127.0.0.1:${address.port}/v1/traces`);
    await pauseDownload(server.port);
    const correlationId = response!.headers['x-correlation-id'];
    expect(correlationId).toMatch(/^[a-f0-9-]{36}$/);
    child!.send('close-active-connection');
    await expect.poll(() => server.logs(), { timeout: 2500 }).toContain('web.request.failed');
    child!.kill('SIGTERM');
    expect(await server.exited).toEqual([0, null]);
    const spans = batches.flatMap(({ resourceSpans }) =>
      resourceSpans.flatMap(({ scopeSpans }) => scopeSpans.flatMap(({ spans }) => spans))
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ name: 'HTTP GET', status: { code: 2 } });
    const failure = server
      .logs()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find(({ event }) => event === 'web.request.failed');
    expect(failure).toMatchObject({
      correlationId,
      traceId: spans[0]?.traceId,
      spanId: spans[0]?.spanId,
    });
  } finally {
    await new Promise<void>((done) => collector.close(() => done()));
  }
});
it('forces an unfinished static response closed at the deadline', async () => {
  const server = await start(300);
  await pauseDownload(server.port);
  child!.kill('SIGTERM');
  expect(await server.exited).toEqual([1, null]);
  const [shutdownStarted, deadline] = server
    .logs()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(shutdownStarted).toMatchObject({ service: 'web', event: 'web.lifecycle', level: 'warn' });
  expect(deadline).toMatchObject({
    service: 'web',
    event: 'web.lifecycle',
    level: 'error',
    correlationId: shutdownStarted.correlationId,
  });
  expect(shutdownStarted.correlationId).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
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

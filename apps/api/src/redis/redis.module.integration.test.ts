import 'reflect-metadata';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { Test, type TestingModule } from '@nestjs/testing';
import { createServer as createCollector } from 'node:http';
import { SpanKind } from '@opentelemetry/api';
import { operatorLogTrace } from '@barghsa/shared/operator-logging';
import {
  createTraceProvider,
  extractTraceparent,
  operationTracer,
} from '@barghsa/shared/telemetry';
import type { Redis } from 'ioredis';
import { afterEach, expect, it, vi } from 'vitest';
import { RedisModule, REDIS_CLIENT } from './redis.module.js';

afterEach(() => vi.unstubAllEnvs());

it.each(['redis-url', 'rediss-url', 'production-host', 'development-host'] as const)(
  'uses the explicitly configured production Redis transport: %s',
  async (target) => {
    const sockets = new Set<Socket>();
    let tlsAttempts = 0;
    let pings = 0;
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => undefined);
      let pending = '';
      socket.on('data', (bytes) => {
        // Refuse TLS on this owned plain Redis fixture immediately, without a timeout.
        if (!pending && bytes[0] !== 42) {
          tlsAttempts++;
          socket.destroy();
          return;
        }
        pending += bytes.toString();
        while (pending.length) {
          const headerEnd = pending.indexOf('\r\n');
          if (headerEnd < 0) return;
          const count = Number(pending.slice(1, headerEnd));
          let cursor = headerEnd + 2;
          const args: string[] = [];
          for (let i = 0; i < count; i++) {
            const lengthEnd = pending.indexOf('\r\n', cursor);
            if (lengthEnd < 0) return;
            const length = Number(pending.slice(cursor + 1, lengthEnd));
            const end = lengthEnd + 2 + length;
            if (pending.length < end + 2) return;
            args.push(pending.slice(lengthEnd + 2, end));
            cursor = end + 2;
          }
          pending = pending.slice(cursor);
          if (args[0]?.toLowerCase() === 'ping') {
            pings++;
            socket.write('+PONG\r\n');
          } else socket.write('+OK\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const hostOnly = target.endsWith('-host');
    const plain = target === 'redis-url' || target === 'development-host';
    vi.stubEnv('NODE_ENV', target === 'development-host' ? 'development' : 'production');
    vi.stubEnv(
      'REDIS_URL',
      hostOnly ? '' : (target === 'redis-url' ? 'redis' : 'rediss') + '://127.0.0.1:' + address.port
    );
    vi.stubEnv('REDIS_HOST', hostOnly ? '127.0.0.1' : '');
    vi.stubEnv('REDIS_PORT', String(address.port));
    vi.stubEnv('REDIS_PASSWORD', '');
    let module: TestingModule | undefined;
    let client: Redis | null = null;
    try {
      module = await Test.createTestingModule({ imports: [RedisModule] }).compile();
      client = module.get<Redis | null>(REDIS_CLIENT);
      if (plain) {
        expect(client).not.toBeNull();
        expect(await client!.ping()).toBe('PONG');
        expect(pings).toBe(1);
        expect(tlsAttempts).toBe(0);
      } else {
        expect(client).toBeNull();
        expect(tlsAttempts).toBeGreaterThan(0);
        expect(pings).toBe(0);
      }
    } finally {
      client?.disconnect();
      await module?.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  10_000
);

it('exports bounded Redis spans under the request parent without command data', async () => {
  const exports: string[] = [];
  const collector = createCollector(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    exports.push(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  const sockets = new Set<Socket>();
  const secret = 'private-redis-fixture-marker';
  const redisServer = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('data', (bytes) => {
      for (const [, command] of bytes.toString().matchAll(/\*\d+\r\n\$\d+\r\n([a-z]+)\r\n/g)) {
        if (command === 'get') socket.write(`$${secret.length}\r\n${secret}\r\n`);
        else if (command === 'eval') socket.write(`-ERR ${secret}\r\n`);
        else if (command === 'incr') socket.write(':1\r\n');
        else socket.write('+OK\r\n');
      }
    });
  });
  const listen = async (server: typeof collector | typeof redisServer) => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    return address.port;
  };
  const [collectorPort, redisPort] = await Promise.all([listen(collector), listen(redisServer)]);
  vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', `http://127.0.0.1:${collectorPort}/v1/traces`);
  vi.stubEnv('OTEL_TRACE_SUCCESS_SAMPLE_RATE', '1');
  vi.stubEnv('REDIS_URL', `redis://127.0.0.1:${redisPort}`);
  vi.stubEnv('REDIS_HOST', '');
  vi.stubEnv('REDIS_PASSWORD', '');
  const provider = createTraceProvider('barghsa-api')!;
  let module: TestingModule | undefined;
  let client: Redis | undefined;
  try {
    module = await Test.createTestingModule({ imports: [RedisModule] }).compile();
    const redis = module.get<Redis>(REDIS_CLIENT);
    client = redis;
    expect(await redis.get(secret)).toBe(secret);
    const tracer = provider.getTracer('redis-fixture');
    const traceId = 'f8181818181818181818181818181818';
    const parent = tracer.startSpan(
      'request-fixture',
      { kind: SpanKind.SERVER },
      extractTraceparent(`00-${traceId}-f929292929292929-00`)
    );
    try {
      await operationTracer.run(tracer, () =>
        operatorLogTrace.run(parent.spanContext(), async () => {
          expect(await redis.get(secret)).toBe(secret);
          await expect(redis.eval(secret, 0)).rejects.toThrow(secret);
          expect(await redis.pipeline().get(secret).incr(secret).exec()).toEqual([
            [null, secret],
            [null, 1],
          ]);
          expect(await redis.call('echo', secret)).toBe('OK');
        })
      );
    } finally {
      parent.end();
    }
    await provider.forceFlush();

    const raw = exports.join('\n');
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('127.0.0.1');
    const spans = exports.flatMap((payload) => {
      const data = JSON.parse(payload) as {
        resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[];
      };
      return data.resourceSpans.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans)
      );
    });
    const commands = spans.filter(({ name }) => name.startsWith('redis '));
    expect(commands.map(({ name }) => name).sort()).toEqual([
      'redis EVAL',
      'redis GET',
      'redis GET',
      'redis INCR',
      'redis _OTHER',
    ]);
    for (const span of commands) {
      expect(span).toMatchObject({
        traceId,
        parentSpanId: parent.spanContext().spanId,
        kind: 3,
        attributes: [
          { key: 'db.system.name', value: { stringValue: 'redis' } },
          { key: 'db.operation.name', value: { stringValue: span.name.slice(6) } },
        ],
      });
    }
    expect(commands.find(({ name }) => name === 'redis EVAL')).toMatchObject({
      status: { code: 2 },
    });
  } finally {
    client?.disconnect();
    await module?.close();
    await provider.shutdown();
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      [collector, redisServer].map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve()))
      )
    );
  }
});

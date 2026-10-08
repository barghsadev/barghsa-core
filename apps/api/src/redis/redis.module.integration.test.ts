import 'reflect-metadata';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { Test, type TestingModule } from '@nestjs/testing';
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

import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { createRedisClient, pingRedis } from './redis-factory.js';
import { ConfigCache } from '../config-cache/config-cache.js';

it('bounds stalled socket commands and lets configuration reads fall back', async () => {
  const sockets = new Set<Socket>();
  let stalled = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let pending = '';
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      // ioredis encodes commands as RESP arrays of bulk strings.
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
        if (!stalled) socket.write(args[0]?.toLowerCase() === 'ping' ? '+PONG\r\n' : '+OK\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  let client: Awaited<ReturnType<typeof createRedisClient>> = null;
  try {
    client = await createRedisClient({
      url: '',
      host: '127.0.0.1',
      port: address.port,
      enableReadyCheck: false,
      commandTimeout: 100,
      connectTimeout: 500,
    });
    expect(client).not.toBeNull();
    expect((await pingRedis(client)).ok).toBe(true);
    stalled = true;
    const ping = await pingRedis(client);
    expect(ping).toMatchObject({ ok: false, error: 'Command timed out' });
    expect(ping.latencyMs).toBeLessThan(2000);
    const cache = new ConfigCache(
      async () => ({ value: 'database value', version: 7 }),
      async () => 7,
      client
    );
    const start = Date.now();
    expect(await cache.get('setting')).toBe('database value');
    expect(Date.now() - start).toBeLessThan(2000);
    client!.disconnect();
    await expect(client!.get('setting')).rejects.toThrow();
  } finally {
    client?.disconnect();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}, 5000);

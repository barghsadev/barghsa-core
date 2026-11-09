import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { browserCorsOptions } from './browser-origin.js';

const origin = 'https://app.example.test';

async function withApi(probe: (url: string) => Promise<void>): Promise<void> {
  const adapter = new ExpressAdapter();
  adapter.enableCors(browserCorsOptions());
  adapter.get('/resource', (_request: Request, response: Response) =>
    response.json({ ready: true })
  );
  const server: Server = adapter.getInstance().listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await probe(`http://127.0.0.1:${(server.address() as AddressInfo).port}/resource`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

afterEach(() => vi.unstubAllEnvs());

it('permits credentialed preflight only for the configured exact origin and headers', async () => {
  vi.stubEnv('APP_PUBLIC_URL', `${origin}/`);
  await withApi(async (url) => {
    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-csrf-token,x-unrecognized-header',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET,HEAD,POST,PUT,PATCH,DELETE'
    );
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type,X-CSRF-Token,Idempotency-Key,X-Draft-Revision'
    );
    expect(preflight.headers.get('Access-Control-Max-Age')).toBe('3600');
    expect(preflight.headers.get('Vary')).toContain('Origin');

    const trusted = await fetch(url, { headers: { Origin: origin } });
    expect(trusted.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(trusted.headers.get('Access-Control-Expose-Headers')).toBe(
      'X-Correlation-Id,X-Has-Next-Page,Retry-After'
    );
    expect(await trusted.json()).toEqual({ ready: true });
    for (const rejected of [`${origin}.evil.test`, 'null', 'http://app.example.test']) {
      const response = await fetch(url, {
        method: 'OPTIONS',
        headers: { Origin: rejected, 'Access-Control-Request-Method': 'POST' },
      });
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    }
  });
});

it.each(['*', 'http://app.example.test', 'https://name:secret@app.example.test'])(
  'does not enable credentialed CORS for unsafe production configuration (%s)',
  async (value) => {
    vi.stubEnv('APP_PUBLIC_URL', value);
    vi.stubEnv('NODE_ENV', 'production');
    await withApi(async (url) => {
      const response = await fetch(url, { headers: { Origin: origin } });
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    });
  }
);

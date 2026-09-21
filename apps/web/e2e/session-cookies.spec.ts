import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './coverage-fixture';

let server: Server;
let base: string;
let certificateDirectory: string;
const originalNodeEnv = process.env.NODE_ENV;
test.use({ ignoreHTTPSErrors: true });

test.beforeAll(async () => {
  // Exercise production Secure cookies over TLS, rather than HTTP loopback exceptions.
  process.env.NODE_ENV = 'production';
  certificateDirectory = await mkdtemp(join(tmpdir(), 'barghsa-cookie-tls-'));
  const key = join(certificateDirectory, 'key.pem');
  const cert = join(certificateDirectory, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' }
  );
  const require = createRequire(new URL('../../api/package.json', import.meta.url));
  const express = require('express') as typeof import('express');
  const {
    setSessionCookie,
    setRefreshCookie,
    setCsrfCookie,
    clearSessionCookie,
    clearRefreshCookie,
    clearCsrfCookie,
  } =
    require('./dist/src/session/cookie.helper.js') as typeof import('../../api/src/session/cookie.helper.js');
  const app = express();
  // Exercise actual Express serialization and production cookie helpers locally.
  // These fixture routes never enter the product application.
  app.post('/api/auth/login', (_request, response) => {
    const deadline = new Date(Date.now() + 60_000);
    setSessionCookie(response, 'replacement-session', deadline);
    setRefreshCookie(response, 'refresh-proof', deadline);
    setCsrfCookie(response, 'csrf-proof');
    response.json({ ok: true });
  });
  app.post('/api/auth/logout', (_request, response) => {
    clearSessionCookie(response);
    clearRefreshCookie(response);
    clearCsrfCookie(response);
    response.json({ ok: true });
  });
  app.get('/settings/security', (_request, response) =>
    response.type('html').send('<title>Cookie fixture</title>')
  );
  app.use((request, response) => response.json({ cookie: request.headers.cookie ?? '' }));
  server = createServer({ key: await readFile(key), cert: await readFile(cert) }, app);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  base = `https://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  if (certificateDirectory) await rm(certificateDirectory, { recursive: true, force: true });
});

test('browser narrows session delivery, removes legacy scope and clears every logout scope', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([
      { url: base, name: 'barghsa_session', value: 'legacy-session', httpOnly: true, secure: true },
    ]);
  await page.goto(`${base}/settings/security`);
  expect(
    await page.evaluate(async () => (await fetch('/api/auth/login', { method: 'POST' })).status)
  ).toBe(200);
  await expect
    .poll(async () =>
      (await page.context().cookies()).filter((cookie) => cookie.name === 'barghsa_session')
    )
    .toEqual([
      expect.objectContaining({
        value: 'replacement-session',
        path: '/api',
        sameSite: 'Lax',
        httpOnly: true,
        secure: true,
      }),
    ]);
  await expect.poll(() => page.evaluate(() => document.cookie)).toBe('barghsa_csrf=csrf-proof');
  const delivered = await page.evaluate(async () => {
    const result: Record<string, string> = {};
    for (const path of [
      '/api/profiles',
      '/api/auth/refresh',
      '/api/auth/refresh-extra',
      '/assets/app.js',
      '/apix',
    ]) {
      result[path] = (await (await fetch(path)).json()).cookie;
    }
    return result;
  });
  expect(delivered['/api/profiles']).toContain('barghsa_session=replacement-session');
  expect(delivered['/api/profiles']).not.toContain('barghsa_refresh');
  expect(delivered['/api/auth/refresh']).toContain('barghsa_refresh=refresh-proof');
  expect(delivered['/api/auth/refresh-extra']).not.toContain('barghsa_refresh');
  for (const path of ['/assets/app.js', '/apix']) {
    expect(delivered[path]).not.toContain('barghsa_session');
    expect(delivered[path]).not.toContain('barghsa_refresh');
  }
  // A browser restored with both historical and current paths must clear both.
  await page
    .context()
    .addCookies([
      { url: base, name: 'barghsa_session', value: 'legacy-session', httpOnly: true, secure: true },
    ]);
  expect(
    await page.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST' })).status)
  ).toBe(200);
  await expect
    .poll(async () =>
      (await page.context().cookies()).filter((cookie) =>
        ['barghsa_session', 'barghsa_refresh', 'barghsa_csrf'].includes(cookie.name)
      )
    )
    .toEqual([]);
});

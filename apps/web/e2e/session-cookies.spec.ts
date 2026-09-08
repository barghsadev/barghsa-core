import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import { test, expect } from './coverage-fixture';

let server: Server;
let base: string;

test.beforeAll(async () => {
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
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
});

test('browser narrows session delivery, removes legacy scope and clears every logout scope', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([{ url: base, name: 'barghsa_session', value: 'legacy-session', httpOnly: true }]);
  await page.goto(`${base}/settings/security`);
  expect(
    await page.evaluate(async () => (await fetch('/api/auth/login', { method: 'POST' })).status)
  ).toBe(200);
  const sessions = (await page.context().cookies()).filter(
    (cookie) => cookie.name === 'barghsa_session'
  );
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    value: 'replacement-session',
    path: '/api',
    sameSite: 'Lax',
    httpOnly: true,
  });
  expect(await page.evaluate(() => document.cookie)).toBe('barghsa_csrf=csrf-proof');
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
    .addCookies([{ url: base, name: 'barghsa_session', value: 'legacy-session', httpOnly: true }]);
  expect(
    await page.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST' })).status)
  ).toBe(200);
  expect(
    (await page.context().cookies()).filter((cookie) =>
      ['barghsa_session', 'barghsa_refresh', 'barghsa_csrf'].includes(cookie.name)
    )
  ).toEqual([]);
});

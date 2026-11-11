import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createStaticServer } from '../server.js';
import type { Server } from 'node:http';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { compressStaticAssets } from '../compress-static-assets.mjs';

const compressibleScript = 'console.log("static");\n'.repeat(256);
const compressibleCss = 'body { color: red; }\n'.repeat(256);

/**
 * Helper: make an HTTP request and return the status, headers, and body.
 */
function fetch(
  server: Server,
  path: string,
  method = 'GET',
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      reject(new Error('Server not listening on a port'));
      return;
    }
    const req = request(
      { hostname: '127.0.0.1', port: addr.port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string>,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('static server', () => {
  let server: Server;
  let distDir: string;

  beforeAll(async () => {
    // Create a temporary dist directory with test fixtures
    distDir = await mkdtemp(join(tmpdir(), 'barghsa-test-dist-'));
    await writeFile(
      join(distDir, 'index.html'),
      '<html><head><link rel="modulepreload" href="/assets/app-a1b2c3d4.js"><style nonce="old-style-nonce">body { color: red; }</style></head><body>Home<script type="module" src="/assets/app-a1b2c3d4.js"></script><script nonce="old-nonce">window.ready=true</script></body></html>'
    );
    await mkdir(join(distDir, 'assets'));
    await mkdir(join(distDir, 'auth'));
    await mkdir(join(distDir, 'auth', 'assets'));
    await mkdir(join(distDir, '.vite'));
    await writeFile(
      join(distDir, '.vite', 'history-preloads.json'),
      JSON.stringify({ '/electricity/orders': ['assets/gzip-a1b2c3d4.js', '//invalid.test/a.js'] })
    );
    await writeFile(
      join(distDir, 'auth', 'index.html'),
      '<html><head></head><body>Authentication<script type="module" src="/auth/assets/auth-a1b2c3d4.js"></script></body></html>'
    );
    await writeFile(join(distDir, 'assets', 'app-a1b2c3d4.js'), 'console.log("ok");');
    await writeFile(join(distDir, 'assets', 'style-XyZ78901.css'), 'body { color: red; }');
    await writeFile(join(distDir, 'assets', 'gzip-a1b2c3d4.js'), compressibleScript);
    await writeFile(join(distDir, 'auth', 'assets', 'gzip-a1b2c3d4.css'), compressibleCss);
    await writeFile(join(distDir, 'data.json'), JSON.stringify({ key: 'value' }));
    for (const directory of [distDir, join(distDir, 'auth')]) {
      await writeFile(
        join(directory, 'release.json'),
        JSON.stringify({ version: '0.1.0', commit: 'a'.repeat(40) })
      );
    }
    await compressStaticAssets(distDir);

    vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', 'production');
    server = createStaticServer({ distDir });
    vi.unstubAllEnvs();
    return new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves index.html at root', async () => {
    const res = await fetch(server, '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Home');
  });

  it.each([
    '/login',
    '/register/verify?next=/wallet',
    '/forgot-password',
    '/activate/token',
    '/auth/index.html',
  ])('serves the authentication entry with a matching nonce at %s', async (path) => {
    const res = await fetch(server, path);
    expect(res.status).toBe(200);
    expect(res.body).toContain('Authentication');
    const nonce = res.headers['content-security-policy-report-only']?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(res.body).toContain(`nonce="${nonce}"`);
    expect(res.headers['cache-control']).toContain('no-store');
  });
  it.each(['/wallet', '/electricity/order', '/savings', '/login-history', '/register-other'])(
    'keeps application and unrelated paths on the application entry at %s',
    async (path) => {
      expect((await fetch(server, path)).body).toContain('Home');
    }
  );

  it('sets production security headers', async () => {
    const res = await fetch(server, '/', 'GET', { 'x-environment': 'development' });
    expect(res.headers['x-environment']).toBe('production');
    expect(res.body).not.toContain('class="environment-indicator"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it.each([
    ['development', 'Dev'],
    ['staging', 'Staging'],
  ])('renders the %s badge with the response CSP nonce', async (environment, label) => {
    vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', environment);
    const lower = createStaticServer({ distDir });
    vi.unstubAllEnvs();
    try {
      await new Promise<void>((resolve) => lower.listen(0, '127.0.0.1', resolve));
      for (const path of ['/login', '/wallet']) {
        const res = await fetch(lower, path);
        expect(res.headers['x-environment']).toBe(environment);
        expect(res.body).toContain(`data-environment="${environment}"`);
        expect(res.body).toContain(`<span lang="en">${label}</span>`);
        const nonce =
          res.headers['content-security-policy-report-only']?.match(/'nonce-([^']+)'/)?.[1];
        expect(nonce).toBeTruthy();
        expect(res.body).toContain(`<style nonce="${nonce}">\n  .environment-indicator`);
      }
    } finally {
      await new Promise<void>((resolve) => lower.close(() => resolve()));
    }
  });

  it.each(['/', '/index.html', '/account'])(
    'binds a fresh CSP nonce to scripts, module preloads and styles at %s',
    async (path) => {
      const first = await fetch(server, path, 'GET', { 'csp-nonce': 'attacker-nonce' });
      const second = await fetch(server, path);
      const policy = first.headers['content-security-policy-report-only'];
      expect(policy).toContain("script-src 'strict-dynamic' 'nonce-");
      const nonce = policy!.match(/'nonce-([^']+)'/)?.[1];
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{32}$/);
      expect(
        first.body.match(new RegExp(`nonce="${nonce!.replace(/[+]/g, '\\+')}"`, 'g'))
      ).toHaveLength(4);
      expect(first.body).toContain(`<style nonce="${nonce}">`);
      expect(policy).toContain(`style-src 'self' 'nonce-${nonce}'`);
      expect(policy).toContain("style-src-attr 'unsafe-inline'");
      expect(first.body).not.toContain('old-style-nonce');
      expect(first.body).not.toContain('old-nonce');
      expect(policy).not.toContain('attacker-nonce');
      expect(second.headers['content-security-policy-report-only']).not.toBe(policy);
      expect(first.headers['cache-control']).toContain('no-store');
      expect(first.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
      expect(first.headers['content-security-policy']).toBeUndefined();
      expect(Number(first.headers['content-length'])).toBe(Buffer.byteLength(first.body));
    }
  );

  it('enforces the configured nonce policy without also sending Report-Only', async () => {
    vi.stubEnv('WEB_CSP_MODE', 'enforce');
    const enforcing = createStaticServer({ distDir });
    try {
      await new Promise<void>((resolve) => enforcing.listen(0, '127.0.0.1', resolve));
      const res = await fetch(enforcing, '/login');
      const policy = res.headers['content-security-policy'];
      const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
      expect(nonce).toBeTruthy();
      expect(res.body).toContain(`nonce="${nonce}"`);
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain('report-uri /api/csp-report');
      expect(res.headers['content-security-policy-report-only']).toBeUndefined();
      const asset = await fetch(enforcing, '/assets/app-a1b2c3d4.js');
      expect(asset.headers['content-security-policy']).toContain("script-src 'none'");
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve) => enforcing.close(() => resolve()));
    }
  });

  it('refuses to start with an unknown CSP mode', () => {
    vi.stubEnv('WEB_CSP_MODE', 'disabled');
    try {
      expect(() => createStaticServer({ distDir })).toThrow('WEB_CSP_MODE');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('serves static files with correct Content-Type', async () => {
    const html = await fetch(server, '/index.html');
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toMatch(/^text\/html/);

    const js = await fetch(server, '/assets/app-a1b2c3d4.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/^text\/javascript/);

    const css = await fetch(server, '/assets/style-XyZ78901.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/^text\/css/);

    const json = await fetch(server, '/data.json');
    expect(json.status).toBe(200);
    expect(json.headers['content-type']).toMatch(/^application\/json/);
  });

  it('gives non-hashed static files a one-day policy and varies by encoding', async () => {
    const response = await fetch(server, '/data.json');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=86400');
    expect(response.headers.vary).toBe('Accept-Encoding');
    expect(
      (await fetch(server, '/data.json?path=/assets/fake-abcdefgh.js')).headers['cache-control']
    ).toBe('public, max-age=86400');
  });

  it('does not serve or cache SPA HTML for missing static assets', async () => {
    for (const path of [
      '/assets/missing-a1b2c3d4.js',
      '/auth/assets/missing-a1b2c3d4.js',
      '/missing.svg',
      '/missing.svg?version=1',
      '/%61ssets/missing-a1b2c3d4.js',
    ]) {
      const response = await fetch(server, path);
      expect(response.status).toBe(404);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body).not.toContain('<html');
    }
  });

  it.each(['/release.json', '/auth/release.json?commit=latest'])(
    'revalidates release metadata at %s',
    async (path) => {
      const response = await fetch(server, path);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/json');
      expect(response.headers['cache-control']).toBe('no-cache, must-revalidate');
      expect(JSON.parse(response.body)).toEqual({ version: '0.1.0', commit: 'a'.repeat(40) });
    }
  );

  it('sets immutable Cache-Control for content-hashed assets', async () => {
    const res = await fetch(server, '/assets/app-a1b2c3d4.js');
    expect(res.headers['cache-control']).toBe('public, immutable, max-age=31536000');
  });

  it.each([
    ['/assets/gzip-a1b2c3d4.js', compressibleScript],
    ['/auth/assets/gzip-a1b2c3d4.css', compressibleCss],
  ])('serves the negotiated gzip bytes for %s without exposing sidecars', async (path, body) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Static fixture is unavailable');
    const encoded = await globalThis.fetch(`http://127.0.0.1:${addr.port}${path}`, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(encoded.status).toBe(200);
    expect(encoded.headers.get('content-encoding')).toBe('gzip');
    expect(encoded.headers.get('vary')).toBe('Accept-Encoding');
    expect(encoded.headers.get('cache-control')).toBe('public, immutable, max-age=31536000');
    const length = Number(encoded.headers.get('content-length'));
    expect(length).toBeGreaterThan(0);
    expect(length).toBeLessThan(Buffer.byteLength(body));
    expect(await encoded.text()).toBe(body);

    const head = await fetch(server, path, 'HEAD', { 'Accept-Encoding': 'gzip' });
    expect(head).toMatchObject({
      status: 200,
      headers: { 'content-length': String(length), 'content-encoding': 'gzip' },
      body: '',
    });
    const brotli = await globalThis.fetch(`http://127.0.0.1:${addr.port}${path}`, {
      headers: { 'Accept-Encoding': 'gzip, br' },
    });
    expect(brotli.headers.get('content-encoding')).toBe('br');
    expect(await brotli.text()).toBe(body);
    expect((await fetch(server, `${path}.br`)).status).toBe(404);
    const weighted = await fetch(server, path, 'HEAD', {
      'Accept-Encoding': 'br;q=0.4,gzip;q=0.8',
    });
    expect(weighted.headers['content-encoding']).toBe('gzip');

    const identity = await fetch(server, path, 'GET', {
      'Accept-Encoding': '*;q=1,gzip;q=0,br;q=0',
    });
    expect(identity).toMatchObject({ status: 200, body });
    expect(identity.headers['content-encoding']).toBeUndefined();
    expect((await fetch(server, `${path}.gz`)).status).toBe(404);
  });

  it('keeps HTML, metadata and old assets on their original representation', async () => {
    for (const path of ['/login', '/release.json', '/assets/app-a1b2c3d4.js']) {
      const result = await fetch(server, path, 'GET', { 'Accept-Encoding': 'gzip' });
      expect(result.status).toBe(200);
      expect(result.headers['content-encoding']).toBeUndefined();
    }
  });

  it('preloads trusted history modules with the page nonce for the matching route', async () => {
    const history = await fetch(server, '/electricity/orders/?q=visible');
    expect(history.status).toBe(200);
    const link = history.body.match(
      /<link nonce="([^"]+)" rel="modulepreload" crossorigin href="\/assets\/gzip-a1b2c3d4\.js">/
    );
    expect(link).not.toBeNull();
    expect(history.headers['content-security-policy-report-only']).toContain(`'nonce-${link![1]}'`);
    expect(history.body).not.toContain('invalid.test');
    expect((await fetch(server, '/electricity/orders/other')).body).not.toContain(
      '/assets/gzip-a1b2c3d4.js'
    );
    expect((await fetch(server, '/login')).body).not.toContain('/assets/gzip-a1b2c3d4.js');
  });

  it('prevents caching nonce-bearing HTML', async () => {
    const res = await fetch(server, '/index.html');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('provides SPA fallback for unknown routes', async () => {
    const res = await fetch(server, '/some/unknown/route');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Home');
  });

  it('returns 405 for non-GET/HEAD methods', async () => {
    const res = await fetch(server, '/', 'POST');
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBe('GET, HEAD');
  });

  it('returns 404 when dist is missing index.html', async () => {
    // Create a server pointing to an empty directory
    const emptyDir = await mkdtemp(join(tmpdir(), 'barghsa-empty-dist-'));
    const emptyServer = createStaticServer({ distDir: emptyDir });
    await new Promise<void>((resolve) => emptyServer.listen(0, '127.0.0.1', resolve));
    const res = await fetch(emptyServer, '/');
    expect(res.status).toBe(404);
    emptyServer.close();
  });

  it('serves HEAD requests without body', async () => {
    const res = await fetch(server, '/index.html', 'HEAD');
    expect(res.status).toBe(200);
    expect(res.body).toBe('');
  });

  it('handles malformed URI without crashing', async () => {
    const res = await fetch(server, '/%ZZ');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

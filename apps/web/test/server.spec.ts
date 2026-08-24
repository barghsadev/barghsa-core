import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createStaticServer } from '../server/index.js';
import type { Server } from 'node:http';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';

/**
 * Helper: make an HTTP request and return the status, headers, and body.
 */
function fetch(server: Server, path: string, method = 'GET'): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      reject(new Error('Server not listening on a port'));
      return;
    }
    const req = request(
      { hostname: '127.0.0.1', port: addr.port, path, method },
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
      },
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
    await writeFile(join(distDir, 'index.html'), '<html><body>Home</body></html>');
    await mkdir(join(distDir, 'assets'));
    await writeFile(join(distDir, 'assets', 'app-a1b2c3d4.js'), 'console.log("ok");');
    await writeFile(join(distDir, 'assets', 'style-XyZ78901.css'), 'body { color: red; }');
    await writeFile(join(distDir, 'data.json'), JSON.stringify({ key: 'value' }));

    server = createStaticServer({ distDir });
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

  it('sets immutable Cache-Control for content-hashed assets', async () => {
    const res = await fetch(server, '/assets/app-a1b2c3d4.js');
    expect(res.headers['cache-control']).toBe('public, immutable, max-age=31536000');
  });

  it('sets no-cache for index.html and unhashed resources', async () => {
    const res = await fetch(server, '/index.html');
    expect(res.headers['cache-control']).toBe('no-cache, must-revalidate');
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
});
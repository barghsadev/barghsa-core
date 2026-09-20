import { test, expect } from './coverage-fixture';
import { createStaticServer } from '../server.js';
import { createServer, request, type Server, type IncomingHttpHeaders } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let staticServer: Server, relay: Server, directory: string, base: string;
const reports: { headers: IncomingHttpHeaders; body: { 'csp-report': Record<string, unknown> } }[] =
  [];
function listen(server: Server) {
  return new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  );
}
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'barghsa-csp-'));
  await writeFile(
    join(directory, 'index.html'),
    `<html><head><link rel="modulepreload" href="/entry.js"></head><body><p id="ready"></p><script type="module" src="/entry.js"></script><button id="trigger" onclick="document.getElementById('ready').textContent='Report-only still runs'">Trigger violation</button></body></html>`
  );
  await writeFile(
    join(directory, 'entry.js'),
    'document.getElementById("ready").textContent="Trusted module loaded";'
  );
  staticServer = createStaticServer({ distDir: directory });
  const upstreamPort = await listen(staticServer);
  // Observe the browser's actual report transport without changing its policy or credentials.
  relay = createServer((req, res) => {
    if (req.url === '/api/csp-report' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        reports.push({ headers: req.headers, body: JSON.parse(body) });
        res.writeHead(204);
        res.end();
      });
      return;
    }
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: upstreamPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (reply) => {
        res.writeHead(reply.statusCode!, reply.headers);
        reply.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  base = `http://127.0.0.1:${await listen(relay)}`;
});
test.afterAll(async () => {
  for (const server of [relay, staticServer])
    if (server) await new Promise<void>((done) => server.close(() => done()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
for (const signedIn of [false, true])
  test(`native CSP reports retain browser transport (session cookie=${signedIn})`, async ({
    page,
    context,
  }) => {
    reports.length = 0;
    if (signedIn)
      await context.addCookies([{ name: 'barghsa_session', value: 'fixture-session', url: base }]);
    const response = await page.goto(base);
    const policy = response!.headers()['content-security-policy-report-only'];
    const nonce = policy!.match(/'nonce-([^']+)'/)![1];
    await expect(page.locator('#ready')).toHaveText('Trusted module loaded');
    await expect(page.locator('script')).toHaveJSProperty('nonce', nonce);
    await expect(page.locator('link')).toHaveJSProperty('nonce', nonce);
    await page.getByRole('button', { name: 'Trigger violation' }).click();
    await expect(page.locator('#ready')).toHaveText('Report-only still runs');
    await expect.poll(() => reports.length).toBeGreaterThan(0);
    for (const report of reports) {
      expect(report.body['csp-report']['effective-directive']).toBe('script-src-attr');
      expect(report.headers['content-type']).toBe('application/csp-report');
      expect(report.headers['sec-fetch-dest']).toBe('report');
      expect(report.headers['sec-fetch-site']).toBe('same-origin');
      expect(report.headers['x-csrf-token']).toBeUndefined();
      expect(report.headers.cookie).toBe(signedIn ? 'barghsa_session=fixture-session' : undefined);
    }
  });

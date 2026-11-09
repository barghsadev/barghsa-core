import { test, expect } from './coverage-fixture';
import { createStaticServer } from '../server.js';
import { createServer, request, type Server, type IncomingHttpHeaders } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
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
    `<html><head><link rel="modulepreload" href="/entry.js"><style nonce="stale">#ready { color: rgb(1, 2, 3); }</style></head><body><p id="ready"></p><script type="module" src="/entry.js"></script><button id="trigger" onclick="document.getElementById('ready').textContent='Report-only still runs'">Trigger violation</button></body></html>`
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
    browserName,
  }) => {
    reports.length = 0;
    if (signedIn)
      await context.addCookies([{ name: 'barghsa_session', value: 'fixture-session', url: base }]);
    const response = await page.goto(base);
    expect(await response!.request().headerValue('cookie')).toBe(
      signedIn ? 'barghsa_session=fixture-session' : null
    );
    const policy = response!.headers()['content-security-policy-report-only'];
    const nonce = policy!.match(/'nonce-([^']+)'/)![1];
    await expect(page.locator('#ready')).toHaveText('Trusted module loaded');
    await expect(page.locator('script')).toHaveJSProperty('nonce', nonce);
    await expect(page.locator('link')).toHaveJSProperty('nonce', nonce);
    await expect(page.locator('style')).toHaveJSProperty('nonce', nonce);
    await page.getByRole('button', { name: 'Trigger violation' }).click();
    await expect(page.locator('#ready')).toHaveText('Report-only still runs');
    await expect.poll(() => reports.length).toBeGreaterThan(0);
    for (const report of reports) {
      expect(report.body['csp-report']['effective-directive']).toBe('script-src-attr');
      expect(report.headers['content-type']).toBe('application/csp-report');
      // Native report transport differs by engine; no application request is substituted.
      expect(report.headers['sec-fetch-dest']).toBe(browserName === 'webkit' ? 'empty' : 'report');
      expect(report.headers['sec-fetch-site']).toBe('same-origin');
      expect(report.headers['x-csrf-token']).toBeUndefined();
      expect(report.headers.cookie).toBe(
        signedIn && browserName !== 'firefox' ? 'barghsa_session=fixture-session' : undefined
      );
    }
  });

test('enforced policy blocks untrusted style elements and keeps dynamic style attributes', async ({
  page,
}) => {
  const originalMode = process.env.WEB_CSP_MODE;
  process.env.WEB_CSP_MODE = 'enforce';
  const enforced = createStaticServer({ distDir: directory });
  if (originalMode === undefined) delete process.env.WEB_CSP_MODE;
  else process.env.WEB_CSP_MODE = originalMode;

  try {
    const origin = `http://127.0.0.1:${await listen(enforced)}`;
    const response = await page.goto(origin);
    const policy = response!.headers()['content-security-policy'];
    const nonce = policy.match(/'nonce-([^']+)'/)![1];
    await expect(page.locator('style')).toHaveJSProperty('nonce', nonce);
    await expect(page.locator('#ready')).toHaveCSS('color', 'rgb(1, 2, 3)');

    await page.evaluate(() => {
      const untrustedStyle = document.createElement('style');
      untrustedStyle.textContent = '#ready { color: rgb(4, 5, 6); }';
      document.head.appendChild(untrustedStyle);
      document.getElementById('ready')!.setAttribute('style', 'background-color: rgb(7, 8, 9)');
    });
    await expect(page.locator('#ready')).toHaveCSS('color', 'rgb(1, 2, 3)');
    await expect(page.locator('#ready')).toHaveCSS('background-color', 'rgb(7, 8, 9)');
  } finally {
    await new Promise<void>((done) => enforced.close(() => done()));
  }
});

test('compiled workspace validation avoids dynamic evaluation under enforced CSP', async ({
  baseURL,
  page,
}) => {
  test.skip(!process.env['PLAYWRIGHT_BASE_URL'], 'Requires the compiled application server');
  const build = process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist';
  const manifest: Record<string, { file: string }> = JSON.parse(
    await readFile(new URL(`../${build}/.vite/manifest.json`, import.meta.url), 'utf8')
  );
  const asset = manifest['../../packages/shared/dist/finance/index.js']?.file;
  expect(asset).toMatch(/^assets\/[a-zA-Z0-9_.-]+\.js$/);
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', ({ blockedURI }) => {
      if (blockedURI === 'eval') {
        const root = document.documentElement;
        root.dataset.evalBlocked = String(Number(root.dataset.evalBlocked ?? 0) + 1);
      }
    });
  });
  await page.route('**/api/**', (route) =>
    new URL(route.request().url()).pathname === '/api/csp-report'
      ? route.fulfill({ status: 204 })
      : route.fulfill({ status: 404, json: {} })
  );
  const origin = new URL('/', baseURL).href;
  await page.route(origin, async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    headers['content-security-policy'] ??= headers['content-security-policy-report-only']!;
    expect(headers['content-security-policy']).toMatch(/script-src 'strict-dynamic' 'nonce-/);
    delete headers['content-security-policy-report-only'];
    await route.fulfill({ response, headers });
  });
  const response = await page.goto(origin);
  const policy = response!.headers()['content-security-policy'];
  const nonce = policy.match(/'nonce-([^']+)'/)![1];
  expect(policy).not.toContain("'unsafe-eval'");
  await page.evaluate(
    ({ asset, nonce }) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.nonce = nonce;
      script.textContent = `import ${JSON.stringify(`/${asset}`)};
          document.documentElement.dataset.financeValidationReady = 'true';`;
      document.head.appendChild(script);
    },
    { asset, nonce }
  );
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-finance-validation-ready', 'true');
  await expect(root).not.toHaveAttribute('data-eval-blocked');

  await page.evaluate((nonce) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.nonce = nonce;
    script.textContent = `try { new Function(""); } catch {}
      document.documentElement.dataset.evalControl = 'true';`;
    document.head.appendChild(script);
  }, nonce);
  await expect(root).toHaveAttribute('data-eval-control', 'true');
  await expect(root).toHaveAttribute('data-eval-blocked', '1');
});

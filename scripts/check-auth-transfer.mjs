import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { createStaticServer } from '../apps/web/server.js';

// Measure actual production browser requests as well as the manifest gate.
// Each route uses a fresh context, without a warm HTTP/module cache.
const { chromium } = createRequire(new URL('../apps/web/package.json', import.meta.url))(
  '@playwright/test'
);
const server = createStaticServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch();
  for (const delayedSession of [false, true]) {
    for (const route of ['/login', '/register', '/forgot-password']) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.route('**/api/**', (request) => request.fulfill({ status: 404, json: {} }));
        await page.route('**/api/auth/user', async (request) => {
          if (delayedSession) {
            // Include the pending chunk when the session check outlasts the first paint.
            await page
              .getByRole('status', { name: /Loading page|در حال بارگذاری صفحه/ })
              .waitFor({ timeout: 5000 });
          }
          await request.fulfill({ status: 401, json: {} });
        });
        await page.route('**/api/auth/csrf', (request) =>
          request.fulfill({ json: { csrfToken: 'c'.repeat(64) } })
        );
        const scripts = new Map();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('response', (response) => {
          if (new URL(response.url()).pathname.endsWith('.js'))
            scripts.set(response.url(), response.body());
        });
        await page.goto(base + route);
        await page.locator('.auth-form').getByRole('heading', { level: 1 }).waitFor();
        const label = `${route} (${delayedSession ? 'delayed session' : 'immediate session'})`;
        if (errors.length) throw new Error(`${label}: ${errors.join('; ')}`);
        const bodies = await Promise.all(scripts.values());
        if (!bodies.length) throw new Error(`${label}: no production scripts observed`);
        const bytes = bodies.reduce((sum, body) => sum + gzipSync(body).length, 0);
        if (bytes >= 150000) throw new Error(`${label}: ${bytes} gzip bytes exceeds 150 KB`);
        console.log(
          `PASS browser ${label}: ${(bytes / 1000).toFixed(2)} KB gzip, ${scripts.size} scripts`
        );
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
const answer = {
  reply: 'Owned published staff guidance.',
  sources: [
    {
      kbId: '01900000-0000-7000-8000-000000000001',
      title: 'Staff reference',
      documentTitle: 'staff.txt',
      excerpt: '<script>literal staff source</script>',
    },
  ],
  attribution: 'retrieved_context',
  remainingQuota: 4,
  policyChecks: [],
  answeredAt: '2026-10-08T01:00:00.000Z',
};
let staffServer: Server | undefined;
test.afterEach(async () => {
  if (!staffServer) return;
  const server = staffServer;
  staffServer = undefined;
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
});
for (const locale of ['en', 'fa'] as const) {
  test(
    'assigned staff guide uses CSRF and clears answers after access loss (' + locale + ')',
    async ({ page, baseURL }, info) => {
      await page.setViewportSize(
        locale === 'fa' ? { width: 390, height: 844 } : { width: 1280, height: 960 }
      );
      await setupCatalogueForms(page, locale, locale === 'fa');
      await page.context().addCookies([
        { name: 'barghsa_session', value: 'owned-staff-browser', url: baseURL! },
        { name: 'barghsa_csrf', value: 'owned-staff-csrf', url: baseURL! },
      ]);
      await page.route('**/api/admin/agents/options', (r) =>
        r.fulfill({ json: { models: [], kbs: [], policies: [], kbGroups: [], policyGroups: [] } })
      );
      await page.route('**/api/admin/agents', (r) => r.fulfill({ json: [] }));
      const sent: unknown[] = [];
      const privateReads: string[] = [];
      page.on('request', (r) => {
        if (/\/api\/(profiles|dashboard|ai\/knowledge)(?:\/|$)/.test(r.url()))
          privateReads.push(r.url());
      });
      const httpErrors: unknown[] = [];
      staffServer = createServer(async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Access-Control-Allow-Origin', new URL(baseURL!).origin);
        response.setHeader('Access-Control-Allow-Credentials', 'true');
        response.setHeader(
          'Access-Control-Allow-Headers',
          'content-type, accept-language, x-csrf-token'
        );
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (request.method === 'OPTIONS') {
          response.statusCode = 204;
          response.end();
          return;
        }
        try {
          // WebKit omits cookies from intercepted headers; verify the actual HTTP request.
          expect(request.headers.cookie).toContain('barghsa_session=owned-staff-browser');
          if (request.url === '/api/staff/knowledge/availability') {
            response.end(JSON.stringify({ available: true }));
            return;
          }
          expect(request.headers['x-csrf-token']).toBe('owned-staff-csrf');
          expect(request.headers.cookie).toContain('barghsa_session=owned-staff-browser');
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          sent.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          response.statusCode = sent.length === 1 ? 200 : 403;
          response.end(
            JSON.stringify(sent.length === 1 ? answer : { error: { code: 'AUTHZ:FORBIDDEN' } })
          );
        } catch (error) {
          httpErrors.push(error);
          response.statusCode = 500;
          response.end('{}');
        }
      });
      await new Promise<void>((done) => staffServer!.listen(0, '127.0.0.1', done));
      const staffOrigin = `http://127.0.0.1:${(staffServer.address() as AddressInfo).port}`;
      await page.route('**/api/staff/knowledge/**', (route) =>
        route.continue({ url: staffOrigin + new URL(route.request().url()).pathname })
      );
      await page.goto('/admin/agents');
      const guide = page.locator('[data-slot=staff-knowledge]');
      await expect(
        guide.getByRole('heading', { name: t('assistant.staff.title', locale) })
      ).toBeVisible();
      const input = guide.getByLabel(t('assistant.public.question', locale), { exact: true });
      await input.fill(
        locale === 'fa' ? 'راهنمای کارکنان را توضیح دهید.' : 'Explain the staff guidance.'
      );
      await input.press('Enter');
      await expect(guide).toContainText(answer.reply);
      await guide.locator('summary').click();
      await expect(guide).toContainText(answer.sources[0]!.excerpt);
      await guide.getByText(answer.sources[0]!.excerpt, { exact: true }).scrollIntoViewIfNeeded();
      await expect(guide.getByText(answer.sources[0]!.excerpt, { exact: true })).toBeVisible();
      expect(await guide.locator('script').count()).toBe(0);
      expect(sent).toEqual([
        {
          message:
            locale === 'fa' ? 'راهنمای کارکنان را توضیح دهید.' : 'Explain the staff guidance.',
        },
      ]);
      expect(privateReads).toEqual([]);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-slot=staff-knowledge]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({
        path: info.outputPath('staff-guide-' + locale + '.png'),
        fullPage: false,
      });
      await input.fill('Another question');
      await input.press('Enter');
      await expect(guide).not.toContainText(answer.reply);
      await expect(input).toHaveCount(0);
      expect(sent).toHaveLength(2);
      expect(httpErrors).toEqual([]);
    }
  );
}

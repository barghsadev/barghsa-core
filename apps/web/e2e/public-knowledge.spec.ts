import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';

const answer = {
  reply: 'Published service guidance.',
  sources: [
    {
      kbId: '01900000-0000-7000-8000-000000000001',
      title: 'Published guide',
      documentTitle: 'guide.txt',
      excerpt: '<script>literal public source</script>',
    },
  ],
  attribution: 'retrieved_context',
  remainingQuota: 4,
  policyChecks: [],
  answeredAt: '2026-10-08T01:00:00.000Z',
};

for (const locale of ['en', 'fa'] as const) {
  test(
    'anonymous website guide uses public requests and safe sources (' + locale + ')',
    async ({ page, baseURL }, info) => {
      await page.setViewportSize(
        locale === 'fa' ? { width: 390, height: 844 } : { width: 1280, height: 960 }
      );
      await setupCatalogueForms(page, locale, locale === 'fa');
      await page
        .context()
        .addCookies([{ name: 'barghsa_session', value: 'owned-browser-fixture', url: baseURL! }]);
      const sent: unknown[] = [];
      const privateReads: string[] = [];
      page.on('request', (request) => {
        if (/\/api\/(profiles|dashboard|ai\/knowledge|user\/settings)/.test(request.url()))
          privateReads.push(request.url());
      });
      await page.route('**/api/public/knowledge/availability', (route) => {
        expect(route.request().headers().cookie).toBeUndefined();
        return route.fulfill({ json: { available: true } });
      });
      await page.route('**/api/public/knowledge/questions', (route) => {
        expect(route.request().headers().cookie).toBeUndefined();
        expect(route.request().headers()['x-csrf-token']).toBeUndefined();
        sent.push(route.request().postDataJSON());
        return route.fulfill({ json: answer });
      });
      await page.goto('/support');
      const guide = page.locator('[data-slot=public-knowledge]');
      await expect(
        guide.getByRole('heading', { name: t('assistant.public.title', locale) })
      ).toBeVisible();
      const input = guide.getByLabel(t('assistant.public.question', locale), { exact: true });
      const question =
        locale === 'fa' ? 'درباره خدمات برقسا توضیح دهید.' : 'Explain Barghsa services.';
      await input.fill(question);
      await input.press('Enter');
      await expect(guide).toContainText(answer.reply);
      expect(sent).toEqual([{ message: question }]);
      await guide
        .getByText(t('assistant.sources', locale) + ' · ' + (locale === 'fa' ? '۱' : '1'), {
          exact: true,
        })
        .click();
      await expect(guide).toContainText(answer.sources[0]!.excerpt);
      expect(await guide.locator('script').count()).toBe(0);
      expect(privateReads).toEqual([]);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-slot=public-knowledge]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      const bounds = await guide.evaluate((element) => {
        const container = element.getBoundingClientRect();
        return [...element.querySelectorAll('h2,p,textarea,button')].map((child) => {
          const rect = child.getBoundingClientRect();
          return { within: rect.left >= container.left - 1 && rect.right <= container.right + 1 };
        });
      });
      expect(bounds.every((bound) => bound.within)).toBe(true);
      await page.screenshot({
        path: info.outputPath('public-guide-' + locale + '.png'),
        fullPage: true,
      });
    }
  );
  test(
    'public guide recovers a changed slot and respects cooldown (' + locale + ')',
    async ({ page }) => {
      await setupCatalogueForms(page, locale, locale === 'fa');
      let available = false;
      let asks = 0;
      await page.route('**/api/public/knowledge/availability', (route) =>
        route.fulfill({ json: { available } })
      );
      await page.route('**/api/public/knowledge/questions', (route) => {
        asks++;
        return route.fulfill(
          asks === 1
            ? {
                status: 429,
                headers: { 'Retry-After': '2' },
                json: { error: { code: 'RATE_LIMIT:EXCEEDED' } },
              }
            : asks === 2
              ? {
                  status: 409,
                  json: { error: { code: 'AI_WEBSITE_SCOPE_CHANGED' } },
                }
              : { json: answer }
        );
      });
      await page.goto('/support');
      const guide = page.locator('[data-slot=public-knowledge]');
      await expect(guide).toContainText(t('assistant.public.unavailable', locale));
      available = true;
      await guide.getByRole('button', { name: t('assistant.public.refresh', locale) }).click();
      const input = guide.getByLabel(t('assistant.public.question', locale), { exact: true });
      await input.fill('Question');
      const send = guide.getByRole('button', { name: t('assistant.public.send', locale) });
      await send.click();
      await expect(send).toBeDisabled();
      await expect(send).toBeEnabled({ timeout: 5000 });
      await send.click();
      await expect(input).toHaveCount(0);
      await guide.getByRole('button', { name: t('assistant.public.refresh', locale) }).click();
      await input.fill('A new question');
      await send.click();
      await expect(guide).toContainText(answer.reply);
      expect(asks).toBe(3);
    }
  );
}

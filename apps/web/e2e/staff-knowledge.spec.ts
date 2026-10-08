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
      await page.route('**/api/staff/knowledge/availability', (r) => {
        expect(r.request().headers().cookie).toContain('barghsa_session=owned-staff-browser');
        return r.fulfill({ json: { available: true } });
      });
      await page.route('**/api/staff/knowledge/questions', (r) => {
        expect(r.request().headers()['x-csrf-token']).toBe('owned-staff-csrf');
        expect(r.request().headers().cookie).toContain('barghsa_session=owned-staff-browser');
        sent.push(r.request().postDataJSON());
        return r.fulfill(
          sent.length === 1
            ? { json: answer }
            : { status: 403, json: { error: { code: 'AUTHZ:FORBIDDEN' } } }
        );
      });
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
    }
  );
}

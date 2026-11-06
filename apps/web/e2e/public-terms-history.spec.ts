import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n';
import { termsHistoryText } from '@barghsa/i18n/terms-history';
import { test, expect } from './coverage-fixture';

for (const locale of ['en', 'fa'] as const)
  test(`public history retains its page through retry and opens an exact immutable version (${locale})`, async ({
    page,
  }, info) => {
    const ids = [1, 2, 3].map(
      (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
    );
    const versions = ids.map((id, index) => ({
      id,
      versionId: `v${index + 1}`,
      publishedAt: `2026-09-0${index + 1}T00:00:00Z`,
    }));
    const reads: string[] = [],
      writes: string[] = [];
    let failed = false;
    await page.addInitScript((locale) => localStorage.setItem('barghsa.locale', locale), locale);
    await page.route('**/api/**', (route) => {
      if (route.request().method() !== 'GET') writes.push(route.request().url());
      return route.fulfill({ status: 404, json: {} });
    });
    await page.route('**/api/tos/current?*', (route) => {
      const id = new URL(route.request().url()).searchParams.get('versionId') ?? ids[2];
      const version = versions.find((item) => item.id === id)!;
      return route.fulfill({
        json: {
          ...version,
          content: `Published content ${version.versionId}`,
          updatedAt: version.publishedAt,
        },
      });
    });
    await page.route('**/api/tos/versions{,?*}', (route) => {
      const before = new URL(route.request().url()).searchParams.get('before');
      reads.push(before ?? 'first');
      if (before && !failed) {
        failed = true;
        return route.fulfill({ status: 503, json: {} });
      }
      return route.fulfill({
        json: {
          versions: before ? [versions[0]] : [versions[2], versions[1]],
          nextCursor: before ? null : ids[1],
        },
      });
    });
    await page.goto(`/terms?lang=${locale}`);
    await expect(page.getByText('Published content v3', { exact: true })).toBeVisible();
    expect(reads).toEqual([]);
    const history = page
      .locator('details')
      .filter({ has: page.getByText(termsHistoryText('history', locale), { exact: true }) });
    await history.locator('summary').click();
    await expect(history.getByRole('link', { name: 'v3', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await history.getByRole('button', { name: termsHistoryText('moreVersions', locale) }).click();
    await expect(history.getByRole('alert')).toContainText(
      termsHistoryText('historyError', locale)
    );
    await expect(history.getByRole('link', { name: 'v2', exact: true })).toBeVisible();
    await expect(page.getByText('Published content v3', { exact: true })).toBeVisible();
    await history.getByRole('button', { name: t('tos.page.retry', locale) }).click();
    await expect(history.getByRole('link', { name: 'v1', exact: true })).toBeVisible();
    expect(reads).toEqual(['first', ids[1], ids[1]]);
    await history.getByRole('link', { name: 'v1', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`version=${ids[0]}`));
    await expect(page.getByText('Published content v1', { exact: true })).toBeVisible();
    expect(writes).toEqual([]);
    expect(
      (
        await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: info.outputPath(`public-terms-${locale}.png`) });
  });

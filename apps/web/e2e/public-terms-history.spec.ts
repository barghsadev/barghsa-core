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

for (const locale of ['en', 'fa'] as const)
  test(`stalled public terms and history resume the same version and cursor (${locale})`, async ({
    page,
    context,
    baseURL,
  }) => {
    const id = '00000000-0000-4000-8000-000000000002';
    const olderId = '00000000-0000-4000-8000-000000000001';
    const publishedAt = '2026-09-01T00:00:00Z';
    const currentReads: (string | null)[] = [];
    const historyReads: (string | null)[] = [];
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    const document = (content: string) => ({
      id,
      versionId: 'v2',
      content,
      updatedAt: publishedAt,
      publishedAt,
    });
    await context.addCookies([{ name: 'fixture-session', value: 'private', url: baseURL! }]);
    await page.clock.install();
    await page.route('**/api/tos/current?*', async (route) => {
      expect(route.request().method()).toBe('GET');
      expect((await route.request().allHeaders()).cookie).toBeUndefined();
      const query = new URL(route.request().url()).searchParams;
      expect(query.get('locale')).toBe(locale);
      currentReads.push(query.get('versionId'));
      if (currentReads.length === 1) {
        await held;
        await route.fulfill({ json: document('Obsolete terms response') }).catch(() => {});
      } else {
        await route.fulfill({ json: document('Published current terms') });
      }
    });
    await page.route('**/api/tos/versions{,?*}', async (route) => {
      expect(route.request().method()).toBe('GET');
      expect((await route.request().allHeaders()).cookie).toBeUndefined();
      const cursor = new URL(route.request().url()).searchParams.get('before');
      historyReads.push(cursor);
      if (historyReads.length === 2) {
        await held;
        await route.abort().catch(() => {});
      } else {
        await route.fulfill({
          json: cursor
            ? { versions: [{ id: olderId, versionId: 'v1', publishedAt }], nextCursor: null }
            : { versions: [{ id, versionId: 'v2', publishedAt }], nextCursor: id },
        });
      }
    });
    try {
      await page.goto(`/terms?lang=${locale}&version=${id}`);
      const retry = page.getByRole('button', { name: t('tos.page.retry', locale), exact: true });
      await expect.poll(() => currentReads).toEqual([id]);
      await expect(page.getByText(t('tos.page.loading', locale), { exact: true })).toBeVisible();
      await page.clock.fastForward(15_100);
      await expect(retry).toBeVisible();
      await expect(page.getByRole('article')).toHaveCount(0);
      await retry.click();
      await expect(page.getByRole('article')).toContainText('Published current terms');
      expect(currentReads).toEqual([id, id]);

      const history = page.locator('details').filter({
        has: page.getByText(termsHistoryText('history', locale), { exact: true }),
      });
      await history.locator('summary').click();
      await expect(history.getByRole('link', { name: 'v2', exact: true })).toBeVisible();
      await history.getByRole('button', { name: termsHistoryText('moreVersions', locale) }).click();
      await expect.poll(() => historyReads).toEqual([null, id]);
      await page.clock.fastForward(15_100);
      await expect(history.getByRole('alert')).toHaveText(termsHistoryText('historyError', locale));
      await expect(history.getByRole('link', { name: 'v2', exact: true })).toBeVisible();
      await history.getByRole('button', { name: t('tos.page.retry', locale) }).click();
      await expect(history.getByRole('link', { name: 'v1', exact: true })).toBeVisible();
      expect(historyReads).toEqual([null, id, id]);
      await expect(page.getByRole('article')).toContainText('Published current terms');
    } finally {
      release();
    }
  });

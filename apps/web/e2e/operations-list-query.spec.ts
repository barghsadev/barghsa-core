import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';
import { deadLetter, failedJob } from '../src/test/operational-queue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
const params = (page: Page) => new URL(page.url()).searchParams;
async function shell(page: Page, locale: 'fa' | 'en', dark: boolean) {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برق‌آسا',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        logoUrl: null,
        faviconUrl: null,
        darkMode: dark,
      },
    })
  );
}
async function inspect(page: Page, locale: string, project: string, domain: string, dark: boolean) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(dark);
  const dialog = page.getByRole('dialog');
  if (await dialog.count())
    await dialog.evaluate(async (node) => {
      await Promise.all(
        node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))
      );
    });
  expect(
    (
      await new AxeBuilder({ page })
        .include((await dialog.count()) ? '[role="dialog"]' : 'main > div')
        .analyze()
    ).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-operations-query-${domain}-${dark ? 'dark' : 'light'}.png`,
    });
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`job queue URLs restore status, type and exact failed-page recovery (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const word = (key: string) => t(`admin.jobs.${key}`, locale);
      let fail = true,
        denied = false;
      const reads: URL[] = [];
      const rows = Array.from({ length: 26 }, (_, index) => ({
        ...failedJob,
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      }));
      await page.route('**/api/admin/failed-jobs/access', (route) =>
        route.fulfill({ json: { canView: true, canRetry: true } })
      );
      await page.route('**/api/admin/failed-jobs?*', (route) => {
        const url = new URL(route.request().url());
        reads.push(url);
        return route.fulfill({
          status: denied ? 403 : fail && url.searchParams.get('offset') === '50' ? 503 : 200,
          json: url.searchParams.get('offset') === '50' ? [failedJob] : rows,
        });
      });
      await page.goto('/admin/failed-jobs?status=failed&jobType=storage_cleanup&page=2');
      const root = page.getByRole('main');
      const type = root.getByRole('combobox', { name: word('type'), exact: true });
      await expect(root.locator('tbody tr')).toHaveCount(25);
      await expect(type).toHaveValue('storage_cleanup');
      await expect(
        root.getByRole('button', { name: word('status.failed'), exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
        status: 'failed',
        jobType: 'storage_cleanup',
        limit: '26',
        offset: '25',
      });
      await root.locator('tbody tr').first().getByRole('checkbox').check();
      await root.getByRole('button', { name: word('next'), exact: true }).click();
      await expect(root.getByRole('alert')).toBeVisible();
      await expect(root.locator('tbody tr')).toHaveCount(25);
      await expect(root.locator('tbody tr').first().getByRole('checkbox')).toBeChecked();
      expect(params(page).get('page')).toBe('3');
      const failedQuery = reads.at(-1)!.search;
      fail = false;
      await root.getByRole('button', { name: word('reload'), exact: true }).click();
      await expect(root.locator('tbody tr')).toHaveCount(1);
      expect(reads.at(-1)!.search).toBe(failedQuery);
      await page.reload();
      await expect(root.locator('tbody tr')).toHaveCount(1);
      await root.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(root.locator('tbody tr')).toHaveCount(25);
      await page.goForward();
      await expect(root.locator('tbody tr')).toHaveCount(1);
      await root.getByRole('button', { name: word('status.all'), exact: true }).click();
      await expect.poll(() => reads.at(-1)?.searchParams.has('status')).toBe(false);
      expect(params(page).get('status')).toBe('all');
      expect(params(page).has('page')).toBe(false);
      await type.selectOption('');
      await expect.poll(() => reads.at(-1)?.searchParams.has('jobType')).toBe(false);
      await page.reload();
      await expect(type).toHaveValue('');
      await expect(
        root.getByRole('button', { name: word('status.all'), exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      await inspect(page, locale, info.project.name, 'jobs', dark);
      denied = true;
      await root.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(root.locator('tbody tr')).toHaveCount(0);
      await expect(root.getByRole('alert')).toContainText(word('forbidden'));
    });

    for (const path of ['notifications', 'failed-notifications']) {
      test(`delivery history URLs restore search, page and target independently (${path}, ${locale}, ${dark})`, async ({
        page,
      }, info) => {
        await shell(page, locale, dark);
        const word = (key: string) => t(`admin.notifications.history.${key}`, locale);
        const common = (key: string) => t(`admin.jobs.${key}`, locale);
        let fail = false,
          denied = false;
        const reads: URL[] = [];
        await page.route('**/api/admin/notifications/templates*', (route) =>
          route.fulfill({ json: [{ ...notificationTemplate(), locale }] })
        );
        await page.route('**/api/admin/failed-notifications/access', (route) =>
          route.fulfill({ status: denied ? 403 : 200, json: { canView: true, canRetry: true } })
        );
        await page.route('**/api/admin/failed-notifications?*', (route) =>
          route.fulfill({ json: [deadLetter] })
        );
        await page.route('**/api/admin/notifications/delivery-logs?*', (route) => {
          const url = new URL(route.request().url());
          reads.push(url);
          const second = url.searchParams.get('offset') === '25';
          const row = {
            id: '40000000-0000-4000-8000-000000000001',
            notificationId: url.searchParams.get('notificationId') || deadLetter.outboxId,
            channel: url.searchParams.get('channel') || 'email',
            status: url.searchParams.get('status') || 'delivered',
            attemptNumber: 1,
            providerRef: 'accepted-reference',
            latencyMs: 30,
            errorCategory: null,
            errorDetail: null,
            createdAt: '2026-09-01T01:00:00Z',
          };
          return route.fulfill({
            status: fail && second ? 503 : 200,
            json: second
              ? [row]
              : Array.from({ length: 26 }, (_, index) => ({
                  ...row,
                  id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
                  attemptNumber: index + 1,
                })),
          });
        });
        await page.goto(
          `/admin/${path}?failed_status=all&failed_channel=email&failed_page=2&history_mode=all&history_notificationId=${deadLetter.outboxId}&history_channel=email&history_status=delivered&history_page=2${path === 'notifications' ? `&locale=${locale}&preview_event=welcome_email&preview_channel=email&preview_locale=${locale}&preview_version=template-recovery` : ''}`
        );
        const dialog = page.getByRole('dialog');
        const id = dialog.getByRole('textbox', { name: word('notificationId'), exact: true });
        const channel = dialog.getByRole('combobox', { name: word('channel'), exact: true });
        const status = dialog.getByRole('combobox', { name: word('status'), exact: true });
        await expect(dialog.locator('tbody tr')).toHaveCount(1);
        await expect(id).toHaveValue(deadLetter.outboxId);
        await expect(channel).toHaveValue('email');
        await expect(status).toHaveValue('delivered');
        expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
          notificationId: deadLetter.outboxId,
          channel: 'email',
          status: 'delivered',
          limit: '26',
          offset: '25',
        });
        const newId = 'abcdef00-0000-4000-8000-000000000001';
        const initialReads = reads.length;
        await id.fill('invalid');
        await dialog.getByRole('button', { name: word('search'), exact: true }).click();
        expect(await id.evaluate((node: HTMLInputElement) => node.validity.valid)).toBe(false);
        expect(reads).toHaveLength(initialReads);
        await id.fill(newId);
        await channel.selectOption('sms');
        await status.selectOption('failed');
        expect(params(page).get('history_notificationId')).toBe(deadLetter.outboxId);
        expect(reads).toHaveLength(initialReads);
        await dialog.getByRole('button', { name: word('search'), exact: true }).click();
        await expect.poll(() => reads.at(-1)?.searchParams.get('notificationId')).toBe(newId);
        await expect(dialog.locator('tbody tr')).toHaveCount(25);
        expect(params(page).get('failed_page')).toBe('2');
        expect(params(page).has('history_page')).toBe(false);
        if (path === 'notifications') {
          expect(params(page).get('preview_version')).toBe('template-recovery');
          expect(params(page).get('locale')).toBe(locale);
        }
        fail = true;
        await dialog.getByRole('button', { name: common('next'), exact: true }).click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(id).toHaveValue(newId);
        const failedQuery = reads.at(-1)!.search;
        fail = false;
        await dialog.getByRole('button', { name: common('reload'), exact: true }).click();
        await expect(dialog.locator('tbody tr')).toHaveCount(1);
        expect(reads.at(-1)!.search).toBe(failedQuery);
        await page.reload();
        await expect(dialog.locator('tbody tr')).toHaveCount(1);
        await expect(id).toHaveValue(newId);
        await expect(channel).toHaveValue('sms');
        await expect(status).toHaveValue('failed');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        expect(params(page).has('history_mode')).toBe(false);
        await page.goBack();
        await expect(dialog.locator('tbody tr')).toHaveCount(1);
        await expect(id).toHaveValue(newId);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        const queue = page
          .locator('main section')
          .filter({
            has: page.getByRole('heading', {
              name: t('admin.notifications.deadLetter.title', locale),
              exact: true,
            }),
          })
          .last();
        await queue.locator('tbody summary').click();
        await queue.getByRole('button', { name: word('title'), exact: true }).click();
        await expect(dialog.locator('tbody tr')).toHaveCount(25);
        await expect(dialog.getByRole('textbox')).toHaveCount(0);
        expect(params(page).get('history_mode')).toBe('target');
        expect(params(page).get('history_notificationId')).toBe(deadLetter.outboxId);
        expect(params(page).get('history_channel')).toBe('email');
        expect(params(page).has('history_status')).toBe(false);
        await page.reload();
        await expect(dialog.locator('tbody tr')).toHaveCount(25);
        await expect(dialog.getByRole('textbox')).toHaveCount(0);
        expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
          notificationId: deadLetter.outboxId,
          channel: 'email',
          limit: '26',
          offset: '0',
        });
        await inspect(page, locale, info.project.name, `history-${path}`, dark);
        denied = true;
        await page
          .getByRole('button', { name: common('refresh'), exact: true, includeHidden: true })
          .last()
          .evaluate((node) => (node as HTMLButtonElement).click());
        await expect(dialog).toHaveCount(0);
      });
    }
  }

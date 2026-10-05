import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';
import { formatBrowserDate } from './browser-date';
import { failedJob, deadLetter } from '../src/test/operational-queue-fixtures';

for (const locale of ['en', 'fa'] as const) {
  for (const kind of ['jobs', 'notifications'] as const) {
    test(`${kind} cards share details, selection and responsive command focus (${locale})`, async ({
      page,
    }, info) => {
      const prefix = kind === 'jobs' ? 'admin.jobs' : 'admin.notifications.deadLetter';
      const word = (key: string) => t(`${prefix}.${key}`, locale);
      const common = (key: string) => t(`admin.jobs.${key}`, locale);
      const endpoint = `/api/admin/failed-${kind}`;
      const row =
        kind === 'jobs'
          ? { ...failedJob, error: 'قطع ارتباط با سرویس آزمایشی' }
          : {
              ...deadLetter,
              cause: 'قطع ارتباط با سرویس آزمایشی',
              data: { token: '***', reference: 'synthetic-record' },
            };
      let status = 200,
        reads = 0,
        writes = 0,
        historyReads = 0;
      await crmShell(page, locale);
      await mockOppositeNumerals(page, locale);
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      await page.route(`**${endpoint}/access`, (route) =>
        route.fulfill({ json: { canView: true, canRetry: true } })
      );
      await page.route(`**${endpoint}?*`, (route) => {
        reads++;
        return route.fulfill({ status, json: [row] });
      });
      await page.route(`**${endpoint}/*/retry`, (route) => {
        writes++;
        return route.fulfill({ status: 500, json: {} });
      });
      await page.route('**/api/admin/notifications/delivery-logs?*', (route) => {
        historyReads++;
        return route.fulfill({ json: [] });
      });
      await page.goto(`/admin/failed-${kind}`);
      await page.setViewportSize({ width: 390, height: 844 });
      const cards = page.getByRole('list', { name: word('title'), exact: true });
      const card = cards.locator(':scope > li').first();
      await expect(card).toContainText('قطع ارتباط با سرویس آزمایشی');
      if (kind === 'jobs') await expect(card).toContainText(word('errorMessage'));
      await expect(card).toContainText(
        locale === 'fa' ? (kind === 'jobs' ? '5 / 5' : '5/5') : kind === 'jobs' ? '۵ / ۵' : '۵/۵'
      );
      const stamp = kind === 'jobs' ? failedJob.lastRunAt : deadLetter.createdAt;
      await expect(card.locator('time').last()).toHaveAttribute(
        'datetime',
        new Date(stamp).toISOString()
      );
      await expect(card.locator('time').last()).toContainText(
        await formatBrowserDate(
          page,
          locale,
          { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' },
          stamp
        )
      );
      const details = card.locator('details');
      await card.locator('summary').focus();
      await page.keyboard.press('Space');
      await expect(details).toHaveAttribute('open', '');
      if (kind === 'jobs') await card.getByRole('checkbox').check();
      else {
        await expect(details.locator('pre')).toContainText('***');
        await expect(details).toContainText('ab...yz');
      }
      await page.setViewportSize({ width: 900, height: 900 });
      const desktop = page.getByRole('table', { name: word('title'), exact: true });
      const record = desktop.locator('tbody tr').first();
      await expect(record.getByRole('rowheader')).toBeVisible();
      await expect(record.locator('details')).toHaveAttribute('open', '');
      if (kind === 'jobs') await expect(record.getByRole('checkbox')).toBeChecked();
      expect(reads).toBe(1);
      const viewport = page.getByRole('region', { name: word('table'), exact: true });
      await viewport.focus();
      await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect
        .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
        .toBeGreaterThan(0);
      expect(
        await desktop.locator('thead').evaluate((node) => getComputedStyle(node).position)
      ).toBe('sticky');
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      const retryName = kind === 'jobs' ? word('retry') : `${word('retry')} ${deadLetter.eventKey}`;
      await record.getByRole('button', { name: retryName, exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole('dialog')
        .getByRole('button', { name: appText('team.cancel', locale), exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const refresh = page.getByRole('button', { name: common('refresh'), exact: true });
      await expect(refresh).toBeFocused();
      await expect(details).toHaveAttribute('open', '');
      if (kind === 'jobs') await expect(card.getByRole('checkbox')).toBeChecked();
      else {
        await details
          .getByRole('button', {
            name: t('admin.notifications.history.title', locale),
            exact: true,
          })
          .click();
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await page.setViewportSize({ width: 900, height: 900 });
        await expect(page.getByRole('dialog')).toHaveCount(1);
        expect(historyReads).toBe(1);
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 390, height: 844 });
      }
      status = 503;
      await refresh.click();
      await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
      await expect(details).toHaveAttribute('open', '');
      await expect(card.getByRole('button', { name: retryName, exact: true })).toBeDisabled();
      if (kind === 'jobs') await expect(card.getByRole('checkbox')).toBeChecked();
      status = 200;
      await page.getByRole('button', { name: common('reload'), exact: true }).click();
      await expect(card.getByRole('button', { name: retryName, exact: true })).toBeEnabled();
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && info.project.name === 'mobile-safari')
        await card.screenshot({
          path: `/Users/majid/.local/state/barghsa-manual-batches/operational-queue-tables/${kind}-card-fa.png`,
        });
      status = 403;
      await refresh.click();
      await expect(cards).toHaveCount(0);
      await expect(
        page.getByRole('table', { name: word('title'), includeHidden: true })
      ).toHaveCount(0);
      await expect(page.getByRole('main').getByText('قطع ارتباط با سرویس آزمایشی')).toHaveCount(0);
      expect(writes).toBe(0);
    });
  }
}

import {
  openHistoryFilters,
  applyHistoryFilters,
  closeHistoryFilters,
  verifyHistoryFilterChips,
  verifyHistoryFilterReset,
} from './history-filter-reset';
import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { dateRangePreset } from '@barghsa/ui';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';

const receipt = '71000000-0000-4000-8000-000000000001';
const older = '71000000-0000-4000-8000-000000000002';
const invoice = '71000000-0000-4000-8000-000000000003';
const amount = '9007199254740993';
const beforeAt = '2026-09-01T00:00:00.000001Z';
for (const locale of ['en', 'fa'] as const)
  for (const darkMode of [false, true]) {
    test(`receipt selections, cursor and views survive navigation (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      const copy = (key: string) => t(`invoices.receipts.${key}`, locale);
      const state = (key: string) => t(`invoices.activity.state.${key}`, locale);
      await page.addInitScript(
        ({ locale, darkMode }) => {
          localStorage.setItem('barghsa.locale', locale);
          const apply = () => {
            if (!document.documentElement) return;
            if (document.documentElement.lang !== locale) document.documentElement.lang = locale;
            if (document.documentElement.classList.contains('dark') !== darkMode)
              document.documentElement.classList.toggle('dark', darkMode);
          };
          apply();
          new MutationObserver(apply).observe(document, {
            childList: true,
            attributes: true,
            attributeFilter: ['lang', 'class'],
            subtree: true,
          });
        },
        { locale, darkMode }
      );
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'receipt-customer',
            isStaff: false,
            operatingContext: 'customer',
            requiresTosAcceptance: false,
          },
        })
      );
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          json: {
            activeProfileId: invoice,
            profiles: [
              {
                id: invoice,
                profileType: 'INDIVIDUAL',
                firstName: 'Test',
                lastName: 'Customer',
                status: 'ACTIVE',
              },
            ],
          },
        })
      );
      await page.route('**/api/profiles/verification-status', (route) =>
        route.fulfill({ json: { activeProfileId: invoice } })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      const requests: URLSearchParams[] = [];
      const row = (receiptId: string, state: string) => ({
        receiptId,
        invoiceId: invoice,
        amount,
        state,
        bankName: 'Bank Mellat',
        paymentDate: '2026-09-01',
        submittedAt: '2026-09-01T20:30:00Z',
      });
      let failFilteredMore = true;
      await page.route('**/api/invoices/bank-receipts**', (route) => {
        const query = new URL(route.request().url()).searchParams;
        requests.push(query);
        const filtered = query.has('statuses');
        if (query.has('q') && query.has('beforeId') && failFilteredMore) {
          failFilteredMore = false;
          return route.fulfill({ status: 503, json: {} });
        }
        return route.fulfill({
          json: {
            items: [
              row(query.has('beforeId') ? older : receipt, filtered ? 'Rejected' : 'Submitted'),
            ],
            nextCursor:
              query.has('beforeId') || (filtered && !query.has('q'))
                ? null
                : { beforeAt, beforeId: receipt },
          },
        });
      });
      await page.goto('/invoices/receipts');
      const main = page.getByRole('main');
      const detail = (id: string) =>
        main.locator(`a[href="/invoices/${invoice}#bank-receipt-${id}"]`);
      await expect(detail(receipt)).toBeVisible();
      await page.getByRole('button', { name: copy('older'), exact: true }).click();
      await expect(detail(older)).toBeVisible();
      expect(requests.at(-1)?.get('beforeAt')).toBe(beforeAt);
      expect(requests.at(-1)?.get('beforeId')).toBe(receipt);
      const tableButton = page.getByRole('button', {
        name: t('historyView.table', locale),
        exact: true,
      });
      const cardButton = page.getByRole('button', {
        name: t('historyView.card', locale),
        exact: true,
      });
      const count = requests.length;
      await tableButton.click();
      const table = page.getByRole('table', { name: copy('title'), exact: true });
      await expect(table.getByRole('columnheader')).toHaveCount(7);
      await expect(table.getByText(formatCurrencyIrr(amount, locale), { exact: true })).toHaveCount(
        2
      );
      await expect(table.locator('time[datetime="2026-09-01"]').first()).toHaveText(
        new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', {
          dateStyle: 'medium',
          timeZone: 'UTC',
        }).format(new Date('2026-09-01T00:00:00Z'))
      );
      await cardButton.click();
      await expect(detail(older)).toBeVisible();
      expect(requests.length).toBe(count);
      await page.setViewportSize({ width: 390, height: 844 });
      await openHistoryFilters(page, locale);
      const input = page.getByRole('combobox', { name: copy('filter'), exact: true });
      await input.fill('zzzzz');
      await expect(page.getByText(copy('empty'), { exact: true })).toBeVisible();
      await openHistoryFilters(page, locale);
      await input.fill(state('Rejected'));
      await input.press('ArrowDown');
      await input.press('Enter');
      await input.press('Escape');
      await applyHistoryFilters(page, locale);
      await expect.poll(() => requests.at(-1)?.get('statuses')).toBe('Rejected');
      await expect(detail(older)).toHaveCount(0);
      expect(requests.at(-1)?.has('beforeId')).toBe(false);
      await openHistoryFilters(page, locale);
      await input.fill(state('Submitted'));
      await page.getByRole('option', { name: state('Submitted'), exact: true }).click();
      await input.press('Escape');
      await applyHistoryFilters(page, locale);
      await expect.poll(() => requests.at(-1)?.get('statuses')).toBe('Submitted,Rejected');
      expect(defaultParseSearch(new URL(page.url()).search)['statuses']).toBe('Submitted,Rejected');
      await page.reload();
      await expect(cardButton).toHaveAttribute('aria-pressed', 'true');
      await expect(
        page.getByRole('button', {
          name: t('historyFilters.remove', locale).replace('{filter}', state('Submitted')),
          exact: true,
        })
      ).toBeVisible();
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({
        path: `/tmp/barghsa-bank-receipts-${locale}-${test.info().project.name}.png`,
      });
      await page
        .getByRole('button', { name: t('historyFilters.clearAll', locale), exact: true })
        .click();
      await expect.poll(() => requests.at(-1)?.has('statuses')).toBe(false);
      await page.goBack();
      await expect.poll(() => requests.at(-1)?.get('statuses')).toBe('Submitted,Rejected');
      await page
        .getByRole('button', {
          name: t('historyFilters.remove', locale).replace('{filter}', state('Submitted')),
          exact: true,
        })
        .click();
      await expect.poll(() => requests.at(-1)?.get('statuses')).toBe('Rejected');
      await openHistoryFilters(page, locale);
      await input.fill(state('Rejected'));
      await page.getByRole('option', { name: state('Rejected'), exact: true }).click();
      await input.press('Escape');
      await applyHistoryFilters(page, locale);
      await expect.poll(() => requests.at(-1)?.has('statuses')).toBe(false);
      await page.goto('/invoices/receipts?state=Rejected');
      await expect.poll(() => requests.at(-1)?.get('statuses')).toBe('Rejected');
      const full = new URLSearchParams({
        q: 'Bank_%',
        sort: 'submitted_at:asc',
        statuses: 'Submitted,Rejected',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
        min: amount,
        max: '9007199254740994',
      });
      await page.goto(`/invoices/receipts${defaultStringifySearch(Object.fromEntries(full))}`);
      await expect(detail(receipt)).toBeVisible();
      await expect.poll(() => requests.at(-1)?.get('q')).toBe('Bank_%');
      for (const [key, value] of full) expect(requests.at(-1)?.get(key)).toBe(value);
      await page.getByRole('button', { name: copy('newer'), exact: true }).click();
      await expect(main.getByRole('alert')).toContainText(copy('moreError'));
      await expect(detail(receipt)).toBeVisible();
      await main.getByRole('button', { name: copy('retry'), exact: true }).click();
      await expect(detail(older)).toBeVisible();
      expect(requests.at(-1)?.get('beforeAt')).toBe(beforeAt);
      expect(requests.at(-1)?.get('sort')).toBe('submitted_at:asc');
      await page.reload();
      await expect(detail(receipt)).toBeVisible();
      await expect(detail(older)).toHaveCount(0);
      const initialUrl = page.url();
      const countBefore = requests.length;
      await openHistoryFilters(page, locale);
      const search = page.getByRole('searchbox', {
        name: t('historySearch.label', locale),
        exact: true,
      });
      await expect(search).toHaveValue('Bank_%');
      await search.fill('discard this draft');
      await closeHistoryFilters(page, locale);
      await openHistoryFilters(page, locale);
      await expect(search).toHaveValue('Bank_%');
      expect(requests.length).toBe(countBefore);
      const sort = page.getByRole('combobox', {
        name: t('historySearch.sort', locale),
        exact: true,
      });
      await expect(sort).toHaveValue('submitted_at:asc');
      await sort.selectOption('submitted_at:desc');
      const lower = page.getByRole('textbox', {
        name: t('invoices.filter.min', locale),
        exact: true,
      });
      await expect(lower).toHaveValue(amount);
      await lower.fill(locale === 'fa' ? '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۴' : '9007199254740994');
      await page
        .locator('summary')
        .filter({ hasText: copy('submittedAt') })
        .click();
      await page
        .getByRole('combobox', { name: t('historyDates.preset', locale), exact: true })
        .selectOption('thisMonth');
      const range = dateRangePreset(
        'thisMonth',
        locale,
        'Asia/Tehran',
        new Date(await page.evaluate(() => Date.now()))
      );
      await search.fill('  Updated_%  ');
      await applyHistoryFilters(page, locale);
      await expect.poll(() => requests.at(-1)?.get('q')).toBe('Updated_%');
      expect(requests.length).toBe(countBefore + 1);
      expect(requests.at(-1)?.has('sort')).toBe(false);
      expect(requests.at(-1)?.get('min')).toBe('9007199254740994');
      expect(requests.at(-1)?.get('max')).toBe('9007199254740994');
      expect(requests.at(-1)?.get('from')).toBe(range.from);
      expect(requests.at(-1)?.get('to')).toBe(range.to);
      expect(requests.at(-1)?.has('beforeId')).toBe(false);
      await page.goBack();
      await expect(page).toHaveURL(initialUrl);
      await expect.poll(() => requests.at(-1)?.get('q')).toBe('Bank_%');
      await verifyHistoryFilterChips(page, locale, requests, copy('submittedAt'));
      await verifyHistoryFilterReset(page, locale, requests, 4);
      await closeHistoryFilters(page, locale);
      await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*dark)/);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({
        path: `/tmp/barghsa-receipt-query-${locale}-${darkMode}-${test.info().project.name}.png`,
      });
    });
  }

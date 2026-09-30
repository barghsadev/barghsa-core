import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { defaultParseSearch } from '@tanstack/react-router';

const receipt = '71000000-0000-4000-8000-000000000001';
const older = '71000000-0000-4000-8000-000000000002';
const invoice = '71000000-0000-4000-8000-000000000003';
const amount = '9007199254740993';
const beforeAt = '2026-09-01T00:00:00.000001Z';
for (const locale of ['en', 'fa'] as const) {
  test(`receipt selections, cursor and views survive navigation (${locale})`, async ({ page }) => {
    const copy = (key: string) => t(`invoices.receipts.${key}`, locale);
    const state = (key: string) => t(`invoices.activity.state.${key}`, locale);
    await page.addInitScript((locale) => localStorage.setItem('barghsa.locale', locale), locale);
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
    await page.route('**/api/invoices/bank-receipts**', (route) => {
      const query = new URL(route.request().url()).searchParams;
      requests.push(query);
      const filtered = query.has('statuses');
      return route.fulfill({
        json: {
          items: [
            row(query.has('beforeId') ? older : receipt, filtered ? 'Rejected' : 'Submitted'),
          ],
          nextCursor: query.has('beforeId') || filtered ? null : { beforeAt, beforeId: receipt },
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
    const input = page.getByRole('combobox', { name: copy('filter'), exact: true });
    await input.fill('zzzzz');
    await expect(page.getByText(copy('empty'), { exact: true })).toBeVisible();
    await input.fill(state('Rejected'));
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect.poll(() => requests.at(-1)?.get('statuses')).toBe('Rejected');
    await expect(detail(older)).toHaveCount(0);
    expect(requests.at(-1)?.has('beforeId')).toBe(false);
    await input.fill(state('Submitted'));
    await page.getByRole('option', { name: state('Submitted'), exact: true }).click();
    await expect.poll(() => requests.at(-1)?.get('statuses')).toBe('Submitted,Rejected');
    await input.press('Escape');
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
    await input.fill(state('Rejected'));
    await page.getByRole('option', { name: state('Rejected'), exact: true }).click();
    await expect.poll(() => requests.at(-1)?.has('statuses')).toBe(false);
    await input.press('Escape');
    await page.goto('/invoices/receipts?state=Rejected');
    await expect.poll(() => requests.at(-1)?.get('statuses')).toBe('Rejected');
  });
}

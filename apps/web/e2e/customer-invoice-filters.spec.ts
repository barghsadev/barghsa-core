import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { dateRangePreset } from '@barghsa/ui';
import type { Route } from '@playwright/test';

const first = '30000000-0000-4000-8000-000000000001';
const older = '30000000-0000-4000-8000-000000000002';
const filtered = '30000000-0000-4000-8000-000000000003';
const searched = '30000000-0000-4000-8000-000000000004';

for (const locale of ['en', 'fa'] as const) {
  test(`invoice filters preserve exact amounts and reset pages (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'invoice-customer',
          isStaff: false,
          operatingContext: 'customer',
          canSwitchContext: false,
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          activeProfileId: first,
          profiles: [
            {
              id: first,
              profileType: 'INDIVIDUAL',
              firstName: 'Test',
              lastName: 'Customer',
              status: 'ACTIVE',
            },
          ],
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    const body = (id: string, nextBefore: string | null = null) => ({
      invoices: [
        {
          invoiceId: id,
          role: 'original',
          state: 'Paid',
          totalAmount: '9007199254740993',
          paidAmount: '9007199254740993',
          createdAt: '2026-09-30T09:00:00Z',
          issuedAt: '2026-09-30T09:00:00Z',
          dueAt: null,
          explanation: null,
        },
      ],
      nextBefore,
    });
    const queries: URLSearchParams[] = [];
    let held: Route | undefined;
    let fail = false;
    await page.route(/\/api\/invoices(?:\?|$)/, (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(query);
      if (fail) return route.fulfill({ status: 503, json: {} });
      if (query.get('min') && !query.has('statuses')) {
        held = route;
        return;
      }
      return route.fulfill({
        json: query.get('q')
          ? body(searched)
          : query.has('min') || query.has('statuses') || query.has('from') || query.has('sort')
            ? body(filtered)
            : query.has('before')
              ? body(older)
              : body(first, first),
      });
    });
    const copy = (key: string) => t(`invoices.filter.${key}`, locale);
    const link = (id: string) => page.getByRole('main').locator(`a[href="/invoices/${id}"]`);
    await page.goto('/invoices?status=unpaid');
    await expect(link(first)).toBeVisible();
    await page.getByRole('button', { name: copy('more'), exact: true }).click();
    await expect(link(older)).toBeVisible();
    await expect(link(first)).toBeVisible();
    expect(queries.at(-1)?.get('before')).toBe(first);

    const min = page.getByRole('textbox', { name: copy('min'), exact: true });
    const max = page.getByRole('textbox', { name: copy('max'), exact: true });
    const apply = page.getByRole('button', { name: copy('applyAmount'), exact: true });
    await min.fill('۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳');
    await max.fill('9007199254740992');
    await expect(apply).toBeDisabled();
    await expect(page.getByText(copy('invalidAmount'), { exact: true })).toBeVisible();
    expect(queries.at(-1)?.has('min')).toBe(false);
    await max.fill('٩٢٢٣٣٧٢٠٣٦٨٥٤٧٧٥٨٠٧');
    await apply.click();
    await expect.poll(() => !!held).toBe(true);
    await expect(link(first)).toHaveCount(0);
    await expect(link(older)).toHaveCount(0);
    expect(queries.at(-1)?.get('min')).toBe('9007199254740993');
    expect(queries.at(-1)?.get('max')).toBe('9223372036854775807');
    expect(queries.at(-1)?.get('status')).toBe('unpaid');
    expect(queries.at(-1)?.has('before')).toBe(false);
    await held!.fulfill({ json: body(filtered) });
    await expect(link(filtered)).toBeVisible();
    await page
      .locator('summary')
      .filter({ hasText: copy('state') })
      .click();
    const paid = page.getByRole('checkbox', {
      name: t('invoices.state.Paid', locale),
      exact: true,
    });
    await paid.click();
    await expect(paid).toBeChecked();
    await expect.poll(() => queries.at(-1)?.get('statuses')).toBe('Paid');
    await expect(link(filtered)).toBeVisible();
    await page
      .locator('summary')
      .filter({ hasText: copy('created') })
      .click();
    await page
      .getByRole('combobox', { name: t('historyDates.preset', locale), exact: true })
      .selectOption('today');
    const range = dateRangePreset(
      'today',
      locale,
      'Asia/Tehran',
      new Date(await page.evaluate(() => Date.now()))
    );
    await expect.poll(() => queries.at(-1)?.get('from')).toBe(range.from);
    expect(queries.at(-1)?.get('to')).toBe(range.to);
    const sort = page.getByRole('combobox', { name: t('historySearch.sort', locale), exact: true });
    await sort.selectOption('created_at:asc');
    await expect.poll(() => queries.at(-1)?.get('sort')).toBe('created_at:asc');
    const search = page.getByRole('searchbox', {
      name: t('historySearch.label', locale),
      exact: true,
    });
    await search.fill(searched);
    await expect(link(searched)).toBeVisible();
    await expect(link(filtered)).toHaveCount(0);
    expect(queries.at(-1)?.get('min')).toBe('9007199254740993');
    expect(queries.at(-1)?.get('statuses')).toBe('Paid');
    await page.goBack();
    await expect(search).toHaveValue('');
    await expect(link(filtered)).toBeVisible();
    await page.goForward();
    await expect(search).toHaveValue(searched);
    await expect(link(searched)).toBeVisible();
    await page.reload();
    await expect(link(searched)).toBeVisible();
    await expect(min).toHaveValue('9007199254740993');
    await expect(max).toHaveValue('9223372036854775807');
    await expect(sort).toHaveValue('created_at:asc');
    await page.getByRole('button', { name: copy('clearAmount'), exact: true }).click();
    await expect(page).not.toHaveURL(/min=|max=/);
    await expect.poll(() => queries.at(-1)?.get('q')).toBe(searched);
    expect(queries.at(-1)?.get('statuses')).toBe('Paid');
    expect(queries.at(-1)?.get('from')).toBe(range.from);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);

    fail = true;
    await search.fill('retry');
    await expect(page.getByText(t('invoices.error.load', locale), { exact: true })).toBeVisible();
    fail = false;
    await page
      .getByRole('main')
      .getByRole('button', { name: copy('retry'), exact: true })
      .click();
    await expect(link(searched)).toBeVisible();
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ status: 503, json: {} })
    );
    await page.reload();
    await expect(link(searched)).toBeVisible();
    await page
      .locator('summary')
      .filter({ hasText: copy('created') })
      .click();
    await expect(
      page.getByRole('combobox', { name: t('historyDates.preset', locale), exact: true })
    ).toBeDisabled();
  });
}

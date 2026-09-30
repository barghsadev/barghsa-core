import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import type { Route } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { contractText } from '@barghsa/i18n/contracts';
import { dateRangePreset } from '@barghsa/ui';

const first = '40000000-0000-4000-8000-000000000001';
const older = '40000000-0000-4000-8000-000000000002';
const filtered = '40000000-0000-4000-8000-000000000003';
const searched = '40000000-0000-4000-8000-000000000004';
const invoice = '40000000-0000-4000-8000-000000000005';

for (const locale of ['en', 'fa'] as const) {
  test(`customer contract filters compose and reset pagination (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'contract-customer',
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
      contracts: [
        {
          id,
          serviceType: 'electricity',
          state: 'Active',
          versionId: first,
          versionNumber: 1,
          publishedAt: '2026-09-30T09:00:00Z',
          initialInvoiceId: invoice,
          initialInvoiceAmount: '9007199254740993',
          initialInvoiceState: 'Paid',
          orderId: first,
        },
      ],
      nextBefore,
    });
    const queries: URLSearchParams[] = [];
    let held: Route | undefined;
    let hold = true;
    let fail = false;
    await page.route(/\/api\/contracts(?:\?|$)/, (route) => {
      const params = new URL(route.request().url()).searchParams;
      queries.push(params);
      if (fail) return route.fulfill({ status: 503, json: {} });
      if (params.get('serviceType') === 'solar' && hold) {
        held = route;
        return;
      }
      return route.fulfill({
        json: params.has('q')
          ? body(searched)
          : params.has('serviceType') ||
              params.has('statuses') ||
              params.has('from') ||
              params.has('sort')
            ? body(filtered)
            : params.has('before')
              ? body(older)
              : body(first, first),
      });
    });
    const copy = (key: string) => t(`contractHistory.${key}`, locale);
    const reference = (id: string) =>
      page
        .getByRole('main')
        .locator('li')
        .filter({ has: page.locator('bdi').getByText(id, { exact: true }) });
    await page.goto('/contracts?state=Active');
    await expect(reference(first)).toBeVisible();
    await page.getByRole('button', { name: contractText('next', locale), exact: true }).click();
    await expect(reference(older)).toBeVisible();
    await expect(reference(first)).toBeVisible();
    const service = page.getByRole('combobox', {
      name: contractText('serviceType', locale),
      exact: true,
    });
    await service.fill('no-such-service');
    await expect(page.getByText(copy('noOptions'), { exact: true })).toBeVisible();
    expect(queries.at(-1)?.has('serviceType')).toBe(false);
    await service.fill(contractText('solar', locale));
    await page.getByRole('option', { name: contractText('solar', locale), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await expect(reference(first)).toHaveCount(0);
    await expect(reference(older)).toHaveCount(0);
    expect(queries.at(-1)?.has('before')).toBe(false);
    expect(queries.at(-1)?.get('state')).toBe('Active');
    hold = false;
    await held!.fulfill({ json: body(filtered) });
    await expect(reference(filtered)).toBeVisible();
    await page
      .locator('summary')
      .filter({ hasText: copy('state') })
      .click();
    const active = page.getByRole('checkbox', {
      name: contractText('Active', locale),
      exact: true,
    });
    await active.click();
    await expect(active).toBeChecked();
    await expect.poll(() => queries.at(-1)?.get('statuses')).toBe('Active');
    await page
      .locator('summary')
      .filter({ hasText: copy('published') })
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
    await sort.selectOption('published_at:asc');
    await expect.poll(() => queries.at(-1)?.get('sort')).toBe('published_at:asc');
    const search = page.getByRole('searchbox', {
      name: t('historySearch.label', locale),
      exact: true,
    });
    await search.fill(searched);
    await expect(reference(searched)).toBeVisible();
    await expect(reference(filtered)).toHaveCount(0);
    expect(queries.at(-1)?.get('serviceType')).toBe('solar');
    expect(queries.at(-1)?.get('statuses')).toBe('Active');
    await expect(reference(searched).locator(`a[href="/invoices/${invoice}"]`)).toBeVisible();
    await expect(
      reference(searched).locator(`a[href="/electricity/orders/${first}"]`)
    ).toBeVisible();
    await page.goBack();
    await expect(search).toHaveValue('');
    await expect(reference(filtered)).toBeVisible();
    await page.goForward();
    await expect(search).toHaveValue(searched);
    await expect(reference(searched)).toBeVisible();
    await page.reload();
    await expect(reference(searched)).toBeVisible();
    await expect(service).toHaveValue(contractText('solar', locale));
    expect(
      (await new AxeBuilder({ page }).include('[data-slot="combobox"]').analyze()).violations
    ).toEqual([]);
    await expect(sort).toHaveValue('published_at:asc');
    await page
      .locator('summary')
      .filter({ hasText: copy('state') })
      .click();
    await expect(active).toBeChecked();
    await page.getByRole('button', { name: copy('clearState'), exact: true }).click();
    await expect(page).not.toHaveURL(/statuses=/);
    await service.fill(contractText('all', locale));
    await page.getByRole('option', { name: contractText('all', locale), exact: true }).click();
    await expect(page).not.toHaveURL(/serviceType=/);
    expect(queries.at(-1)?.get('q')).toBe(searched);
    expect(queries.at(-1)?.get('from')).toBe(range.from);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    fail = true;
    await search.fill('retry');
    await expect(page.getByText(contractText('error', locale), { exact: true })).toBeVisible();
    fail = false;
    await page
      .getByRole('main')
      .getByRole('button', { name: contractText('refresh', locale), exact: true })
      .click();
    await expect(reference(searched)).toBeVisible();
    expect(queries.at(-1)?.has('before')).toBe(false);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ status: 503, json: {} })
    );
    await page.reload();
    await expect(reference(searched)).toBeVisible();
    await page
      .locator('summary')
      .filter({ hasText: copy('published') })
      .click();
    await expect(
      page.getByRole('combobox', { name: t('historyDates.preset', locale), exact: true })
    ).toBeDisabled();
  });
}

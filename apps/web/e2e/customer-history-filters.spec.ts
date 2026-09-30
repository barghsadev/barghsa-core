import { test, expect } from './coverage-fixture';
import type { Route } from '@playwright/test';
import { tSaving } from '@barghsa/i18n/saving';
import { tSolar } from '@barghsa/i18n/solar';
import { tConsultation } from '@barghsa/i18n/consultation';

const profileId = '10000000-0000-4000-8000-000000000001';
const first = '20000000-0000-4000-8000-000000000001';
const older = '20000000-0000-4000-8000-000000000002';
const combined = '20000000-0000-4000-8000-000000000003';
const all = '20000000-0000-4000-8000-000000000004';

for (const locale of ['en', 'fa'] as const) {
  for (const kind of ['saving', 'solar', 'consultation'] as const) {
    test(`${kind} history status filters survive reload and reset pagination (${locale})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'history-customer',
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
            activeProfileId: profileId,
            profiles: [
              {
                id: profileId,
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
      await page.route('**/api/consultations/products?*', (route) =>
        route.fulfill({
          json: { products: [{ id: 'product-1', title: { en: 'Consultation', fa: 'مشاوره' } }] },
        })
      );
      const copy = (key: string) =>
        kind === 'saving'
          ? tSaving(key, locale)
          : kind === 'solar'
            ? tSolar(key, locale)
            : tConsultation(key, locale);
      const initialStatus = kind === 'solar' ? 'approved' : 'completed';
      const routePath =
        kind === 'saving'
          ? '/savings/orders'
          : kind === 'solar'
            ? '/solar/requests'
            : '/consultations';
      const apiPath =
        kind === 'saving'
          ? '/api/saving/orders'
          : kind === 'solar'
            ? '/api/solar/requests'
            : '/api/consultations/requests';
      const detailPath =
        kind === 'saving'
          ? '/savings/orders'
          : kind === 'solar'
            ? '/solar/requests'
            : '/consultations';
      const row = (id: string, status: string) => ({
        id,
        status,
        submitted_at: '2026-09-30T09:00:00Z',
        plan_title: { en: 'Saving plan', fa: 'طرح صرفه‌جویی' },
        hardware_title: { en: 'Device', fa: 'تجهیز' },
        total_amount: '10000',
        bill_identifier: '12345678',
        financial_status: 'paid',
        invoice_id: null,
        contract_id: null,
        building_type: 'non_household',
        grid_type: 'off_grid',
        product_snapshot: { title: { en: 'Consultation', fa: 'مشاوره' } },
        staff_owner_username: null,
        staff_team: null,
      });
      const body = (id: string, status: string, nextBefore: string | null = null) => ({
        [kind === 'saving' ? 'orders' : 'requests']: [row(id, status)],
        nextBefore,
      });
      const queries: URLSearchParams[] = [];
      let held: Route | undefined;
      let holdCombined = true;
      await page.route(`**${apiPath}?*`, (route) => {
        const query = new URL(route.request().url()).searchParams;
        queries.push(query);
        if (query.get('statuses') === `submitted,${initialStatus}` && holdCombined) {
          held = route;
          return;
        }
        if (!query.get('statuses')) return route.fulfill({ json: body(all, 'submitted') });
        if (query.get('statuses') === initialStatus)
          return route.fulfill({
            json: query.has('before')
              ? body(older, initialStatus)
              : body(first, initialStatus, first),
          });
        return route.fulfill({ json: body(combined, 'submitted') });
      });
      const link = (id: string) => page.getByRole('main').locator(`a[href="${detailPath}/${id}"]`);
      await page.goto(`${routePath}?statuses=${initialStatus}`);
      await expect(link(first)).toBeVisible();
      if (kind === 'consultation') await page.getByRole('radio').check();
      await page
        .getByRole('button', {
          name: copy(kind === 'saving' ? 'moreOrders' : 'moreRequests'),
          exact: true,
        })
        .click();
      await expect(link(older)).toBeVisible();
      await expect(link(first)).toBeVisible();
      await page
        .locator('summary')
        .filter({ hasText: copy('filterStatus') })
        .click();
      const submittedCheckbox = page.getByRole('checkbox', {
        name: copy(kind === 'saving' ? 'submitted' : 'status_submitted'),
        exact: true,
      });
      await submittedCheckbox.click();
      await expect(submittedCheckbox).toBeChecked();
      await expect.poll(() => Boolean(held)).toBe(true);
      expect(queries.at(-1)?.has('before')).toBe(false);
      await expect(link(first)).toHaveCount(0);
      await expect(link(older)).toHaveCount(0);
      await held!.fulfill({ json: body(combined, 'submitted') });
      holdCombined = false;
      await expect(link(combined)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`statuses=submitted%2C${initialStatus}`));
      if (kind === 'consultation') await expect(page.getByRole('radio')).toBeChecked();
      await page.reload();
      await expect(link(combined)).toBeVisible();
      await page
        .locator('summary')
        .filter({ hasText: copy('filterStatus') })
        .click();
      await expect(
        page.getByRole('checkbox', {
          name: copy(kind === 'saving' ? 'submitted' : 'status_submitted'),
          exact: true,
        })
      ).toBeChecked();
      await page.getByRole('button', { name: copy('clearFilters'), exact: true }).click();
      await expect(link(all)).toBeVisible();
      await expect(page).not.toHaveURL(/statuses=/);
      await expect(
        page.getByRole('button', { name: copy('clearFilters'), exact: true })
      ).toHaveCount(0);
      await page.goBack();
      await expect(link(combined)).toBeVisible();
      expect(queries.at(-1)?.has('before')).toBe(false);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
    });
  }
}

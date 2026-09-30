import {
  verifyHistoryFilterReset,
  verifyHistoryFilterChips,
  openHistoryFilters,
  closeHistoryFilters,
  applyHistoryFilters,
} from './history-filter-reset';
import { test, expect } from './coverage-fixture';
import type { Route } from '@playwright/test';
import { tSaving } from '@barghsa/i18n/saving';
import { tSolar } from '@barghsa/i18n/solar';
import { t } from '@barghsa/i18n/app';
import { dateRangePreset } from '@barghsa/ui';
import { tConsultation } from '@barghsa/i18n/consultation';

const profileId = '10000000-0000-4000-8000-000000000001';
const first = '20000000-0000-4000-8000-000000000001';
const older = '20000000-0000-4000-8000-000000000002';
const combined = '20000000-0000-4000-8000-000000000003';
const dated = '20000000-0000-4000-8000-000000000005';
const all = '20000000-0000-4000-8000-000000000004';
const searched = '20000000-0000-4000-8000-000000000006';
const sorted = '20000000-0000-4000-8000-000000000007';

for (const locale of ['en', 'fa'] as const) {
  for (const kind of ['saving', 'solar', 'consultation', 'electricity'] as const) {
    test(`${kind} history filters and sorting survive reload and reset pagination (${locale})`, async ({
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
      await page.route('**/api/profiles/verification-status', (route) =>
        route.fulfill({ json: { activeProfileId: profileId } })
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
        kind === 'electricity'
          ? t(
              key === 'status_submitted'
                ? 'electricity.order.status.submitted'
                : `electricity.orders.${key === 'moreRequests' ? 'more' : key}`,
              locale
            )
          : kind === 'saving'
            ? tSaving(key, locale)
            : kind === 'solar'
              ? tSolar(key, locale)
              : tConsultation(key, locale);
      const initialStatus = kind === 'solar' ? 'approved' : 'completed';
      const routePath = {
        saving: '/savings/orders',
        solar: '/solar/requests',
        consultation: '/consultations',
        electricity: '/electricity/orders',
      }[kind];
      const apiPath = {
        saving: '/api/saving/orders',
        solar: '/api/solar/requests',
        consultation: '/api/consultations/requests',
        electricity: '/api/electricity/orders',
      }[kind];
      const detailPath = routePath;
      const searchText = kind === 'electricity' ? searched : 'مشاوره';
      const row = (id: string, status: string) => ({
        id,
        status,
        orderId: id,
        electricityStatus: status,
        financialStatus: 'paid',
        nextAction: 'await_review',
        submittedAt: '2026-09-30T09:00:00Z',
        periodStart: '2026-09-30T09:00:00Z',
        periodEnd: '2026-10-30T09:00:00Z',
        totalKwh: '10',
        totalIrR: '10000',
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
        [kind === 'saving' || kind === 'electricity' ? 'orders' : 'requests']: [row(id, status)],
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
        if (query.get('q')) return route.fulfill({ json: body(searched, 'submitted') });
        if (query.get('sort') === 'submitted_at:asc')
          return route.fulfill({ json: body(sorted, 'submitted', sorted) });
        if (query.get('from') || query.get('to'))
          return route.fulfill({ json: body(dated, 'submitted') });
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
      const initialUrl = page.url();
      const requestsBefore = queries.length;
      await openHistoryFilters(page, locale);
      const search = page.getByRole('searchbox', {
        name: t('historySearch.label', locale),
        exact: true,
      });
      await search.fill('cancel this draft');
      await closeHistoryFilters(page, locale);
      await openHistoryFilters(page, locale);
      await expect(search).toHaveValue('');
      await page
        .locator('summary')
        .filter({ hasText: copy('filterStatus') })
        .click();
      await page
        .getByRole('checkbox', {
          name: copy(kind === 'saving' ? 'submitted' : 'status_submitted'),
          exact: true,
        })
        .click();
      await page
        .locator('summary')
        .filter({ hasText: t('historyDates.label', locale) })
        .click();
      const preset = page.getByRole('combobox', {
        name: t('historyDates.preset', locale),
        exact: true,
      });
      await preset.selectOption('thisMonth');
      const range = dateRangePreset(
        'thisMonth',
        locale,
        'Asia/Tehran',
        new Date(await page.evaluate(() => Date.now()))
      );
      if (kind === 'saving') {
        await preset.selectOption('custom');
        const selectDay = async (bound: 'start' | 'end', day: number) => {
          const label = t(`historyDates.${bound}`, locale);
          await page.getByRole('combobox', { name: label, exact: true }).click();
          const calendar = page.getByRole('dialog', { name: label, exact: true });
          const parts = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
            timeZone: 'Asia/Tehran',
            month: 'long',
            year: 'numeric',
            calendar: locale === 'fa' ? 'persian' : 'gregory',
          }).formatToParts(new Date(range.from!));
          const part = (type: string) => parts.find((value) => value.type === type)!.value;
          await calendar
            .getByRole('button', {
              name: new RegExp(
                locale === 'fa'
                  ? ` ${day === 1 ? '۱' : '۲'}-ام ${part('month')} ${part('year')}`
                  : `${part('month')} ${day === 1 ? '1st' : '2nd'}, ${part('year')}`
              ),
            })
            .click();
          await expect(calendar).toBeHidden();
        };
        await selectDay('end', 1);
        await selectDay('start', 2);
        await page
          .getByRole('button', { name: t('historyFilters.apply', locale), exact: true })
          .click();
        await expect(
          page.getByText(t('historyDates.invalid', locale), { exact: true })
        ).toBeVisible();
        await expect(page).toHaveURL(initialUrl);
        expect(queries.length).toBe(requestsBefore);
        await selectDay('start', 1);
        // Return to the month preset so the combined transaction checks a known range.
        await preset.selectOption('thisMonth');
      }
      const sort = page.getByRole('combobox', {
        name: t('historySearch.sort', locale),
        exact: true,
      });
      await sort.selectOption('submitted_at:asc');
      await search.fill(searchText);
      await expect(page).toHaveURL(initialUrl);
      expect(queries.length).toBe(requestsBefore);
      await applyHistoryFilters(page, locale);
      await expect.poll(() => Boolean(held)).toBe(true);
      expect(queries.length).toBe(requestsBefore + 1);
      expect(queries.at(-1)?.has('before')).toBe(false);
      expect(queries.at(-1)?.get('q')).toBe(searchText);
      expect(queries.at(-1)?.get('sort')).toBe('submitted_at:asc');
      expect(queries.at(-1)?.get('from')).toBe(range.from);
      expect(queries.at(-1)?.get('to')).toBe(range.to);
      await expect(link(first)).toHaveCount(0);
      await expect(link(older)).toHaveCount(0);
      await held!.fulfill({ json: body(searched, 'submitted') });
      holdCombined = false;
      await expect(link(searched)).toBeVisible();
      if (kind === 'consultation') await expect(page.getByRole('radio')).toBeChecked();
      await page.goBack();
      await expect(page).toHaveURL(initialUrl);
      await expect(link(first)).toBeVisible();
      await page.goForward();
      await expect(link(searched)).toBeVisible();
      await page.reload();
      await expect(link(searched)).toBeVisible();
      await openHistoryFilters(page, locale);
      await expect(search).toHaveValue(searchText);
      await expect(sort).toHaveValue('submitted_at:asc');
      await closeHistoryFilters(page, locale);
      if (kind === 'consultation') await page.getByRole('radio').check();
      await verifyHistoryFilterChips(page, locale, queries);
      await verifyHistoryFilterReset(page, locale, queries, 3);
      await closeHistoryFilters(page, locale);
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ status: 503, json: {} })
      );
      await page.reload();
      await expect(link(searched)).toBeVisible();
      await openHistoryFilters(page, locale);
      await page
        .locator('summary')
        .filter({ hasText: t('historyDates.label', locale) })
        .click();
      await expect(preset).toBeDisabled();
      await page.screenshot({
        path: `/tmp/barghsa-filter-drawer-${kind}-${locale}-${test.info().project.name}.png`,
      });
    });
  }
}

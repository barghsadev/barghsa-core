import { verifyHistoryFilterReset } from './history-filter-reset';
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
      if (kind === 'consultation') await page.getByRole('radio').check();
      const dateCopy = (key: string) => t(`historyDates.${key}`, locale);
      await page
        .locator('summary')
        .filter({ hasText: dateCopy('label') })
        .click();
      const preset = page.getByRole('combobox', { name: dateCopy('preset'), exact: true });
      const now = new Date(await page.evaluate(() => Date.now()));
      const ranges = Object.fromEntries(
        (['today', 'last7', 'thisMonth', 'lastMonth'] as const).map((name) => {
          const range = dateRangePreset(name, locale, 'Asia/Tehran', now);
          return [name, [range.from!, range.to!]];
        })
      );
      for (const [name, [from, to]] of Object.entries(ranges)) {
        await preset.selectOption(name);
        await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe(from);
        await expect.poll(() => queries.at(-1)?.get('from')).toBe(from);
        expect(queries.at(-1)?.get('to')).toBe(to);
        expect(queries.at(-1)?.get('statuses')).toBe(`submitted,${initialStatus}`);
        expect(queries.at(-1)?.has('before')).toBe(false);
        await expect(link(dated)).toBeVisible();
      }
      // Custom edits stay local until Apply; an inclusive end day becomes an excluded next midnight.
      await preset.selectOption('thisMonth');
      const monthStart = ranges['thisMonth']![0]!;
      await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe(monthStart);
      await preset.selectOption('custom');
      const endPicker = page.getByRole('combobox', { name: dateCopy('end'), exact: true });
      await endPicker.click();
      const calendar = page.getByRole('dialog', { name: dateCopy('end'), exact: true });
      await expect(calendar).toBeVisible();
      const dateParts = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
        timeZone: 'Asia/Tehran',
        month: 'long',
        year: 'numeric',
        calendar: locale === 'fa' ? 'persian' : 'gregory',
      }).formatToParts(new Date(monthStart));
      const part = (type: string) => dateParts.find((item) => item.type === type)!.value;
      await calendar
        .getByRole('button', {
          name: new RegExp(
            locale === 'fa'
              ? ` ۱-ام ${part('month')} ${part('year')}`
              : `${part('month')} 1st, ${part('year')}`
          ),
        })
        .click();
      const customEnd = new Date(
        new Date(monthStart).getTime() + 24 * 60 * 60 * 1000
      ).toISOString();
      await expect(calendar).toBeHidden();
      const startPicker = page.getByRole('combobox', { name: dateCopy('start'), exact: true });
      await startPicker.click();
      const startCalendar = page.getByRole('dialog', { name: dateCopy('start'), exact: true });
      await startCalendar
        .getByRole('button', {
          name: new RegExp(
            locale === 'fa'
              ? ` ۲-ام ${part('month')} ${part('year')}`
              : `${part('month')} 2nd, ${part('year')}`
          ),
        })
        .click();
      await expect(
        page.getByRole('button', { name: dateCopy('apply'), exact: true })
      ).toBeDisabled();
      await expect(page.getByText(dateCopy('invalid'), { exact: true })).toBeVisible();
      expect(new URL(page.url()).searchParams.get('to')).toBe(ranges['thisMonth']![1]);
      await startPicker.click();
      await startCalendar
        .getByRole('button', {
          name: new RegExp(
            locale === 'fa'
              ? ` ۱-ام ${part('month')} ${part('year')}`
              : `${part('month')} 1st, ${part('year')}`
          ),
        })
        .click();
      await page.getByRole('button', { name: dateCopy('apply'), exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('to')).toBe(customEnd);
      await expect(link(dated)).toBeVisible();
      if (kind === 'consultation') await expect(page.getByRole('radio')).toBeChecked();
      const search = page.getByRole('searchbox', {
        name: t('historySearch.label', locale),
        exact: true,
      });
      const sort = page.getByRole('combobox', {
        name: t('historySearch.sort', locale),
        exact: true,
      });
      await sort.selectOption('submitted_at:asc');
      await expect(link(sorted)).toBeVisible();
      await page
        .getByRole('button', {
          name: copy(kind === 'saving' ? 'moreOrders' : 'moreRequests'),
          exact: true,
        })
        .click();
      await expect.poll(() => queries.at(-1)?.get('before')).toBe(sorted);
      await search.fill(searchText);
      await expect(link(searched)).toBeVisible();
      await expect(link(sorted)).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(searchText);
      expect(queries.at(-1)?.get('q')).toBe(searchText);
      expect(queries.at(-1)?.get('sort')).toBe('submitted_at:asc');
      expect(queries.at(-1)?.get('statuses')).toBe(`submitted,${initialStatus}`);
      expect(queries.at(-1)?.get('to')).toBe(customEnd);
      expect(queries.at(-1)?.has('before')).toBe(false);
      if (kind === 'consultation') await expect(page.getByRole('radio')).toBeChecked();
      await page.goBack();
      await expect(search).toHaveValue('');
      await expect(link(sorted)).toBeVisible();
      await page.goForward();
      await expect(search).toHaveValue(searchText);
      await expect(link(searched)).toBeVisible();
      await page.reload();
      await expect(link(searched)).toBeVisible();
      await expect(search).toHaveValue(searchText);
      await expect(sort).toHaveValue('submitted_at:asc');
      if (kind === 'consultation') await page.getByRole('radio').check();
      await verifyHistoryFilterReset(page, locale, queries, 3);
      if (kind === 'consultation') await expect(page.getByRole('radio')).toBeChecked();
      await page
        .locator('summary')
        .filter({ hasText: copy('filterStatus') })
        .click();
      await page.getByRole('button', { name: copy('clearFilters'), exact: true }).click();
      await expect(page).not.toHaveURL(/statuses=/);
      await expect.poll(() => queries.at(-1)?.get('statuses')).toBeNull();
      expect(queries.at(-1)?.get('to')).toBe(customEnd);
      expect(queries.at(-1)?.get('q')).toBe(searchText);
      expect(queries.at(-1)?.get('sort')).toBe('submitted_at:asc');
      await expect(
        page.getByRole('button', { name: copy('clearFilters'), exact: true })
      ).toHaveCount(0);
      await page.goBack();
      await expect.poll(() => queries.at(-1)?.get('statuses')).toBe(`submitted,${initialStatus}`);
      await expect(link(searched)).toBeVisible();
      await page
        .locator('summary')
        .filter({ hasText: dateCopy('label') })
        .click();
      await page.getByRole('button', { name: dateCopy('clear'), exact: true }).click();
      await expect(link(searched)).toBeVisible();
      await expect(page).not.toHaveURL(/from=|to=/);
      expect(queries.at(-1)?.has('before')).toBe(false);
      await search.fill('');
      await expect(page).not.toHaveURL(/q=/);
      await expect(link(sorted)).toBeVisible();
      await sort.selectOption('submitted_at:desc');
      await expect(page).not.toHaveURL(/sort=/);
      await expect(link(combined)).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ status: 503, json: {} })
      );
      await page.reload();
      await expect(link(combined)).toBeVisible();
      await page
        .locator('summary')
        .filter({ hasText: dateCopy('label') })
        .click();
      await expect(preset).toBeDisabled();
      await expect(startPicker).toBeDisabled();
      await expect(endPicker).toBeDisabled();
    });
  }
}

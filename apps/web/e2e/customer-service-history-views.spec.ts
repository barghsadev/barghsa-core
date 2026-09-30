import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { tSolar } from '@barghsa/i18n/solar';
import { tConsultation } from '@barghsa/i18n/consultation';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { formatInTimezone } from '@barghsa/i18n/date-time';

const first = '60000000-0000-4000-8000-000000000001';
const second = '60000000-0000-4000-8000-000000000002';
const invoice = '60000000-0000-4000-8000-000000000003';
const contract = '60000000-0000-4000-8000-000000000004';
const amount = '9007199254740993';
const submitted = '2026-09-30T09:00:00Z';
const periodStart = '2026-09-30T20:30:00Z';
const periodEnd = '2026-10-31T20:30:00Z';
const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
const plans = { en: 'Accepted saving plan', fa: 'طرح صرفه‌جویی پذیرفته‌شده' };
const equipment = { en: 'Accepted equipment', fa: 'تجهیز پذیرفته‌شده' };
const products = { en: 'Requested consultation', fa: 'مشاوره درخواستی' };

for (const locale of ['en', 'fa'] as const) {
  for (const kind of ['saving', 'electricity', 'solar', 'consultation'] as const) {
    test(`${kind} views retain pages, workflow links and preferences (${locale})`, async ({
      page,
    }) => {
      const mobile = (page.viewportSize()?.width ?? 1280) < 768;
      const config = {
        saving: {
          path: '/savings/orders',
          api: '/api/saving/orders',
          key: 'saving-orders',
          columns: 8,
          title: tSaving('orders', locale),
          more: tSaving('moreOrders', locale),
        },
        electricity: {
          path: '/electricity/orders',
          api: '/api/electricity/orders',
          key: 'electricity-orders',
          columns: 7,
          title: t('electricity.orders.title', locale),
          more: t('electricity.orders.more', locale),
        },
        solar: {
          path: '/solar/requests',
          api: '/api/solar/requests',
          key: 'solar-requests',
          columns: 6,
          title: tSolar('myRequests', locale),
          more: tSolar('moreRequests', locale),
        },
        consultation: {
          path: '/consultations',
          api: '/api/consultations/requests',
          key: 'consultations',
          columns: 6,
          title: tConsultation('myRequests', locale),
          more: tConsultation('moreRequests', locale),
        },
      }[kind];
      await page.addInitScript((value) => {
        localStorage.setItem('barghsa.locale', value);
        // A choice in another history must not override this history's responsive default.
        localStorage.setItem('barghsa.list-view:service-customer:invoices', 'card');
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'service-customer',
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
      await page.route('**/api/profiles/verification-status', (route) =>
        route.fulfill({ json: { activeProfileId: first } })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      await page.route('**/api/consultations/products?*', (route) =>
        route.fulfill({ json: { products: [{ id: 'product-one', title: products }] } })
      );
      const row = (id: string) => ({
        id,
        orderId: id,
        status:
          kind === 'solar'
            ? id === first
              ? 'contract_created'
              : 'waiting_for_postal_submission'
            : kind === 'consultation'
              ? id === first
                ? 'offer_accepted'
                : 'awaiting_customer_info'
              : 'approved',
        electricityStatus: 'approved',
        financialStatus: 'unpaid',
        nextAction: id === first ? 'pay_invoice' : 'accept_contract',
        submittedAt: submitted,
        periodStart,
        periodEnd,
        totalKwh: '1000',
        totalIrR: amount,
        submitted_at: submitted,
        plan_title: plans,
        hardware_title: equipment,
        total_amount: amount,
        bill_identifier: '1234567890123',
        financial_status: 'unpaid',
        invoice_id: invoice,
        invoice_state: 'Unpaid',
        contract_id: contract,
        contract_state: id === first ? 'Active' : 'AwaitingCustomerAcceptance',
        cancellation_pending: false,
        invoiceId: invoice,
        contractId: contract,
        building_type: 'non_household',
        grid_type: 'off_grid',
        contract_published: true,
        initial_invoice_id: invoice,
        initial_invoice_state: 'Unpaid',
        product_snapshot: { title: products },
        staff_owner_username: 'energy-reviewer',
        staff_team: 'Energy advice',
        expected_next_step: null,
        offer_valid_until: null,
        accepted_at: submitted,
        refund_pending: false,
      });
      const requests: URLSearchParams[] = [];
      await page.route(`**${config.api}?*`, (route) => {
        const query = new URL(route.request().url()).searchParams;
        requests.push(query);
        const more = query.has('before');
        return route.fulfill({
          json: {
            [kind === 'saving' || kind === 'electricity' ? 'orders' : 'requests']: [
              row(more ? second : first),
            ],
            nextBefore: more ? null : first,
          },
        });
      });
      const detail = (id: string) =>
        page.getByRole('main').locator(`a[href="${config.path}/${id}"]`);
      const tableButton = page.getByRole('button', {
        name: t('historyView.table', locale),
        exact: true,
      });
      const cardButton = page.getByRole('button', {
        name: t('historyView.card', locale),
        exact: true,
      });
      const table = page.getByRole('table', { name: config.title, exact: true });
      await page.goto(`${config.path}?sort=submitted_at%3Aasc`);
      await expect(detail(first)).toBeVisible();
      await expect(mobile ? cardButton : tableButton).toHaveAttribute('aria-pressed', 'true');
      expect(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          `barghsa.list-view:service-customer:${config.key}`
        )
      ).toBeNull();
      if (kind === 'consultation') {
        await page.getByRole('radio').check();
        await page
          .getByRole('checkbox', { name: tConsultation('confirm', locale), exact: true })
          .check();
      }
      await page.getByRole('button', { name: config.more, exact: true }).click();
      await expect(detail(second)).toBeVisible();
      const loadedRequests = requests.length;
      expect(requests.at(-1)?.get('before')).toBe(first);
      expect(requests.at(-1)?.get('sort')).toBe('submitted_at:asc');
      await (mobile ? tableButton : cardButton).click();
      await expect(detail(first)).toBeVisible();
      await expect(detail(second)).toBeVisible();
      expect(requests.length).toBe(loadedRequests);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(mobile ? tableButton : cardButton).toHaveAttribute('aria-pressed', 'true');
      await tableButton.click();
      await expect(table.getByRole('columnheader')).toHaveCount(config.columns);
      const firstRow = table.getByRole('row').filter({ hasText: first });
      const secondRow = table.getByRole('row').filter({ hasText: second });
      await expect(firstRow.locator('time')).toHaveText(
        formatInTimezone(submitted, 'Asia/Tehran', locale, dateOptions)
      );
      if (kind === 'saving' || kind === 'electricity') {
        await expect(
          firstRow.getByText(formatCurrencyIrr(amount, locale), { exact: true })
        ).toBeVisible();
        await expect(
          firstRow.getByRole('link', {
            name:
              kind === 'saving'
                ? tSaving('action.payInvoice', locale)
                : t('electricity.orders.payInvoice', locale),
            exact: true,
          })
        ).toHaveAttribute('href', `/invoices/${invoice}`);
        await expect(
          secondRow.getByRole('link', {
            name:
              kind === 'saving'
                ? tSaving('action.acceptContract', locale)
                : t('electricity.orders.reviewContract', locale),
            exact: true,
          })
        ).toHaveAttribute('href', `/contracts?contractId=${contract}`);
      }
      if (kind === 'saving') {
        await expect(firstRow.getByText(plans[locale], { exact: true })).toBeVisible();
        await expect(firstRow.getByText(equipment[locale], { exact: true })).toBeVisible();
        await expect(firstRow.getByText('1234567890123', { exact: true })).toBeVisible();
        await expect(
          firstRow.getByText(tSaving('financial.unpaid', locale), { exact: true })
        ).toBeVisible();
      } else if (kind === 'electricity') {
        const period = `${formatInTimezone(periodStart, 'Asia/Tehran', locale, dateOptions)} – ${formatInTimezone(new Date(new Date(periodEnd).getTime() - 1), 'Asia/Tehran', locale, dateOptions)}`;
        await expect(firstRow.getByText(period, { exact: true })).toBeVisible();
        await expect(
          firstRow.getByText(t('electricity.order.financial.unpaid', locale), { exact: true })
        ).toBeVisible();
      } else if (kind === 'solar') {
        await expect(
          firstRow.getByText(tSolar('nonHousehold', locale), { exact: true })
        ).toBeVisible();
        await expect(firstRow.getByText(tSolar('offGrid', locale), { exact: true })).toBeVisible();
        await expect(
          firstRow.getByRole('link', { name: tSolar('solarPayInvoice', locale), exact: true })
        ).toHaveAttribute('href', `/invoices/${invoice}`);
        await expect(
          secondRow.getByRole('link', { name: tSolar('workflowNextPostal', locale), exact: true })
        ).toHaveAttribute('href', `${config.path}/${second}#solar-postal`);
      } else {
        await expect(firstRow.getByText(products[locale], { exact: true })).toBeVisible();
        await expect(firstRow.getByText('energy-reviewer', { exact: true })).toBeVisible();
        await expect(firstRow.getByText(/Energy advice/)).toBeVisible();
        await expect(
          firstRow.getByRole('link', { name: tConsultation('viewInvoice', locale), exact: true })
        ).toHaveAttribute('href', `/invoices/${invoice}`);
        await expect(
          secondRow.getByRole('link', { name: tConsultation('provideInfo', locale), exact: true })
        ).toHaveAttribute('href', `${config.path}/${second}#consultation-information-form`);
      }
      const scroller = page
        .getByRole('region', { name: config.title, exact: true })
        .locator('[data-slot="scroll-area-viewport"]');
      await scroller.focus();
      await expect(scroller).toBeFocused();
      await scroller.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect
        .poll(() => scroller.evaluate((element) => Math.abs(element.scrollLeft)))
        .toBeGreaterThan(0);
      expect(
        (await new AxeBuilder({ page }).include('[data-slot="scroll-area"]').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await cardButton.click();
      await expect(detail(first)).toBeVisible();
      await expect(detail(second)).toBeVisible();
      if (kind === 'consultation') {
        await expect(page.getByRole('radio')).toBeChecked();
        await expect(
          page.getByRole('checkbox', { name: tConsultation('confirm', locale), exact: true })
        ).toBeChecked();
        await expect(
          page.getByRole('button', { name: tConsultation('request', locale), exact: true })
        ).toBeEnabled();
      }
      expect(requests.length).toBe(loadedRequests);
      expect(new URL(page.url()).searchParams.get('sort')).toBe('submitted_at:asc');
      await page.reload();
      await expect(cardButton).toHaveAttribute('aria-pressed', 'true');
      await expect(detail(first)).toBeVisible();
      expect(
        await page.evaluate(
          (key) => localStorage.getItem(key),
          `barghsa.list-view:service-customer:${config.key}`
        )
      ).toBe('card');
      expect(
        await page.evaluate(() =>
          localStorage.getItem('barghsa.list-view:service-customer:invoices')
        )
      ).toBe('card');
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(cardButton).toHaveAttribute('aria-pressed', 'true');
    });
  }
}

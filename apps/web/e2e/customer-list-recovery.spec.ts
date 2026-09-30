import { test, expect } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { tSolar } from '@barghsa/i18n/solar';
import { tConsultation } from '@barghsa/i18n/consultation';

const first = '81000000-0000-4000-8000-000000000001';
const older = '81000000-0000-4000-8000-000000000002';
const profile = '81000000-0000-4000-8000-000000000003';
const amount = '9007199254740993';
const beforeAt = '2026-09-01T00:00:00.000001Z';
const histories = {
  electricity: {
    path: '/electricity/orders',
    api: '/api/electricity/orders',
    statuses: 'submitted',
  },
  saving: { path: '/savings/orders', api: '/api/saving/orders', statuses: 'submitted' },
  solar: { path: '/solar/requests', api: '/api/solar/requests', statuses: 'submitted' },
  consultation: {
    path: '/consultations',
    api: '/api/consultations/requests',
    statuses: 'submitted',
  },
  invoice: { path: '/invoices', api: '/api/invoices', statuses: 'Paid' },
  contract: { path: '/contracts', api: '/api/contracts', statuses: 'Active' },
  receipt: {
    path: '/invoices/receipts',
    api: '/api/invoices/bank-receipts',
    statuses: 'Submitted',
  },
} as const;

for (const locale of ['en', 'fa'] as const) {
  for (const kind of Object.keys(histories) as (keyof typeof histories)[]) {
    test(`${kind} history retries the exact failed page and retains rows (${locale})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'recovery-customer',
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
            activeProfileId: profile,
            profiles: [
              {
                id: profile,
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
        route.fulfill({ json: { activeProfileId: profile } })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      await page.route('**/api/consultations/products?*', (route) =>
        route.fulfill({
          json: { products: [{ id: profile, title: { en: 'Consultation', fa: 'مشاوره' } }] },
        })
      );
      const history = histories[kind];
      const response = (id: string, hasMore: boolean) => {
        const row = {
          id,
          orderId: id,
          invoiceId: id,
          receiptId: id,
          status: 'submitted',
          state: kind === 'contract' ? 'Active' : kind === 'invoice' ? 'Paid' : 'Submitted',
          electricityStatus: 'submitted',
          financialStatus: 'paid',
          nextAction: 'await_review',
          submittedAt: '2026-09-30T09:00:00Z',
          createdAt: '2026-09-30T09:00:00Z',
          issuedAt: '2026-09-30T09:00:00Z',
          dueAt: null,
          periodStart: '2026-10-01T00:00:00Z',
          periodEnd: '2026-11-01T00:00:00Z',
          totalKwh: '10',
          totalIrR: amount,
          totalAmount: amount,
          paidAmount: amount,
          role: 'original',
          explanation: null,
          submitted_at: '2026-09-30T09:00:00Z',
          plan_title: { en: 'Saving plan', fa: 'طرح صرفه‌جویی' },
          hardware_title: { en: 'Device', fa: 'تجهیز' },
          total_amount: amount,
          bill_identifier: '12345678',
          financial_status: 'paid',
          invoice_id: null,
          contract_id: null,
          building_type: 'non_household',
          grid_type: 'off_grid',
          product_snapshot: { title: { en: 'Consultation', fa: 'مشاوره' } },
          staff_owner_username: null,
          staff_team: null,
          serviceType: 'electricity',
          versionId: profile,
          versionNumber: 1,
          publishedAt: '2026-09-30T09:00:00Z',
          initialInvoiceId: null,
          amount,
          bankName: 'Bank Mellat',
          paymentDate: '2026-09-01',
        };
        if (kind === 'receipt')
          return {
            items: [{ ...row, invoiceId: profile }],
            nextCursor: hasMore ? { beforeAt, beforeId: first } : null,
          };
        return {
          [kind === 'invoice'
            ? 'invoices'
            : kind === 'contract'
              ? 'contracts'
              : kind === 'solar' || kind === 'consultation'
                ? 'requests'
                : 'orders']: [row],
          nextBefore: hasMore ? first : null,
        };
      };
      const queries: URLSearchParams[] = [];
      let firstFailure = true;
      let held: Route | undefined;
      let holdMore = true;
      await page.route(new RegExp(`${history.api.replaceAll('/', '\\/')}(?:\\?|$)`), (route) => {
        const query = new URL(route.request().url()).searchParams;
        queries.push(query);
        if (firstFailure) {
          return route.fulfill({ status: 503, json: {} });
        }
        const more = query.has('before') || query.has('beforeId');
        if (more && holdMore) {
          if (held) return route.fulfill({ status: 503, json: {} });
          held = route;
          return;
        }
        return route.fulfill({ json: response(more ? older : first, !more) });
      });
      const retryLabel =
        kind === 'solar'
          ? tSolar('retry', locale)
          : kind === 'consultation'
            ? tConsultation('retry', locale)
            : kind === 'electricity'
              ? t('electricity.order.retry', locale)
              : kind === 'invoice'
                ? t('invoices.filter.retry', locale)
                : kind === 'receipt'
                  ? t('invoices.receipts.retry', locale)
                  : t('historyPagination.retry', locale);
      await page.goto(`${history.path}?statuses=${history.statuses}`);
      const content = page.getByRole('main').locator('[data-slot="list-content"]');
      const record = (id: string) => content.getByText(id, { exact: true }).first();
      const retry = content.getByRole('button', { name: retryLabel, exact: true });
      await expect(retry).toBeVisible();
      const failedReads = queries.length;
      firstFailure = false;
      await retry.click();
      await expect(record(first)).toBeVisible();
      expect(queries).toHaveLength(failedReads + 1);
      expect(queries[0]!.toString()).toBe(queries.at(-1)!.toString());
      if (kind === 'consultation') await page.getByRole('radio').check();
      const more = page
        .getByRole('navigation', { name: t('historyPagination.label', locale), exact: true })
        .getByRole('button');
      await more.click();
      await expect.poll(() => !!held).toBe(true);
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(record(first)).toBeVisible();
      await expect(more).toBeDisabled();
      await held!.fulfill({ status: 503, json: {} });
      await expect(retry).toBeVisible();
      await expect(record(first)).toBeVisible();
      if (locale === 'fa' && kind === 'contract')
        await page.screenshot({ path: '/tmp/barghsa-list-page-contract-fa.png', fullPage: true });
      const failed = queries.at(-1)!.toString();
      holdMore = false;
      await retry.click();
      await expect(record(older)).toBeVisible();
      await expect(record(first)).toBeVisible();
      expect(queries.at(-1)!.toString()).toBe(failed);
      expect(queries.at(-1)?.get('statuses')).toBe(history.statuses);
      if (kind === 'receipt') expect(queries.at(-1)?.get('beforeAt')).toBe(beforeAt);
      else expect(queries.at(-1)?.get('before')).toBe(first);
      await expect(
        page.getByRole('navigation', { name: t('historyPagination.label', locale), exact: true })
      ).toHaveCount(0);
      if (kind === 'consultation') await expect(page.getByRole('radio')).toBeChecked();
      expect(
        (await new AxeBuilder({ page }).include('[data-slot="list-page"]').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
    });
  }
}

import AxeBuilder from '@axe-core/playwright';
import type { Route } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { tConsultation } from '@barghsa/i18n/consultation';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';

const first = '89000000-0000-4000-8000-000000000001';
const older = '89000000-0000-4000-8000-000000000003';
const current = '89000000-0000-4000-8000-000000000005';
const profileA = '89000000-0000-4000-8000-000000000002';
const profileB = '89000000-0000-4000-8000-000000000004';
const user = '89000000-0000-4000-8000-000000000009';
const domains = {
  electricity: { path: '/electricity/orders', api: '/api/electricity/orders', items: 'orders' },
  saving: { path: '/savings/orders', api: '/api/saving/orders', items: 'orders' },
  solar: { path: '/solar/requests', api: '/api/solar/requests', items: 'requests' },
  invoice: { path: '/invoices', api: '/api/invoices', items: 'invoices' },
  consultation: { path: '/consultations', api: '/api/consultations/requests', items: 'requests' },
  receipt: { path: '/invoices/receipts', api: '/api/invoices/bank-receipts', items: 'items' },
} as const;
function row(id: string) {
  return {
    id,
    receiptId: id,
    amount: '9007199254740993',
    bankName: 'Receipt bank',
    paymentDate: '2026-10-01',
    orderId: id,
    invoiceId: id,
    role: 'original',
    state: 'Unpaid',
    totalAmount: '9007199254740993',
    paidAmount: '0',
    issuedAt: '2026-10-05T10:00:00.000Z',
    dueAt: '2026-10-12T10:00:00.000Z',
    contractId: null,
    status: 'submitted',
    electricityStatus: 'submitted',
    financialStatus: 'paid',
    nextAction: 'await_review',
    submittedAt: '2026-10-05T10:00:00.000Z',
    submitted_at: '2026-10-05T10:00:00.000Z',
    periodStart: '2026-10-01T00:00:00.000Z',
    periodEnd: '2026-11-01T00:00:00.000Z',
    totalKwh: '10',
    totalIrR: '9007199254740993',
    total_amount: '9007199254740993',
    product_snapshot: { title: { en: 'Consultation', fa: 'مشاوره' } },
    staff_owner_username: null,
    staff_team: null,
    expected_next_step: null,
    accepted_at: null,
    offer_valid_until: null,
    refund_pending: false,
    invoice_state: null,
    plan_title: { en: 'Saving plan', fa: 'طرح صرفه‌جویی' },
    hardware_title: { en: 'Device', fa: 'تجهیز' },
    bill_identifier: '12345678',
    financial_status: 'paid',
    invoice_id: null,
    contract_id: null,
    building_type: 'household',
    grid_type: 'on_grid',
    contract_published: false,
    initial_invoice_id: null,
    initial_invoice_state: null,
  };
}
for (const locale of ['en', 'fa'] as const)
  for (const kind of Object.keys(domains) as (keyof typeof domains)[]) {
    test(`${kind} customer history withdraws denied pages and fences a live profile switch (${locale})`, async ({
      page,
    }, info) => {
      const config = domains[kind];
      const status = kind === 'invoice' ? 'Unpaid' : kind === 'receipt' ? 'Submitted' : 'submitted';
      const implicitProfile = kind === 'invoice' || kind === 'receipt';
      const copy = (key: string) => t(key, locale);
      await setupCatalogueForms(page, locale, locale === 'fa');
      let activeProfile = profileA;
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: user,
            isStaff: false,
            operatingContext: 'customer',
            canSwitchContext: false,
            requiresTosAcceptance: false,
            navigation: { ...fullNavigation('customer', 'INDIVIDUAL'), profileId: activeProfile },
          },
        })
      );
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          json: {
            activeProfileId: activeProfile,
            hasDefault: true,
            profiles: [
              {
                id: profileA,
                profileType: 'INDIVIDUAL',
                firstName: locale === 'fa' ? 'پروفایل' : 'Profile',
                lastName: 'A',
                status: 'ACTIVE',
              },
              {
                id: profileB,
                profileType: 'INDIVIDUAL',
                firstName: locale === 'fa' ? 'پروفایل' : 'Profile',
                lastName: 'B',
                status: 'ACTIVE',
              },
            ],
          },
        })
      );
      await page.route('**/api/profiles/verification-status', (route) =>
        route.fulfill({
          json: {
            activeProfileId: activeProfile,
            profileStatus: 'ACTIVE',
            verificationRequired: true,
            isVerified: true,
          },
        })
      );
      await page.route(`**/api/profiles/switch/${profileB}`, (route) => {
        expect(route.request().method()).toBe('POST');
        activeProfile = profileB;
        return route.fulfill({ json: { activeProfileId: profileB } });
      });
      const beforeAt = '2026-10-05T10:00:00.000001Z';
      const response = (id: string, next: string | null) =>
        kind === 'receipt'
          ? {
              items: [{ ...row(id), state: 'Submitted' }],
              nextCursor: next ? { beforeAt, beforeId: next } : null,
            }
          : { [config.items]: [row(id)], nextBefore: next };
      let mode: 'success' | 'held' | 'denied' | 'switch' = 'success';
      let held: Route | undefined, currentHeld: Route | undefined;
      const reads: URLSearchParams[] = [];
      const owners = new Map<URLSearchParams, string>();
      await page.route(new RegExp(`${config.api.replaceAll('/', '\\/')}(?:\\?|$)`), (route) => {
        const query = new URL(route.request().url()).searchParams;
        reads.push(query);
        owners.set(query, activeProfile);
        if (implicitProfile) expect(query.has('profileId')).toBe(false);
        if ((implicitProfile ? activeProfile : query.get('profileId')) === profileB) {
          currentHeld = route;
          return;
        }
        if (mode === 'held' || mode === 'switch') {
          held = route;
          return;
        }
        if (mode === 'denied')
          return route.fulfill({
            status: locale === 'en' ? 401 : 403,
            json: {
              error: {
                code: 'AUTHZ:FORBIDDEN',
                message: 'PRIVATE_DENIAL_MESSAGE',
                correlationId: user,
              },
            },
          });
        return route.fulfill({
          json:
            query.has('before') || query.has('beforeId')
              ? response(older, older)
              : response(first, first),
        });
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${config.path}?statuses=${status}`);
      const main = page.getByRole('main').last();
      const historyRegion =
        kind === 'consultation'
          ? main.getByRole('region', { name: tConsultation('myRequests', locale), exact: true })
          : main;
      const content = historyRegion.locator('[data-slot=list-content]');
      const record = (id: string) => content.getByText(id, { exact: true }).first();
      const more = () =>
        main
          .getByRole('navigation', { name: copy('historyPagination.label'), exact: true })
          .getByRole('button');
      const retry = () => content.getByRole('button');
      await expect(record(first)).toBeVisible();
      await main.getByRole('button', { name: copy('historyFilters.label'), exact: true }).click();
      const filters = page.getByRole('dialog');
      await filters.getByLabel(copy('historySearch.label'), { exact: true }).fill('89000000');
      await filters
        .getByRole('button', { name: copy('historyFilters.apply'), exact: true })
        .click();
      await expect(filters).toHaveCount(0);
      await expect.poll(() => reads.at(-1)!.get('q')).toBe('89000000');
      await expect(record(first)).toBeVisible();
      const appliedUrl = page.url();
      mode = 'held';
      await more().click();
      await expect.poll(() => !!held).toBe(true);
      const failedQuery = reads.at(-1)!.toString();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(record(first)).toBeVisible();
      await expect(more()).toBeDisabled();
      await held!.fulfill({ status: 503, json: {} });
      held = undefined;
      await expect(retry()).toBeVisible();
      await expect(record(first)).toBeVisible();
      mode = 'success';
      await retry().click();
      await expect(record(older)).toBeVisible();
      expect(reads.at(-1)!.toString()).toBe(failedQuery);
      mode = 'denied';
      await more().click();
      await expect(content.getByRole('alert')).toContainText(
        copy('historyPagination.accessDenied')
      );
      await expect(record(first)).toHaveCount(0);
      await expect(record(older)).toHaveCount(0);
      await expect(main).not.toContainText('PRIVATE_DENIAL_MESSAGE');
      await expect(
        main.getByRole('navigation', { name: copy('historyPagination.label'), exact: true })
      ).toHaveCount(0);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-slot=list-page]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      if (
        locale === 'fa' &&
        kind === 'consultation' &&
        info.project.name === 'mobile-safari' &&
        process.env.BARGHSA_SCREENSHOT_DIR
      ) {
        await page.setViewportSize({ width: 430, height: 1500 });
        await page.evaluate(() => document.fonts.ready);
        await historyRegion
          .locator('[data-slot=list-page]')
          .locator('..')
          .screenshot({
            path: `${process.env.BARGHSA_SCREENSHOT_DIR}/consultation-history-denied-fa.png`,
          });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      mode = 'success';
      await retry().click();
      await expect(record(first)).toBeVisible();
      if (!implicitProfile) expect(reads.at(-1)!.get('profileId')).toBe(profileA);
      expect(reads.at(-1)!.has('before')).toBe(false);
      expect(reads.at(-1)!.has('beforeAt')).toBe(false);
      expect(reads.at(-1)!.has('beforeId')).toBe(false);
      expect(reads.at(-1)!.get('q')).toBe('89000000');
      expect(reads.at(-1)!.get('statuses')).toBe(status);
      await expect(record(older)).toHaveCount(0);

      await page.setViewportSize({ width: 1280, height: 900 });
      mode = 'switch';
      await more().click();
      await expect.poll(() => !!held).toBe(true);
      const obsolete = held!;
      await page.locator('#profile-switcher:visible').selectOption(profileB);
      await expect.poll(() => !!currentHeld).toBe(true);
      await expect(record(first)).toHaveCount(0);
      await expect(record(older)).toHaveCount(0);
      const fresh = reads.filter((query) => owners.get(query) === profileB);
      expect(fresh).toHaveLength(1);
      expect(fresh[0]!.has('before')).toBe(false);
      expect(fresh[0]!.has('beforeAt')).toBe(false);
      expect(fresh[0]!.has('beforeId')).toBe(false);
      expect(fresh[0]!.get('q')).toBe('89000000');
      expect(fresh[0]!.get('statuses')).toBe(status);
      await currentHeld!.fulfill({ json: response(current, null) });
      await expect(record(current)).toBeVisible();
      if (kind === 'consultation')
        await expect(main).toContainText(locale === 'fa' ? 'پروفایل B' : 'Profile B');
      await obsolete.fulfill({ json: response(older, null) });
      await expect(record(first)).toHaveCount(0);
      await expect(record(older)).toHaveCount(0);
      await expect(record(current)).toBeVisible();
      await expect(page).toHaveURL(appliedUrl);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(record(current)).toBeVisible();
      await expect(
        main.getByRole('button', { name: copy('historyView.card'), exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      await page.evaluate(() => document.fonts.ready);
      const bounds = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        overflowing: Array.from(document.querySelectorAll('body *'))
          .map((element) => ({
            tag: element.tagName,
            class: element.getAttribute('class'),
            box: element.getBoundingClientRect().toJSON(),
          }))
          .filter(({ box }) => box.width && (box.right > innerWidth + 1 || box.left < -1))
          .slice(0, 12),
      }));
      expect(bounds.scroll, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.width);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-slot=list-page]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      if (
        locale === 'fa' &&
        kind === 'consultation' &&
        info.project.name === 'mobile-safari' &&
        process.env.BARGHSA_SCREENSHOT_DIR
      ) {
        await page.setViewportSize({ width: 430, height: 1500 });
        await page.evaluate(() => document.fonts.ready);
        await historyRegion
          .locator('[data-slot=list-page]')
          .locator('..')
          .screenshot({
            path: `${process.env.BARGHSA_SCREENSHOT_DIR}/consultation-history-profile-fa.png`,
          });
      }
    });
  }

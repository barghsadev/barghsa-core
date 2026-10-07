import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { contractText } from '@barghsa/i18n/contracts';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';

const first = '50000000-0000-4000-8000-000000000001';
const older = '50000000-0000-4000-8000-000000000002';
const amount = '9007199254740993';

for (const locale of ['en', 'fa'] as const) {
  test(`financial history views retain pages, actions and account preferences (${locale})`, async ({
    page,
  }) => {
    const mobile = (page.viewportSize()?.width ?? 1280) < 768;
    let userId = 'financial-first';
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId,
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
    const invoiceRequests: string[] = [];
    await page.route(/\/api\/invoices(?:\?|$)/, (route) => {
      invoiceRequests.push(route.request().url());
      const more = new URL(route.request().url()).searchParams.has('before');
      return route.fulfill({
        json: {
          invoices: [
            {
              invoiceId: more ? older : first,
              role: 'original',
              state: 'Paid',
              totalAmount: amount,
              paidAmount: amount,
              issuedAt: '2026-09-30T09:00:00Z',
              dueAt: '2026-10-05T09:00:00Z',
              periodStart: '2026-10-01T00:00:00Z',
              periodEnd: '2026-11-01T00:00:00Z',
              explanation: 'Customer invoice explanation',
            },
          ],
          nextBefore: more ? null : first,
        },
      });
    });
    const contractRequests: string[] = [];
    const contract = (id: string) => ({
      id,
      contractNumber: id === first ? '9007199254740993' : '9007199254740994',
      serviceType: 'electricity',
      state: 'Active',
      versionId: first,
      versionNumber: 1,
      profileType: 'LEGAL',
      acceptedParty: { name: 'Accepted company', profileType: 'LEGAL' },
      profileTitle: 'Changed company',
      commercialValue: { kind: 'fixed', amountIrr: amount },
      publishedAt: '2026-09-30T09:00:00Z',
      acceptedAt: '2026-09-30T10:00:00Z',
      serviceStartsAt: '2026-10-01T00:00:00Z',
      serviceEndsAt: '2026-11-01T00:00:00Z',
      initialInvoiceId: first,
      initialInvoiceAmount: amount,
      initialInvoiceState: 'Paid',
      orderId: first,
      linkedOrderStatus: 'Completed',
      pendingAmendmentState: 'AwaitingCustomerAcceptance',
    });
    await page.route(/\/api\/contracts(?:\?|$)/, (route) => {
      contractRequests.push(route.request().url());
      const more = new URL(route.request().url()).searchParams.has('before');
      return route.fulfill({
        json: { contracts: [contract(more ? older : first)], nextBefore: more ? null : first },
      });
    });
    let detailReads = 0;
    const version = {
      id: first,
      versionNumber: 1,
      content: { text: 'Retained contract terms' },
      changeDescription: '',
      createdAt: '2026-09-30T09:00:00Z',
      acceptedAt: '2026-09-30T10:00:00Z',
    };
    await page.route(`**/api/contracts/${first}`, (route) => {
      detailReads += 1;
      return route.fulfill({
        json: { ...contract(first), profileId: first, version, canAccept: false },
      });
    });
    await page.route(`**/api/contracts/${first}/versions`, (route) =>
      route.fulfill({ json: { versions: [version], nextBefore: null } })
    );
    await page.route(`**/api/contracts/${first}/signature?*`, (route) =>
      route.fulfill({
        json: {
          contractId: first,
          versionId: first,
          state: 'Active',
          isCurrent: true,
          isAmendment: false,
          canRequest: false,
          canRecord: false,
          request: null,
          signature: null,
        },
      })
    );
    await page.route(`**/api/contracts/${first}/activation?*`, (route) =>
      route.fulfill({
        json: {
          contractId: first,
          versionId: first,
          state: 'Active',
          isCurrent: true,
          ready: false,
          ruleRevision: 1,
          initialInvoiceId: first,
          serviceStartsAt: '2026-10-01T00:00:00Z',
          serviceEndsAt: '2026-11-01T00:00:00Z',
          evaluatedAt: '2026-10-01T00:00:00Z',
          checks: ['staffApproval', 'customerAcceptance', 'signature', 'initialPayment']
            .map((key) => ({ key, required: true, status: 'met' }))
            .concat([{ key: 'serviceStart', required: false, status: 'not_required' }]),
        },
      })
    );
    await page.route(`**/api/contracts/${first}/cancellation-status`, (route) =>
      route.fulfill({
        json: {
          contractId: first,
          state: 'Active',
          cancelledAt: null,
          financialStatus: 'not_cancelled',
          financiallyClosed: false,
          refundAmount: '0',
          returnedAmount: '0',
          canCancel: false,
          canChooseRefund: false,
          refunds: [],
        },
      })
    );
    await page.route('**/api/documents?*', (route) =>
      route.fulfill({ json: { documents: [], nextBefore: null } })
    );
    const tableButton = page.getByRole('button', {
      name: t('historyView.table', locale),
      exact: true,
    });
    const cardButton = page.getByRole('button', {
      name: t('historyView.card', locale),
      exact: true,
    });
    const invoiceLink = (id: string) => page.getByRole('main').locator(`a[href="/invoices/${id}"]`);
    await page.goto('/invoices?status=unpaid&statuses=Paid');
    await expect(invoiceLink(first)).toBeVisible();
    await expect(mobile ? cardButton : tableButton).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page.evaluate(() => localStorage.getItem('barghsa.list-view:financial-first:invoices'))
    ).toBeNull();
    await page
      .getByRole('button', { name: t('invoices.filter.more', locale), exact: true })
      .click();
    await expect(invoiceLink(older)).toBeVisible();
    const loadedInvoices = invoiceRequests.length;
    await (mobile ? tableButton : cardButton).click();
    await expect(invoiceLink(first)).toBeVisible();
    await expect(invoiceLink(older)).toBeVisible();
    expect(invoiceRequests.length).toBe(loadedInvoices);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(mobile ? tableButton : cardButton).toHaveAttribute('aria-pressed', 'true');
    await tableButton.click();
    const invoiceTable = page.getByRole('table', {
      name: t('invoices.title', locale),
      exact: true,
    });
    await expect(invoiceTable.getByRole('columnheader')).toHaveCount(8);
    await expect(
      invoiceTable.getByText(formatCurrencyIrr(amount, locale), { exact: true })
    ).toHaveCount(4);
    await expect(
      invoiceTable.getByText('Customer invoice explanation', { exact: true })
    ).toHaveCount(2);
    expect(
      (await new AxeBuilder({ page }).include('[data-slot="scroll-area"]').analyze()).violations
    ).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    const invoiceScroller = page
      .getByRole('region', { name: t('invoices.title', locale), exact: true })
      .locator('[data-slot="scroll-area-viewport"]');
    await invoiceScroller.focus();
    await expect(invoiceScroller).toBeFocused();
    await invoiceScroller.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect
      .poll(() => invoiceScroller.evaluate((element) => Math.abs(element.scrollLeft)))
      .toBeGreaterThan(0);
    expect(new URL(page.url()).searchParams.get('statuses')).toBe('Paid');
    await cardButton.click();
    await page.reload();
    await expect(cardButton).toHaveAttribute('aria-pressed', 'true');
    await expect(invoiceLink(first)).toBeVisible();
    expect(new URL(page.url()).searchParams.get('status')).toBe('unpaid');
    await page.setViewportSize({ width: 1280, height: 900 });
    userId = 'financial-second';
    await page.reload();
    await expect(tableButton).toHaveAttribute('aria-pressed', 'true');
    userId = 'financial-first';
    await page.reload();
    await expect(cardButton).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/contracts?state=Active');
    await expect(tableButton).toHaveAttribute('aria-pressed', 'true');
    const contractTable = page.getByRole('table', {
      name: contractText('title', locale),
      exact: true,
    });
    await expect(contractTable.getByRole('columnheader')).toHaveCount(8);
    await expect(contractTable.getByText('9007199254740993', { exact: true })).toBeVisible();
    await expect(contractTable.getByText(/Accepted company/)).toBeVisible();
    await expect(contractTable.getByText(/Changed company/)).toHaveCount(0);
    await expect(
      contractTable.getByRole('link', {
        name: contractText('openInitialInvoice', locale),
        exact: true,
      })
    ).toHaveAttribute('href', `/invoices/${first}`);
    await expect(
      contractTable.getByRole('link', {
        name: contractText('openLinkedOrder', locale),
        exact: true,
      })
    ).toHaveAttribute('href', `/electricity/orders/${first}`);
    await expect(
      contractTable.getByText(contractText('amendmentAwaitingAcceptance', locale), { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: contractText('next', locale), exact: true }).click();
    await expect(contractTable.getByText('9007199254740994', { exact: true })).toBeVisible();
    const loadedContracts = contractRequests.length;
    await cardButton.click();
    const firstCard = page
      .getByRole('main')
      .locator('li')
      .filter({ has: page.getByText('9007199254740993', { exact: true }) });
    await expect(firstCard).toBeVisible();
    await firstCard.getByRole('button').click();
    const detail = page.getByRole('region', { name: contractText('terms', locale), exact: true });
    await expect(detail.getByText('Retained contract terms', { exact: true })).toBeVisible();
    const loadedDetailReads = detailReads;
    await page
      .getByRole('region', { name: contractText('title', locale), exact: true })
      .locator(':scope > [data-slot="list-toolbar"]')
      .getByRole('button', { name: t('historyView.table', locale), exact: true })
      .click();
    await expect(detail.getByText('Retained contract terms', { exact: true })).toBeVisible();
    expect(detailReads).toBe(loadedDetailReads);
    expect(contractRequests.length).toBe(loadedContracts);
    await expect(contractTable.getByText('9007199254740994', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      (await new AxeBuilder({ page }).include('[data-slot="scroll-area"]').analyze()).violations
    ).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.goto('/invoices');
    await expect(cardButton).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page.evaluate(() => localStorage.getItem('barghsa.list-view:financial-first:contracts'))
    ).toBe('table');
  });
}

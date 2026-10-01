import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { encodeFinanceCursor, decodeFinanceCursor } from '../src/lib/finance-list-query';
test.use({ viewport: { width: 390, height: 844 } });
async function shell(page: Page, locale: 'en' | 'fa', darkMode: boolean) {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برق‌آسا',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
      },
    })
  );
}

const first = '82000000-0000-4000-8000-000000000001';
const older = '82000000-0000-4000-8000-000000000002';
const last = '82000000-0000-4000-8000-000000000003';
const profile = '82000000-0000-4000-8000-000000000004';
const order = '82000000-0000-4000-8000-000000000005';
const stamp = '2026-09-01T00:00:00.123456Z';
const cursor = (beforeId: string) => encodeFinanceCursor({ beforeAt: stamp, beforeId });
const params = (page: Page) => new URL(page.url()).searchParams;
const invoice = (invoiceId: string, state = 'Paid') => ({
  invoiceId,
  profileId: profile,
  orderId: order,
  type: 'manual',
  state,
  totalAmount: '9007199254740993',
  paidAmount: '9007199254740993',
  refundedAmount: '0',
  issuedAt: stamp,
  dueAt: stamp,
  createdAt: stamp,
});
async function inspect(
  page: Page,
  selector: string,
  locale: string,
  project: string,
  name: string,
  dark: boolean
) {
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari') {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/barghsa-finance-query-${name}-${dark ? 'dark' : 'light'}.png`,
    });
  }
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    const ledgerWord = (key: string) => adminText(`admin.invoices.ledger.${key}`, locale);
    const receiptWord = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
    test(`invoice ledger URL restores filters and exact pages without duplicating rows (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const reads: URL[] = [];
      await page.route(/\/api\/admin\/invoices\/ledger(?:\?|$)/, (route) => {
        const url = new URL(route.request().url());
        reads.push(url);
        const query = url.searchParams;
        const paged = query.has('beforeAt');
        return route.fulfill({
          json: {
            items: [invoice(paged ? older : first, query.get('state') ?? 'Paid')],
            nextCursor:
              query.has('invoiceId') || paged ? null : { beforeAt: stamp, beforeId: first },
          },
        });
      });
      await page.route(`**/api/admin/invoices/ledger/${first}`, (route) =>
        route.fulfill({
          json: {
            ...invoice(first),
            lines: [],
            activity: { payments: [], bankReceipts: [], refunds: [] },
          },
        })
      );
      await page.route('**/api/admin/invoices/bank-receipts', (route) =>
        route.fulfill({ json: { items: [] } })
      );
      await page.route(/\/api\/admin\/invoices\/bank-receipts\/history(?:\?|$)/, (route) =>
        route.fulfill({ json: { items: [], nextCursor: null } })
      );
      await page.goto(
        `/admin/invoices?invoiceId=${first}&profileId=${profile}&orderId=${order}&state=Paid&receipt_state=Confirmed`
      );
      const ledger = page.getByRole('region', { name: ledgerWord('title'), exact: true });
      const content = ledger.locator('[data-slot="list-content"]');
      const id = ledger.getByRole('textbox', { name: ledgerWord('searchId'), exact: true });
      await expect(id).toHaveValue(first);
      await expect(
        ledger.getByRole('textbox', { name: ledgerWord('searchProfileId'), exact: true })
      ).toHaveValue(profile);
      await expect(
        ledger.getByRole('textbox', { name: ledgerWord('searchOrderId'), exact: true })
      ).toHaveValue(order);
      await expect(content.locator('tbody tr')).toHaveCount(1);
      expect(reads.at(-1)!.searchParams.get('invoiceId')).toBe(first);
      await id.fill('');
      await ledger.getByRole('button', { name: ledgerWord('search'), exact: true }).click();
      await expect.poll(() => params(page).get('invoiceId')).toBeNull();
      await expect(content.locator('tbody tr')).toHaveCount(1);
      await ledger
        .getByRole('button', { name: `${ledgerWord('detail')}: ${first}`, exact: true })
        .click();
      const detail = ledger.getByRole('region', { name: ledgerWord('detail'), exact: true });
      await expect(detail.getByText(first, { exact: true })).toBeVisible();
      await ledger.getByRole('button', { name: ledgerWord('more'), exact: true }).click();
      await expect(content.locator('tbody tr')).toHaveCount(2);
      expect(decodeFinanceCursor(JSON.parse(params(page).get('cursor') ?? 'null'))).toEqual({
        beforeAt: stamp,
        beforeId: first,
      });
      expect(params(page).get('receipt_state')).toBe('Confirmed');
      expect(reads.at(-1)!.searchParams.get('profileId')).toBe(profile);
      expect(reads.at(-1)!.searchParams.get('orderId')).toBe(order);
      expect(reads.at(-1)!.searchParams.get('beforeAt')).toBe(stamp);
      await expect(detail.getByText(first, { exact: true })).toBeVisible();
      await expect(
        ledger.getByRole('button', { name: ledgerWord('previous'), exact: true })
      ).toBeEnabled();
      await page.reload();
      await expect(content.locator('tbody tr')).toHaveCount(1);
      await expect(
        content.getByRole('button', { name: `${ledgerWord('detail')}: ${older}`, exact: true })
      ).toBeVisible();
      await expect(
        ledger.getByRole('navigation', {
          name: appText('historyPagination.label', locale),
          exact: true,
        })
      ).toHaveCount(0);
      await page.goBack();
      await expect(
        content.getByRole('button', { name: `${ledgerWord('detail')}: ${first}`, exact: true })
      ).toBeVisible();
      await expect(content.locator('tbody tr')).toHaveCount(1);
      await page.goForward();
      await expect(content.locator('tbody tr')).toHaveCount(2);
      await ledger
        .getByRole('combobox', { name: ledgerWord('state'), exact: true })
        .selectOption('Unpaid');
      await expect.poll(() => params(page).get('cursor')).toBeNull();
      await expect(content.locator('tbody tr')).toHaveCount(1);
      expect(params(page).get('profileId')).toBe(profile);
      expect(params(page).get('receipt_state')).toBe('Confirmed');
      await page.goBack();
      await expect(
        ledger.getByRole('combobox', { name: ledgerWord('state'), exact: true })
      ).toHaveValue('Paid');
      await expect.poll(() => reads.at(-1)!.searchParams.get('beforeAt')).toBe(stamp);
      const count = reads.length;
      await id.fill('invalid');
      await ledger.getByRole('button', { name: ledgerWord('search'), exact: true }).click();
      await expect(ledger.getByRole('alert')).toHaveText(ledgerWord('invalidId'));
      expect(reads).toHaveLength(count);
      await inspect(
        page,
        'section[aria-labelledby="invoice-ledger-title"]',
        locale,
        info.project.name,
        'ledger',
        dark
      );
    });
    test(`reviewed receipt URL restores its scope and preserves independent ledger filters (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      await page.route(/\/api\/admin\/invoices\/ledger(?:\?|$)/, (route) =>
        route.fulfill({ json: { items: [], nextCursor: null } })
      );
      await page.route('**/api/admin/invoices/bank-receipts', (route) =>
        route.fulfill({ json: { items: [] } })
      );
      const reads: URL[] = [];
      await page.route(/\/api\/admin\/invoices\/bank-receipts\/history(?:\?|$)/, (route) => {
        const url = new URL(route.request().url());
        reads.push(url);
        const before = url.searchParams.get('beforeId');
        const receiptId = before === older ? last : before === first ? older : first;
        return route.fulfill({
          json: {
            items: [
              {
                receiptId,
                invoiceId: first,
                amount: '9007199254740993',
                bankName: 'Bank Mellat',
                state: url.searchParams.get('state') || 'Confirmed',
                paymentDate: '2026-09-01',
                submittedAt: stamp,
              },
            ],
            nextCursor: before === older ? null : { beforeAt: stamp, beforeId: receiptId },
          },
        });
      });
      const query = new URLSearchParams({
        state: 'Paid',
        profileId: profile,
        receipt_state: 'Confirmed',
        receipt_invoiceId: first,
        receipt_cursor: cursor(first),
      });
      await page.goto(`/admin/invoices?${query}`);
      const history = page.getByRole('region', { name: receiptWord('historyTitle'), exact: true });
      const content = history.locator('[data-slot="list-content"]');
      const previous = history.getByRole('button', {
        name: receiptWord('historyPrevious'),
        exact: true,
      });
      await expect(history).toBeVisible();
      await expect(content.getByText(older, { exact: true })).toBeVisible();
      await expect(previous).toBeDisabled();
      expect(reads.at(-1)!.searchParams.get('beforeAt')).toBe(stamp);
      expect(reads.at(-1)!.searchParams.get('invoiceId')).toBe(first);
      await history.getByRole('button', { name: receiptWord('historyNext'), exact: true }).click();
      await expect(content.getByText(last, { exact: true })).toBeVisible();
      await previous.click();
      await expect(content.getByText(older, { exact: true })).toBeVisible();
      await page.reload();
      await expect(content.getByText(older, { exact: true })).toBeVisible();
      await expect(previous).toBeDisabled();
      await history
        .getByRole('combobox', { name: receiptWord('historyState'), exact: true })
        .selectOption('Rejected');
      await expect.poll(() => params(page).get('receipt_cursor')).toBeNull();
      await expect(content.getByText(first, { exact: true })).toHaveCount(2);
      expect(params(page).get('state')).toBe('Paid');
      expect(params(page).get('profileId')).toBe(profile);
      await page.goBack();
      await expect(
        history.getByRole('combobox', { name: receiptWord('historyState'), exact: true })
      ).toHaveValue('Confirmed');
      await expect(content.getByText(older, { exact: true })).toBeVisible();
      await page.goForward();
      await expect(content.getByText(first, { exact: true })).toHaveCount(2);
      const queue = page.getByRole('region', { name: receiptWord('title'), exact: true });
      await queue.getByRole('button', { name: receiptWord('historyTitle'), exact: true }).click();
      await expect(history).toHaveCount(0);
      await page.reload();
      await expect(history).toHaveCount(0);
      expect(params(page).get('receipt_state')).toBe('Rejected');
      await queue.getByRole('button', { name: receiptWord('historyTitle'), exact: true }).click();
      await expect(
        history.getByRole('combobox', { name: receiptWord('historyState'), exact: true })
      ).toHaveValue('Rejected');
      await expect(
        history.getByRole('textbox', { name: receiptWord('invoice'), exact: true })
      ).toHaveValue(first);
      const count = reads.length;
      await history
        .getByRole('textbox', { name: receiptWord('invoice'), exact: true })
        .fill('invalid');
      await history.getByRole('button', { name: receiptWord('historyApply'), exact: true }).click();
      await expect(history.getByRole('alert')).toHaveText(receiptWord('historyInvalidInvoice'));
      expect(reads).toHaveLength(count);
      await inspect(
        page,
        'section[aria-label="' + receiptWord('historyTitle') + '"]',
        locale,
        info.project.name,
        'receipts',
        dark
      );
    });
  }

import AxeBuilder from '@axe-core/playwright';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { verifyClippedContrast } from './clipped-contrast';
const receiptId = '91000000-0000-4000-8000-000000000001';
const invoiceId = '91000000-0000-4000-8000-000000000002';
const olderId = '91000000-0000-4000-8000-000000000003';
const stamp = '2026-09-01T23:30:00.123456Z';
const amount = '9007199254740993';
const receipt = {
  receiptId,
  invoiceId,
  profileId: olderId,
  amount,
  bankName: 'Bank Mellat',
  state: 'Submitted',
  paymentDate: '2026-09-01',
  payerReference: 'BANK-REF',
  customerNote: null,
  submittedAt: stamp,
  attachmentUrl: '/mock/invoice-receipt.png?signed=1',
  attachmentKey: 'receipts/invoice.png',
  canConfirm: false,
  canReject: true,
  rejectionReason: null,
  invoiceAllocation: null,
  walletCreditAmount: null,
  confirmedAt: null,
  requiresDualApproval: false,
  dualApprovalPending: false,
};
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const darkMode of [false, true]) {
    test(`staff receipt views retain exact metadata, drafts and paged history (${locale}, dark=${darkMode})`, async ({
      page,
    }, info) => {
      await crmShell(page, locale);
      await page.route('**/mock/invoice-receipt.png?**', (r) =>
        r.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect width="600" height="240" fill="#e8ece7"/><text x="40" y="100" fill="#203e35" font-size="32">Invoice receipt fixture</text></svg>',
        })
      );
      await page.route('**/api/user/settings/timezone', (r) =>
        r.fulfill({ json: { timezone: 'Pacific/Kiritimati' } })
      );
      await page.route('**/api/public/branding/config', (r) =>
        r.fulfill({
          json: {
            appTitle: 'Finance',
            appTitleFa: 'امور مالی',
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
      await page.route(/\/api\/admin\/invoices\/ledger(?:\?|$)/, (r) =>
        r.fulfill({ json: { items: [], nextCursor: null } })
      );
      let queueReads = 0,
        detailReads = 0,
        allocationReads = 0,
        failed = true;
      const historyReads: string[] = [];
      await page.route('**/api/admin/invoices/bank-receipts', (r) => {
        queueReads++;
        return r.fulfill({ json: { items: [receipt] } });
      });
      await page.route(`**/api/admin/invoices/bank-receipts/${receiptId}`, (r) => {
        detailReads++;
        return r.fulfill({ json: receipt });
      });
      await page.route(`**/api/admin/invoices/bank-receipts/${receiptId}/allocation`, (r) => {
        allocationReads++;
        return r.fulfill({
          json: {
            receiptId,
            invoiceId,
            invoiceState: 'Unpaid',
            receiptAmount: amount,
            remaining: amount,
            invoiceAllocation: amount,
            walletCreditAmount: '0',
          },
        });
      });
      await page.route(/\/api\/admin\/invoices\/bank-receipts\/history(?:\?|$)/, (r) => {
        const query = new URL(r.request().url()).searchParams;
        historyReads.push(query.toString());
        return r.fulfill({
          status: failed && query.has('beforeAt') ? 503 : 200,
          json: {
            items: [
              {
                ...receipt,
                receiptId: query.has('beforeAt') ? olderId : receiptId,
                state: 'Confirmed',
              },
            ],
            nextCursor: query.has('beforeAt') ? null : { beforeAt: stamp, beforeId: receiptId },
          },
        });
      });
      const word = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
      const tableLabel = appText('historyView.table', locale),
        cardLabel = appText('historyView.card', locale);
      await page.goto('/admin/invoices');
      await page
        .locator('#invoice-receipt-panel')
        .getByRole('button', { name: word('title'), exact: true })
        .click();
      const queue = page.getByRole('region', { name: word('title'), exact: true });
      const pending = queue.locator('[data-slot="list-page"]').first();
      await expect(pending.getByText(receiptId, { exact: true })).toBeVisible();
      const checkMetadata = async () => {
        await expect(pending.getByText(invoiceId, { exact: true })).toBeVisible();
        await expect(pending.getByText('Bank Mellat', { exact: true })).toBeVisible();
        const date = pending.locator('time[datetime="2026-09-01"]');
        await expect(date).toHaveText(
          new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', {
            dateStyle: 'medium',
            timeZone: 'UTC',
          }).format(new Date('2026-09-01T00:00:00Z'))
        );
        const submitted = await page.evaluate(
          ({ locale, stamp }) =>
            new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Pacific/Kiritimati',
            }).format(new Date(stamp)),
          { locale, stamp }
        );
        await expect(pending.locator(`time[datetime="${stamp}"]`)).toHaveText(submitted);
        const digits =
          locale === 'fa'
            ? new Intl.NumberFormat('fa-IR').format(BigInt(amount))
            : new Intl.NumberFormat('en-US').format(BigInt(amount));
        await expect(
          pending.getByText(new RegExp(digits.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        ).toBeVisible();
      };
      await checkMetadata();
      await pending.getByRole('button', { name: tableLabel, exact: true }).click();
      await expect(pending.getByRole('table').getByRole('columnheader')).toHaveCount(8);
      await checkMetadata();
      const viewport = pending.locator('[data-slot="scroll-area-viewport"]');
      await viewport.focus();
      const position = await viewport.evaluate((node) => node.scrollLeft);
      await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect.poll(() => viewport.evaluate((node) => node.scrollLeft)).not.toBe(position);
      await pending.getByRole('button', { name: word('open'), exact: true }).click();
      const detail = queue.getByRole('region', { name: word('detail'), exact: true });
      const image = detail.getByRole('img', { name: word('attachment'), exact: true });
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
        .toBe(600);
      await expect(
        detail.getByRole('link', { name: word('attachment'), exact: true })
      ).toHaveAttribute('href', receipt.attachmentUrl);
      await page.locator('#invoice-receipt-reason').fill('Keep investigation');
      const counts = [queueReads, detailReads, allocationReads];
      await pending.getByRole('button', { name: cardLabel, exact: true }).click();
      await checkMetadata();
      await expect(page.locator('#invoice-receipt-reason')).toHaveValue('Keep investigation');
      expect([queueReads, detailReads, allocationReads]).toEqual(counts);
      await queue.getByRole('button', { name: word('historyTitle'), exact: true }).click();
      const history = queue.getByRole('region', { name: word('historyTitle'), exact: true });
      await expect(history.getByText(receiptId, { exact: true })).toHaveCount(1);
      await history.getByRole('button', { name: tableLabel, exact: true }).click();
      expect(historyReads).toHaveLength(1);
      await expect(history.getByRole('table').getByRole('columnheader')).toHaveCount(8);
      await history.getByRole('button', { name: word('historyNext'), exact: true }).click();
      await expect(history.getByRole('alert')).toBeVisible();
      await expect(history.getByText(receiptId, { exact: true })).toHaveCount(1);
      const failedQuery = historyReads.at(-1);
      failed = false;
      await history
        .getByRole('button', { name: appText('historyPagination.retry', locale), exact: true })
        .click();
      await expect(history.getByText(olderId, { exact: true })).toHaveCount(1);
      expect(historyReads.at(-1)).toBe(failedQuery);
      expect(new URLSearchParams(failedQuery).get('beforeAt')).toBe(stamp);
      await history.getByRole('button', { name: cardLabel, exact: true }).click();
      await expect(history.getByRole('table')).toHaveCount(0);
      await expect(history.getByText(olderId, { exact: true })).toHaveCount(1);
      await history.getByRole('button', { name: tableLabel, exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(darkMode);
      const accessibility = await new AxeBuilder({ page })
        .include('#invoice-receipt-panel')
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await verifyClippedContrast(page, accessibility);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && info.project.name === 'mobile-safari')
        await page.screenshot({
          path: `/tmp/barghsa-staff-receipt-views-${darkMode ? 'dark' : 'light'}.png`,
          fullPage: true,
        });
      await page.reload();
      await expect(queue).toBeVisible();
      await expect(pending.getByRole('button', { name: cardLabel, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(history.getByRole('button', { name: tableLabel, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(history.getByText(olderId, { exact: true })).toHaveCount(1);
      await page.goto('/admin/invoices');
      await page
        .locator('#invoice-receipt-panel')
        .getByRole('button', { name: word('title'), exact: true })
        .click();
      await expect(pending.getByRole('button', { name: cardLabel, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });
  }

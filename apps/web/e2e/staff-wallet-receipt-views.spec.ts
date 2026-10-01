import AxeBuilder from '@axe-core/playwright';
import { t as appText } from '@barghsa/i18n/app';
import { tWalletReceipts as walletText } from '@barghsa/i18n/wallet-receipts';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { verifyClippedContrast } from './clipped-contrast';
import { bankReceiptReview } from '../src/test/bank-receipt-review-fixture';
import {
  receiptId,
  secondReceiptId,
  paymentInvoiceId,
  paymentReceipt,
} from '../src/test/payment-review-fixtures';

const base = '/api/admin/wallet/bank-receipt-top-ups';
const amount = '9007199254740993';
const receipt = {
  ...paymentReceipt,
  amount,
  bankName: 'بانک ملی',
  paymentDate: '2026-09-01',
  submittedAt: '2026-09-01T23:30:00.123456Z',
  attachmentKey: 'receipts/bank.png',
  attachmentUrl: '/mock/bank-receipt.png?signed=1',
  verificationTimeline: {
    events: [{ state: 'submitted', occurredAt: '2026-09-01T23:30:00.123456Z' }],
    awaiting: 'review',
  },
};
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const darkMode of [false, true]) {
    test(`wallet views preserve selected review, exact metadata and account preference (${locale}, dark=${darkMode})`, async ({
      page,
    }, info) => {
      await crmShell(page, locale);
      await page.route('**/api/user/settings/timezone', (r) =>
        r.fulfill({ json: { timezone: 'Pacific/Kiritimati' } })
      );
      await page.route('**/api/admin/config/wallet-top-up-limit', (r) =>
        r.fulfill({ json: { limitIrR: 2000000, version: 0 } })
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
      await page.route('**/mock/bank-receipt.png?**', (r) =>
        r.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect width="600" height="240" fill="#e8ece7"/><text x="40" y="100" fill="#203e35" font-size="32">Bank receipt fixture</text></svg>',
        })
      );
      let queueReads = 0,
        detailReads = 0,
        reviewReads = 0,
        queueStatus = 200;
      await page.route(`**${base}`, (r) => {
        queueReads++;
        return r.fulfill({
          status: queueStatus,
          json: {
            items: [
              receipt,
              {
                ...receipt,
                transactionId: secondReceiptId,
                payerReference: 'TRK-second',
                paymentDate: null,
                dualApproval: {
                  requestId: 'approval',
                  initiatorId: 'another-finance',
                  invoiceId: paymentInvoiceId,
                },
              },
            ],
          },
        });
      });
      await page.route(`**${base}/${receiptId}`, (r) => {
        detailReads++;
        return r.fulfill({ json: receipt });
      });
      await page.route(`**${base}/${receiptId}/review**`, (r) => {
        reviewReads++;
        const invoiceId = new URL(r.request().url()).searchParams.get('invoiceId');
        const review = bankReceiptReview(receiptId, invoiceId);
        review.data.receipt.amount = amount;
        review.data.receipt.bankName = receipt.bankName;
        review.data.receipt.paymentDate = receipt.paymentDate;
        review.data.receipt.submittedAt = receipt.submittedAt;
        const credit = (BigInt(amount) - BigInt(review.data.allocation.invoiceAmount)).toString();
        review.data.allocation.walletCredit = credit;
        review.data.wallet.availableAfter = (
          BigInt(review.data.wallet.availableBefore) + BigInt(credit)
        ).toString();
        return r.fulfill({ json: review });
      });
      const word = (key: string) => walletText(`admin.walletReceipts.${key}`, locale);
      const tableLabel = appText('historyView.table', locale),
        cardLabel = appText('historyView.card', locale);
      await page.goto('/admin/wallet-receipts');
      const panel = page.getByTestId('admin-wallet-receipts-page');
      const queue = panel.getByRole('navigation', { name: word('queueLabel'), exact: true });
      const confirm = page.getByTestId('wallet-receipt-confirm');
      await expect(confirm).toBeEnabled();
      await expect(queue.getByText(receiptId, { exact: true })).toBeVisible();
      await expect(queue.getByText(paymentInvoiceId, { exact: true })).toBeVisible();
      await expect(
        queue.getByText(appText('wallet.history.state.Pending', locale), { exact: true }).first()
      ).toBeVisible();
      const formattedAmount = await page.evaluate(
        ({ locale, amount }) =>
          new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(BigInt(amount)),
        { locale, amount }
      );
      await expect(queue.locator('li').first()).toContainText(`${formattedAmount} IRR`);
      await expect(queue.locator('li').first()).toContainText(receipt.bankName);
      await expect(panel.locator('dl').first()).toContainText(receipt.bankName);
      await expect(
        panel.getByRole('region', { name: word('review.title'), exact: true })
      ).toContainText(receipt.bankName);
      await expect(queue.locator('time[datetime="2026-09-01"]')).toHaveText(
        new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
          calendar: locale === 'fa' ? 'persian' : 'gregory',
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
        { locale, stamp: receipt.submittedAt }
      );
      await expect(queue.locator(`time[datetime="${receipt.submittedAt}"]`).first()).toHaveText(
        submitted
      );
      const timeline = panel.getByRole('region', {
        name: walletText('wallet.receipt.timeline', locale),
        exact: true,
      });
      await expect(timeline.getByRole('listitem')).toHaveCount(1);
      await expect(timeline.locator('time')).toHaveText(submitted);
      await expect(timeline).toContainText(walletText('wallet.receipt.awaiting.review', locale));
      const image = panel.getByRole('img', { name: word('attachmentAlt'), exact: true });
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
        .toBe(600);
      await expect(
        panel.getByRole('link', { name: word('openAttachment'), exact: true })
      ).toHaveAttribute('href', receipt.attachmentUrl);
      await page.locator('#apply-invoice-id').fill(paymentInvoiceId);
      await expect(confirm).toBeEnabled();
      await page.locator('#reject-reason').fill('Retain invoice and bank investigation');
      const reads = [queueReads, detailReads, reviewReads];
      await panel.getByRole('button', { name: tableLabel, exact: true }).click();
      await expect(queue.getByRole('columnheader')).toHaveCount(10);
      await expect(page.locator('#apply-invoice-id')).toHaveValue(paymentInvoiceId);
      await expect(page.locator('#reject-reason')).toHaveValue(
        'Retain invoice and bank investigation'
      );
      expect([queueReads, detailReads, reviewReads]).toEqual(reads);
      const viewport = queue.locator('[data-slot="scroll-area-viewport"]');
      await viewport.focus();
      await page.keyboard.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect
        .poll(() => viewport.evaluate((element) => Math.abs(element.scrollLeft)))
        .toBeGreaterThan(0);
      const accessibility = await new AxeBuilder({ page })
        .include('[data-testid="admin-wallet-receipts-page"]')
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await verifyClippedContrast(page, accessibility);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
        darkMode
      );
      if (locale === 'fa' && info.project.name === 'mobile-safari') {
        await queue.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `/tmp/barghsa-wallet-receipt-views-${darkMode ? 'dark' : 'light'}.png`,
          fullPage: true,
        });
        await image.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `/tmp/barghsa-wallet-receipt-preview-${darkMode ? 'dark' : 'light'}.png`,
        });
      }
      queueStatus = 503;
      await panel.getByRole('button', { name: word('queue.refresh'), exact: true }).click();
      await expect(
        panel.getByRole('button', { name: word('queue.retry'), exact: true })
      ).toBeVisible();
      await panel.getByRole('button', { name: cardLabel, exact: true }).click();
      await expect(page.locator('#reject-reason')).toHaveValue(
        'Retain invoice and bank investigation'
      );
      await expect(confirm).toBeDisabled();
      queueStatus = 200;
      await panel.getByRole('button', { name: word('queue.retry'), exact: true }).click();
      await expect(confirm).toBeEnabled();
      await panel.getByRole('button', { name: tableLabel, exact: true }).click();
      await page.reload();
      await expect(queue.getByRole('columnheader')).toHaveCount(10);
      await expect(panel.getByRole('button', { name: tableLabel, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });
  }

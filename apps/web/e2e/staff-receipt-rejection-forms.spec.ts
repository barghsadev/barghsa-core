import AxeBuilder from '@axe-core/playwright';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { tWalletReceipts as walletText } from '@barghsa/i18n/wallet-receipts';
import { t as appText } from '@barghsa/i18n/app';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { bankReceiptReview } from '../src/test/bank-receipt-review-fixture';

const receiptId = '91000000-0000-4000-8000-000000000001';
const invoiceId = '91000000-0000-4000-8000-000000000002';
const profileId = '91000000-0000-4000-8000-000000000003';
const amount = '250000';
const walletReceipt = {
  transactionId: receiptId,
  walletId: profileId,
  amount,
  currency: 'IRR',
  state: 'Pending',
  paymentDate: '2026-09-01',
  payerReference: 'BANK-REF',
  bankName: 'Bank Mellat',
  attachmentKey: null,
  attachmentUrl: null,
  customerNote: null,
  submittedAt: '2026-09-01T12:00:00Z',
  canDecide: true,
  staffDecision: null,
  creditTransactionId: null,
  overpayment: null,
};
const invoiceReceipt = {
  receiptId,
  invoiceId,
  profileId,
  amount,
  state: 'Submitted',
  paymentDate: '2026-09-01',
  payerReference: 'BANK-REF',
  bankName: 'Bank Mellat',
  attachmentKey: null,
  attachmentUrl: null,
  customerNote: null,
  submittedAt: '2026-09-01T12:00:00Z',
  canConfirm: false,
  canReject: true,
  rejectionReason: null,
  invoiceAllocation: null,
  walletCreditAmount: null,
  confirmedAt: null,
  requiresDualApproval: false,
  dualApprovalPending: false,
};

async function shell(page: Page, locale: 'en' | 'fa', darkMode: boolean) {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
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
  await page.route('**/api/admin/config/wallet-top-up-limit', (route) =>
    route.fulfill({ json: { limitIrR: 2000000, version: 0 } })
  );
  await page.route(/\/api\/admin\/invoices\/ledger(?:\?|$)/, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } })
  );
}
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const darkMode of [false, true])
    for (const kind of ['wallet', 'invoice'] as const) {
      test(`staff ${kind} rejection validates, retains drafts and recovers captured failures (${locale}, dark=${darkMode})`, async ({
        page,
      }, info) => {
        await shell(page, locale, darkMode);
        const base =
          kind === 'wallet'
            ? '/api/admin/wallet/bank-receipt-top-ups'
            : '/api/admin/invoices/bank-receipts';
        const receipt = kind === 'wallet' ? walletReceipt : invoiceReceipt;
        const bodies: unknown[] = [];
        const verifications: unknown[] = [];
        let saved = false;
        await page.route(new RegExp(`${base}(?:\\?|$)`), (route) =>
          route.fulfill({ json: { items: saved ? [] : [receipt] } })
        );
        await page.route(`**${base}/${receiptId}`, (route) =>
          route.fulfill({
            json: saved
              ? {
                  ...receipt,
                  state: 'Rejected',
                  canReject: false,
                  canDecide: false,
                  rejectionReason: 'Revised investigation',
                }
              : receipt,
          })
        );
        await page.route(`**${base}/${receiptId}/review**`, (route) => {
          const review = bankReceiptReview(receiptId, null, profileId);
          review.data.receipt.bankName = 'Bank Mellat';
          return route.fulfill({ json: review });
        });
        await page.route(`**${base}/${receiptId}/allocation`, (route) =>
          route.fulfill({
            json: {
              receiptId,
              invoiceId,
              invoiceState: 'Unpaid',
              receiptAmount: amount,
              remaining: amount,
              invoiceAllocation: amount,
              walletCreditAmount: '0',
            },
          })
        );
        await page.route('**/api/auth/step-up', (route) => {
          verifications.push(route.request().postDataJSON());
          return route.fulfill({ json: { verified: true } });
        });
        await page.route(`**${base}/${receiptId}/reject`, (route) => {
          bodies.push(route.request().postDataJSON());
          if (bodies.length === 1)
            return route.fulfill({
              status: 403,
              json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } },
            });
          if (bodies.length === 2)
            return route.fulfill({
              status: 400,
              json: {
                error: {
                  code: 'VALIDATION:INPUT:INVALID',
                  fields: ['reason'],
                  message: 'Private server diagnostic',
                },
              },
            });
          if (bodies.length === 3)
            return route.fulfill({
              status: 400,
              json: {
                error: {
                  code: 'VALIDATION:INPUT:INVALID',
                  fields: ['reason', 'receiptId'],
                  message: 'Private server diagnostic',
                },
              },
            });
          if (bodies.length === 4)
            return route.fulfill({ status: 503, json: { message: 'Private server diagnostic' } });
          saved = true;
          return route.fulfill({
            json: {
              ...receipt,
              state: 'Rejected',
              canDecide: false,
              canReject: false,
              rejectionReason: 'Revised investigation',
            },
          });
        });
        await page.goto(kind === 'wallet' ? '/admin/wallet-receipts' : '/admin/invoices');
        const word = (key: string) =>
          kind === 'wallet'
            ? walletText(`admin.walletReceipts.${key}`, locale)
            : adminText(`admin.invoiceReceipts.${key}`, locale);
        if (kind === 'invoice') {
          await page
            .locator('#invoice-receipt-panel')
            .getByRole('button', { name: word('title'), exact: true })
            .click();
          await page.getByRole('button', { name: word('open'), exact: true }).click();
        }
        const region =
          kind === 'wallet'
            ? page.getByTestId('admin-wallet-receipts-page')
            : page.getByRole('region', { name: word('detail'), exact: true });
        const field = page.locator(
          kind === 'wallet' ? '#reject-reason' : '#invoice-receipt-reason'
        );
        const reject = region.getByRole('button', { name: word('reject'), exact: true });
        await expect(reject).toBeEnabled();
        await reject.click();
        await expect(field).toBeFocused();
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(bodies).toHaveLength(0);
        await field.fill('   ');
        await field.blur();
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        await field.fill('  Preserve this investigation  ');
        await expect(field).not.toHaveAttribute('aria-invalid', 'true');
        const submit = async () => {
          await reject.click();
          if (kind === 'invoice')
            await page
              .getByRole('dialog')
              .getByRole('button', { name: appText('team.confirm', locale), exact: true })
              .click();
        };
        await submit();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        if (kind === 'wallet') {
          await page.getByTestId('wallet-receipt-step-up-password').fill('verified-password');
          await page.getByTestId('wallet-receipt-step-up-submit').click();
        } else {
          await dialog
            .getByLabel(appText('team.password', locale), { exact: true })
            .fill('verified-password');
          await dialog
            .getByRole('button', { name: appText('team.confirm', locale), exact: true })
            .click();
        }
        await expect(dialog).toHaveCount(0);
        await expect(field).toBeFocused();
        await expect(field).toHaveValue('  Preserve this investigation  ');
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        const feedbackId = (await field.getAttribute('aria-describedby'))!.split(' ')[0]!;
        await expect(page.locator(`[id="${feedbackId}"]`)).toContainText(
          kind === 'wallet'
            ? walletText('admin.walletReceipts.error.reason', locale)
            : adminText('admin.invoiceReceipts.invalidReason', locale)
        );
        await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
        expect(
          (
            await new AxeBuilder({ page })
              .include(
                kind === 'wallet'
                  ? '[data-testid="admin-wallet-receipts-page"]'
                  : '#invoice-receipt-panel'
              )
              .analyze()
          ).violations
        ).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        if (locale === 'fa' && darkMode && info.project.name === 'mobile-safari')
          await page.screenshot({ path: `/tmp/barghsa-staff-${kind}-rejection-validation.png` });
        await field.fill('  Revised investigation  ');
        await submit();
        await expect.poll(() => bodies.length).toBe(3);
        await expect(field).not.toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByText('Private server diagnostic', { exact: true })).toHaveCount(0);
        const retryCaptured = async () => {
          if (kind === 'invoice')
            await dialog
              .getByRole('button', { name: appText('team.confirm', locale), exact: true })
              .click();
          else await reject.click();
        };
        await retryCaptured();
        await expect.poll(() => bodies.length).toBe(4);
        await expect(field).toHaveValue('  Revised investigation  ');
        await expect(page.getByText('Private server diagnostic', { exact: true })).toHaveCount(0);
        await retryCaptured();
        await expect.poll(() => bodies.length).toBe(5);
        await expect(field).toHaveCount(0);
        expect(bodies).toEqual([
          { reason: 'Preserve this investigation' },
          { reason: 'Preserve this investigation' },
          ...Array.from({ length: 3 }, () => ({ reason: 'Revised investigation' })),
        ]);
        expect(verifications).toEqual([{ password: 'verified-password' }]);
      });
    }

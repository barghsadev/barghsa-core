import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';

const first = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const base = '/api/admin/wallet/bank-receipt-top-ups';
const receipt = (transactionId: string) => ({
  transactionId,
  walletId: first,
  amount: '250000',
  currency: 'IRR',
  state: 'Pending',
  paymentDate: '2026-09-01',
  payerReference: transactionId === first ? 'RECEIPT-A' : 'RECEIPT-B',
  attachmentKey: null,
  attachmentUrl: null,
  customerNote: null,
  submittedAt: '2026-09-01T10:00:00Z',
  canDecide: true,
  staffDecision: null,
  creditTransactionId: null,
  canEmergencyOverride: true,
  dualApproval: { requestId: transactionId, initiatorId: 'finance-1', invoiceId: null },
});

for (const locale of ['en', 'fa']) {
  test(`emergency confirmation retains receipt, reason and focus through step-up (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      const apply = () => {
        if (document.documentElement) document.documentElement.lang = value;
      };
      apply();
      new MutationObserver(apply).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'UTC' } })
    );
    await page.route('**/api/admin/config/wallet-top-up-limit', (route) =>
      route.fulfill({ json: { limitIrR: 2000000, version: 0 } })
    );
    await page.route(`**${base}`, (route) =>
      route.fulfill({ json: { items: [receipt(first), receipt(second)] } })
    );
    for (const id of [first, second])
      await page.route(`**${base}/${id}`, (route) => route.fulfill({ json: receipt(id) }));
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const actions: { url: string; body: unknown }[] = [];
    await page.route(`**${base}/*/confirm`, async (route) => {
      actions.push({
        url: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      });
      if (actions.length === 1) {
        await waiting;
        await route.fulfill({ status: 403, json: { requiresStepUp: true } });
      } else
        await route.fulfill({
          json: { ...receipt(first), state: 'Released', canDecide: false, dualApproval: null },
        });
    });
    await page.route('**/api/auth/step-up', (route) => route.fulfill({ json: { verified: true } }));
    await page.goto('/admin/wallet-receipts');
    const action = page.getByTestId('wallet-receipt-emergency-confirm');
    await expect(action).toBeDisabled();
    await expect(page.getByTestId('admin-wallet-receipts-page')).toHaveAttribute(
      'dir',
      locale === 'fa' ? 'rtl' : 'ltr'
    );
    const reason = page.getByLabel(
      locale === 'en' ? 'Emergency override reason (required)' : 'دلیل تأیید اضطراری (الزامی)'
    );
    await reason.fill('  Bank deadline; second reviewer unavailable  ');
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-testid="admin-wallet-receipts-page"]')
          .analyze()
      ).violations
    ).toEqual([]);
    await action.click();
    await expect.poll(() => actions.length).toBe(1);
    await expect(page.getByRole('button').filter({ hasText: 'RECEIPT-B' })).toBeDisabled();
    await expect(reason).toBeDisabled();
    release();
    const dialog = page.getByRole('dialog');
    const password = page.getByTestId('wallet-receipt-step-up-password');
    await expect(password).toBeFocused();
    await password.fill('Test-password-123!');
    await page.getByTestId('wallet-receipt-step-up-submit').click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .getByTestId('admin-wallet-receipts-page')
        .getByRole('status')
        .filter({
          hasText:
            locale === 'en'
              ? 'Receipt settled with emergency override.'
              : 'رسید با تأیید اضطراری تسویه شد.',
        })
    ).toBeFocused();
    expect(actions).toEqual(
      Array(2).fill({
        url: `${base}/${first}/confirm`,
        body: { emergencyOverrideReason: 'Bank deadline; second reviewer unavailable' },
      })
    );
  });
}

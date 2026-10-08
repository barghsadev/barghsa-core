import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const invoiceId = '22222222-2222-4222-8222-222222222222';
const amount = '10000000000000001';
const pdf = {
  name: 'receipt.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7 receipt'),
};

async function setup(
  page: Page,
  locale: string,
  kind: 'wallet' | 'invoice',
  loseResponse = false,
  theme: 'light' | 'dark' = 'light',
  prefill = true
) {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        isStaff: false,
        userId: profileId,
        requiresTosAcceptance: false,
        operatingContext: 'customer',
        canSwitchContext: false,
      },
    })
  );
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Receipts',
        appTitleFa: 'رسیدها',
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
        darkMode: theme === 'dark',
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId, profileType: 'INDIVIDUAL', title: 'Receipt account' }],
        activeProfileId: profileId,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'UTC' } })
  );
  await page.route(`**/api/wallet/${profileId}`, (route) =>
    route.fulfill({ json: { balance: '100', currency: 'IRR', onlineTopUpLimit: 0 } })
  );
  const receipts = new Map<string, Record<string, unknown>>();
  const invoice = {
    invoiceId,
    role: 'original',
    state: 'Unpaid',
    totalAmount: amount,
    paidAmount: '0',
    issuedAt: '2026-09-01T00:00:00Z',
    dueAt: null,
    explanation: null,
    lines: [],
    adjustmentKind: null,
  };
  await page.route(`**/api/invoices/${invoiceId}`, (route) =>
    route.fulfill({
      json: {
        invoice,
        chain: [invoice],
        viewedInvoiceId: invoiceId,
        originalInvoiceId: invoiceId,
        payments: [],
        refunds: [],
        bankReceipts: Array.from(receipts.entries()).map(([id, body]) => ({
          id,
          ...body,
          state: 'Submitted',
          rejectionReason: null,
          confirmedAt: null,
          createdAt: '2026-09-01T12:00:00Z',
        })),
      },
    })
  );
  const uploads: Record<string, unknown>[] = [];
  await page.route('**/api/upload/presigned-url', (route) => {
    uploads.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        key: `receipts/upload-${uploads.length}.pdf`,
        presignedUrl: new URL(`/__receipt-upload/${uploads.length}`, route.request().url()).href,
      },
    });
  });
  await page.route('**/__receipt-upload/*', (route) => route.fulfill({ status: 200 }));
  await page.route('**/api/upload/*/verify', (route) =>
    route.fulfill({ json: { status: 'confirmed' } })
  );
  await page.route('**/api/upload/*/record', (route) => route.fulfill({ status: 201, json: {} }));
  const submissions: { body: Record<string, unknown>; key: string | undefined }[] = [];
  const endpoint =
    kind === 'wallet'
      ? `/api/wallet/${profileId}/bank-receipt-top-ups`
      : `/api/invoices/${invoiceId}/bank-receipts`;
  if (kind === 'wallet') {
    await page.route(`**${endpoint}/review`, (route) => {
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: {
          schemaVersion: 1,
          scope: {
            action: 'wallet.bank-receipt-topup-submission',
            profileId,
            resourceId: profileId,
          },
          data: {
            profileId,
            amountIrR: body.amount,
            paymentDate: body.paymentDate,
            payerReference: body.payerReference,
            ...(body.bankName ? { bankName: body.bankName } : {}),
            attachmentKey: body.attachmentKey,
            fileName: String(body.attachmentKey).split('/').at(-1),
            fileSizeBytes: null,
            customerNote: body.customerNote ?? null,
            stateAfterSubmission: 'Pending',
            creditRule: 'after_finance_confirmation',
          },
          hash: 'a'.repeat(64),
        },
      });
    });
  } else {
    await page.route(`**${endpoint}/review`, (route) => {
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: {
          schemaVersion: 1,
          scope: {
            action: 'invoice.bank-receipt-submission',
            profileId,
            resourceId: invoiceId,
          },
          data: {
            invoiceId,
            profileId,
            invoiceState: 'Unpaid',
            invoiceTotalIrR: amount,
            invoicePaidIrR: '0',
            invoiceRemainingIrR: amount,
            amountIrR: body.amount,
            paymentDate: body.paymentDate,
            payerReference: body.payerReference,
            bankName: body.bankName ?? null,
            attachmentKey: body.attachmentKey,
            fileName: String(body.attachmentKey).split('/').at(-1),
            fileSizeBytes: null,
            customerNote: body.customerNote ?? null,
            stateAfterSubmission: 'Submitted',
            settlementRule: 'after_finance_confirmation',
            excessRule: 'confirmed_excess_to_wallet',
          },
          hash: 'a'.repeat(64),
        },
      });
    });
  }
  await page.route(`**${endpoint}`, (route) => {
    const body = route.request().postDataJSON();
    const key = route.request().headers()['idempotency-key'];
    submissions.push({ body, key });
    const identity = kind === 'wallet' ? key! : body.attachmentKey;
    const existing = receipts.get(identity);
    if (existing && JSON.stringify(existing) !== JSON.stringify(body))
      return route.fulfill({ status: 409, json: {} });
    receipts.set(identity, body);
    if (loseResponse && submissions.length === 1) return route.abort('failed');
    return route.fulfill({
      status: 201,
      json: {
        transactionId: '11111111-1111-7111-8111-111111111111',
        state: kind === 'wallet' ? 'Pending' : 'Submitted',
        amount: body.amount,
      },
    });
  });
  await page.goto(kind === 'wallet' ? '/wallet' : `/invoices/${invoiceId}`);
  const prefix = `${kind}-receipt`;
  const form = page.getByTestId(`${prefix}-form`);
  await expect(form).toBeVisible();
  if (prefill) {
    await page
      .getByTestId(`${prefix}-amount`)
      .fill(locale === 'fa' ? '۱۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۱' : '10,000,000,000,000,001');
    await page.getByTestId(`${prefix}-date`).fill('2026-09-01');
    await page.getByTestId(`${prefix}-payer-ref`).fill('  TRACK-123  ');
    await page.getByTestId(`${prefix}-note`).fill('  Customer note  ');
    await page.getByTestId(`${prefix}-file`).setInputFiles(pdf);
  }
  return { form, prefix, uploads, submissions, receipts, invoice, endpoint };
}

async function confirmReceipt(page: Page, payerReference = 'TRACK-123') {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(payerReference);
  await dialog.getByRole('button', { name: /تأیید و ثبت رسید|Confirm and submit receipt/ }).click();
}

for (const kind of ['wallet', 'invoice'] as const) {
  for (const locale of ['en', 'fa']) {
    test(`${kind} receipt retries a lost acknowledgement without creating another upload or receipt (${locale})`, async ({
      page,
    }) => {
      const { prefix, uploads, submissions, receipts } = await setup(page, locale, kind, true);
      if (kind === 'wallet')
        await page.getByTestId('wallet-receipt-bank-name').fill('  بانک ملی  ');
      await page.getByTestId(`${prefix}-submit`).click();
      if (kind === 'wallet') await expect(page.getByRole('dialog')).toContainText('بانک ملی');
      await confirmReceipt(page);
      await expect(page.getByTestId(`${prefix}-error`)).toBeVisible();
      await expect(page.getByTestId(`${prefix}-success`)).toHaveCount(0);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]!.body).toEqual({
        amount,
        paymentDate: '2026-09-01',
        payerReference: 'TRACK-123',
        customerNote: 'Customer note',
        attachmentKey: 'receipts/upload-1.pdf',
        expectedReviewHash: 'a'.repeat(64),
        ...(kind === 'wallet' ? { bankName: 'بانک ملی' } : {}),
      });
      await page.getByTestId(`${prefix}-submit`).click();
      await confirmReceipt(page);
      await expect.poll(() => submissions.length).toBe(2);
      expect(submissions[1]).toEqual(submissions[0]);
      expect(uploads).toHaveLength(1);
      expect(receipts.size).toBe(1);
      if (kind === 'invoice')
        await expect(page.getByTestId('invoice-activity').locator('li')).toHaveCount(1);
      await expect(page.getByTestId(`${prefix}-success`)).toBeVisible();
      await expect(page.getByTestId(`${prefix}-file`)).toHaveValue('');
      if (kind === 'wallet')
        await expect(page.getByTestId('wallet-balance')).toContainText(/۱۰۰|100/);
      await page.getByTestId(`${prefix}-amount`).fill('250000');
      await page.getByTestId(`${prefix}-payer-ref`).fill('TRACK-456');
      await page.getByTestId(`${prefix}-file`).setInputFiles({ ...pdf, name: 'other.pdf' });
      await page.getByTestId(`${prefix}-submit`).click();
      await confirmReceipt(page, 'TRACK-456');
      await expect.poll(() => submissions.length).toBe(3);
      await expect(page.getByTestId(`${prefix}-success`)).toBeVisible();
      expect(uploads).toHaveLength(2);
      expect(receipts.size).toBe(2);
      if (kind === 'invoice')
        await expect(page.getByTestId('invoice-activity').locator('li')).toHaveCount(2);
      if (kind === 'wallet') expect(submissions[2]!.key).not.toBe(submissions[0]!.key);
      const accessibility = await new AxeBuilder({ page })
        .include(`[data-testid="${prefix}-form"]`)
        .analyze();
      expect(accessibility.violations).toEqual([]);
    });

    test(`${kind} receipt rejects malformed amounts and files before uploading (${locale})`, async ({
      page,
    }) => {
      const { prefix, uploads, submissions } = await setup(page, locale, kind);
      for (const value of ['-10', '1.5', '1e3', '1,23', '9223372036854775808']) {
        await page.getByTestId(`${prefix}-amount`).fill(value);
        await page.getByTestId(`${prefix}-submit`).click();
        await expect(page.getByTestId(`${prefix}-amount`)).toHaveAttribute('aria-invalid', 'true');
        expect(uploads).toHaveLength(0);
        expect(submissions).toHaveLength(0);
      }
      await page.getByTestId(`${prefix}-amount`).fill('250000');
      if (kind === 'wallet') {
        const bank = page.getByTestId('wallet-receipt-bank-name');
        await expect(bank).toHaveAttribute('maxlength', '128');
        await bank.fill('Bank\tName');
        await page.getByTestId(`${prefix}-submit`).click();
        await expect(bank).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByTestId(`${prefix}-form`).getByRole('alert')).toContainText(
          locale === 'fa' ? '۱۲۸' : '128'
        );
        expect(uploads).toHaveLength(0);
        await bank.fill('');
      }
      await page.getByTestId(`${prefix}-file`).setInputFiles({ ...pdf, mimeType: 'text/plain' });
      await page.getByTestId(`${prefix}-submit`).click();
      await expect(page.getByTestId(`${prefix}-file`)).toHaveAttribute('aria-invalid', 'true');
      expect(uploads).toHaveLength(0);
      await page.getByTestId(`${prefix}-file`).setInputFiles(pdf);
      await page.getByTestId(`${prefix}-submit`).click();
      await confirmReceipt(page);
      await expect(page.getByTestId(`${prefix}-success`)).toBeVisible();
      expect(submissions).toHaveLength(1);
    });
  }
}

for (const locale of ['en', 'fa']) {
  test(`invoice activity remains readable and accessible on mobile (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { invoice } = await setup(page, locale, 'invoice');
    await page.route(`**/api/invoices/${invoiceId}`, (route) =>
      route.fulfill({
        json: {
          invoice,
          chain: [invoice],
          viewedInvoiceId: invoiceId,
          originalInvoiceId: invoiceId,
          payments: [
            {
              id: 'payment',
              amount,
              source: 'wallet',
              state: 'Completed',
              createdAt: '2026-09-01T12:00:00Z',
            },
          ],
          bankReceipts: [
            {
              id: 'receipt',
              amount,
              state: 'Rejected',
              paymentDate: '2026-09-01',
              payerReference: 'TRACK-123',
              customerNote: 'Customer note',
              rejectionReason: 'Please upload a clearer receipt.',
              confirmedAt: null,
              createdAt: '2026-09-01T12:00:00Z',
            },
          ],
          refunds: [
            {
              id: 'refund',
              amount: '250000',
              state: 'Processing',
              destination: 'external_bank',
              createdAt: '2026-09-01T12:00:00Z',
              updatedAt: '2026-09-02T12:00:00Z',
            },
          ],
        },
      })
    );
    await page.reload();
    const activity = page.getByTestId('invoice-activity');
    await expect(activity.locator('li')).toHaveCount(3);
    await expect(activity).toContainText(/۱۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۱|10,000,000,000,000,001/);
    await expect(activity).toContainText('Please upload a clearer receipt.');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="invoice-activity"]').analyze())
        .violations
    ).toEqual([]);
    await activity.screenshot({ path: `/tmp/barghsa-invoice-activity-${locale}.png` });
  });
}

for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const) {
    for (const kind of ['wallet', 'invoice'] as const)
      test(`${kind} inline receipt feedback retains exact money and file through recovery (${locale}, ${theme})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const { form, prefix, uploads, submissions, endpoint } = await setup(
          page,
          locale,
          kind,
          false,
          theme
        );
        if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
        else await expect(page.locator('html')).not.toHaveClass(/dark/);
        const payer = page.getByTestId(`${prefix}-payer-ref`),
          bank = page.getByTestId(`${prefix}-bank-name`),
          submit = page.getByTestId(`${prefix}-submit`);
        await payer.fill('');
        await bank.focus();
        await expect(payer).toHaveAttribute('aria-invalid', 'true');
        await submit.click();
        await expect(payer).toBeFocused();
        expect(uploads).toHaveLength(0);
        expect(submissions).toHaveLength(0);
        await payer.fill('TRACK-123');
        await expect(payer).not.toHaveAttribute('aria-invalid', 'true');
        let reviews = 0;
        await page.route(`**${endpoint}/review`, (route) => {
          reviews++;
          return reviews === 2
            ? route.fulfill({
                status: 400,
                json: {
                  error: {
                    code: 'VALIDATION:INPUT:INVALID',
                    fields: ['attachmentKey'],
                    message: 'private server copy',
                  },
                },
              })
            : route.fallback();
        });
        let confirmations = 0;
        await page.route(`**${endpoint}`, (route) => {
          confirmations++;
          return confirmations === 1
            ? route.fulfill({
                status: 400,
                json: {
                  error: {
                    code: 'VALIDATION:INPUT:INVALID',
                    fields: ['payerReference'],
                    message: 'private server copy',
                  },
                },
              })
            : route.fallback();
        });
        await submit.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toHaveCSS('opacity', '1');
        expect(
          (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
        ).toEqual([]);
        await confirmReceipt(page);
        await expect(dialog).toHaveCount(0);
        await expect(payer).toBeFocused();
        await expect(payer).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByTestId(`${prefix}-amount`)).toHaveValue(amount);
        await expect(page.getByTestId(`${prefix}-note`)).toHaveValue('  Customer note  ');
        await expect(page.getByTestId(`${prefix}-file`)).not.toHaveValue('');
        await expect(form).not.toContainText('private server copy');
        expect(
          (await new AxeBuilder({ page }).include(`[data-testid="${prefix}-form"]`).analyze())
            .violations
        ).toEqual([]);
        if (locale === 'fa' && theme === 'dark')
          await form.screenshot({
            path: `/tmp/barghsa-${prefix}-validation-${test.info().project.name}.png`,
          });
        await payer.fill('TRACK-456');
        await submit.click();
        const file = page.getByTestId(`${prefix}-file`);
        await expect(file).toHaveAttribute('aria-invalid', 'true');
        await expect(file).toBeFocused();
        expect(uploads).toHaveLength(1);
        await expect(file).not.toHaveValue('');
        await submit.click();
        await confirmReceipt(page, 'TRACK-456');
        await expect(page.getByTestId(`${prefix}-success`)).toBeVisible();
        expect(uploads).toHaveLength(2);
        expect(submissions).toHaveLength(1);
        expect(submissions[0]!.body.amount).toBe(amount);
        expect(submissions[0]!.body.attachmentKey).toBe('receipts/upload-2.pdf');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
      });

    test(`online wallet validation corrects a stale limit and retries without duplicate writes (${locale}, ${theme})`, async ({
      page,
    }) => {
      await setup(page, locale, 'wallet', false, theme);
      await page.route(`**/api/wallet/${profileId}`, (route) =>
        route.fulfill({
          json: { balance: '100', currency: 'IRR', onlineTopUpLimit: 1000, configVersion: 1 },
        })
      );
      let reviews = 0;
      await page.route(`**/api/wallet/${profileId}/top-ups/review`, (route) => {
        reviews++;
        const body = route.request().postDataJSON();
        if (reviews === 1)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                message: 'Amount exceeds limit',
                onlineTopUpLimit: 500,
                configVersion: 2,
              },
            },
          });
        return route.fulfill({
          json: {
            schemaVersion: 1,
            scope: { action: 'wallet.online-topup-initiation', profileId, resourceId: profileId },
            data: {
              profileId,
              amountIrR: String(body.amount),
              onlineTopUpLimitIrR: '500',
              configVersion: 2,
              paymentSource: 'external_gateway',
              stateAfterInitiation: 'Pending',
              creditRule: 'after_verified_gateway_payment',
            },
            hash: 'a'.repeat(64),
          },
        });
      });
      const writes: unknown[] = [];
      await page.route(`**/api/wallet/${profileId}/top-ups`, (route) => {
        writes.push(route.request().postDataJSON());
        return route.fulfill({ status: 502, json: {} });
      });
      await page.reload();
      const input = page.getByTestId('wallet-amount'),
        submit = page.getByTestId('wallet-submit');
      await input.fill('1e3');
      await submit.focus();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await submit.click();
      await expect(input).toBeFocused();
      expect(reviews).toBe(0);
      expect(writes).toHaveLength(0);
      await input.fill(locale === 'fa' ? '۷۵۰' : '750');
      await submit.click();
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#top-up-amount-hint')).toContainText(/۵۰۰|500/);
      await expect(input).toHaveValue('750');
      expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
      await input.fill('250');
      await submit.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCSS('opacity', '1');
      await dialog
        .getByRole('button', { name: /تأیید و رفتن به درگاه|Confirm and open gateway/ })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('wallet-error')).toBeVisible();
      await expect(input).toHaveValue('250');
      await expect(submit).toBeEnabled();
      await submit.click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /تأیید و رفتن به درگاه|Confirm and open gateway/ })
        .click();
      await expect.poll(() => writes.length).toBe(2);
      expect(writes[1]).toEqual(writes[0]);
    });
  }

for (const locale of ['en', 'fa'] as const)
  test(`wallet loads validation assets only on interaction (${locale})`, async ({ page }) => {
    const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8')) as Record<
      string,
      { file: string }
    >;
    const asset = manifest['src/lib/customer-finance-form-schemas.ts']!.file;
    const paymentReturnAsset = manifest['src/components/OnlinePaymentReturnPanel.tsx']!.file;
    const requests: string[] = [];
    const paymentReturnRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/' + asset)) requests.push(request.url());
      if (new URL(request.url()).pathname.endsWith('/' + paymentReturnAsset))
        paymentReturnRequests.push(request.url());
    });
    await setup(page, locale, 'wallet', false, 'light', false);
    expect(requests).toHaveLength(0);
    expect(paymentReturnRequests).toHaveLength(0);
    const payer = page.getByTestId('wallet-receipt-payer-ref');
    await payer.focus();
    await page.getByTestId('wallet-receipt-bank-name').focus();
    await expect(payer).toHaveAttribute('aria-invalid', 'true');
    expect(requests).toHaveLength(1);
    await page.getByTestId('wallet-receipt-amount').fill('250');
    await expect(page.getByTestId('wallet-receipt-form')).not.toContainText('private server copy');
    expect(paymentReturnRequests).toHaveLength(0);
  });

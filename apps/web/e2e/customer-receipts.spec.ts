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

async function setup(page: Page, locale: string, kind: 'wallet' | 'invoice', loseResponse = false) {
  await page.addInitScript((value) => {
    const apply = () => {
      if (document.documentElement) document.documentElement.lang = value;
    };
    apply();
    new MutationObserver(apply).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: profileId, requiresTosAcceptance: false } })
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
      json: { invoice, chain: [invoice], viewedInvoiceId: invoiceId, originalInvoiceId: invoiceId },
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
  const receipts = new Map<string, Record<string, unknown>>();
  const endpoint =
    kind === 'wallet'
      ? `/api/wallet/${profileId}/bank-receipt-top-ups`
      : `/api/invoices/${invoiceId}/bank-receipts`;
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
      json: { state: kind === 'wallet' ? 'Pending' : 'Submitted', amount: body.amount },
    });
  });
  await page.goto(kind === 'wallet' ? '/wallet' : `/invoices/${invoiceId}`);
  const prefix = `${kind}-receipt`;
  const form = page.getByTestId(`${prefix}-form`);
  await expect(form).toBeVisible();
  await page
    .getByTestId(`${prefix}-amount`)
    .fill(locale === 'fa' ? '۱۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۱' : '10,000,000,000,000,001');
  await page.getByTestId(`${prefix}-date`).fill('2026-09-01');
  await page.getByTestId(`${prefix}-payer-ref`).fill('  TRACK-123  ');
  await page.getByTestId(`${prefix}-note`).fill('  Customer note  ');
  await page.getByTestId(`${prefix}-file`).setInputFiles(pdf);
  return { form, prefix, uploads, submissions, receipts };
}

for (const kind of ['wallet', 'invoice'] as const) {
  for (const locale of ['en', 'fa']) {
    test(`${kind} receipt retries a lost acknowledgement without creating another upload or receipt (${locale})`, async ({
      page,
    }) => {
      const { prefix, uploads, submissions, receipts } = await setup(page, locale, kind, true);
      await page.getByTestId(`${prefix}-submit`).click();
      await expect(page.getByTestId(`${prefix}-error`)).toBeVisible();
      await expect(page.getByTestId(`${prefix}-success`)).toHaveCount(0);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]!.body).toEqual({
        amount,
        paymentDate: '2026-09-01',
        payerReference: 'TRACK-123',
        customerNote: 'Customer note',
        attachmentKey: 'receipts/upload-1.pdf',
      });
      await page.getByTestId(`${prefix}-submit`).click();
      await expect.poll(() => submissions.length).toBe(2);
      expect(submissions[1]).toEqual(submissions[0]);
      expect(uploads).toHaveLength(1);
      expect(receipts.size).toBe(1);
      await expect(page.getByTestId(`${prefix}-success`)).toBeVisible();
      await expect(page.getByTestId(`${prefix}-file`)).toHaveValue('');
      if (kind === 'wallet')
        await expect(page.getByTestId('wallet-balance')).toContainText(
          locale === 'fa' ? '۱۰۰' : '100'
        );
      await page.getByTestId(`${prefix}-amount`).fill('250000');
      await page.getByTestId(`${prefix}-payer-ref`).fill('TRACK-456');
      await page.getByTestId(`${prefix}-file`).setInputFiles({ ...pdf, name: 'other.pdf' });
      await page.getByTestId(`${prefix}-submit`).click();
      await expect.poll(() => submissions.length).toBe(3);
      await expect(page.getByTestId(`${prefix}-success`)).toBeVisible();
      expect(uploads).toHaveLength(2);
      expect(receipts.size).toBe(2);
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
      await page.getByTestId(`${prefix}-file`).setInputFiles({ ...pdf, mimeType: 'text/plain' });
      await page.getByTestId(`${prefix}-submit`).click();
      await expect(page.getByTestId(`${prefix}-file`)).toHaveAttribute('aria-invalid', 'true');
      expect(uploads).toHaveLength(0);
      await page.getByTestId(`${prefix}-file`).setInputFiles(pdf);
      await page.getByTestId(`${prefix}-submit`).click();
      await expect(page.getByTestId(`${prefix}-success`)).toBeVisible();
      expect(submissions).toHaveLength(1);
    });
  }
}

import { formatBrowserDate } from './browser-date';
import { test, expect, type Page } from './coverage-fixture';

const id = '11111111-1111-4111-8111-111111111111';
const stamp = '2026-09-01T01:00:00Z';
const zone = 'America/Los_Angeles';
async function shell(page: Page, locale: string) {
  await page.addInitScript((value) => {
    if (document.documentElement) document.documentElement.lang = value;
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = value;
    }).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: zone } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id, profileType: 'INDIVIDUAL', title: 'Date account' }],
        activeProfileId: id,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/profiles/ownership-transfers', (route) =>
    route.fulfill({ json: { transfers: [] } })
  );
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], unread_count: 0 } })
  );
}
const expected = async (page: Page, locale: string) =>
  await formatBrowserDate(
    page,
    locale,
    {
      timeZone: zone,
      dateStyle: 'medium',
      timeStyle: 'short',
    },
    stamp
  );
for (const locale of ['en', 'fa']) {
  test(`invoice list and correction chain show saved account time (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const invoice = {
      invoiceId: id,
      role: 'original',
      state: 'Paid',
      totalAmount: '100000',
      paidAmount: '100000',
      issuedAt: stamp,
      dueAt: stamp,
      explanation: null,
      lines: [],
      adjustmentKind: null,
    };
    await page.route('**/api/invoices', (route) =>
      route.fulfill({ json: { invoices: [invoice] } })
    );
    await page.route(`**/api/invoices/${id}`, (route) =>
      route.fulfill({
        json: { invoice, chain: [invoice], viewedInvoiceId: id, originalInvoiceId: id },
      })
    );
    await page.goto('/invoices');
    await expect(page.locator('main')).toContainText(await expected(page, locale));
    await page.locator(`main a[href="/invoices/${id}"]`).click();
    const card = page.getByTestId(`invoice-card-${id}`);
    await expect(card).toContainText(await expected(page, locale));
    await expect(card.locator('dd').filter({ hasText: await expected(page, locale) })).toHaveCount(
      2
    );
  });
  test(`receipt submission uses account time while payment day stays fixed (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const receipt = {
      transactionId: id,
      walletId: id,
      amount: '100000',
      currency: 'IRR',
      state: 'Released',
      paymentDate: '2026-09-01',
      submittedAt: stamp,
      payerReference: 'TRK-date',
      canDecide: false,
      attachmentKey: null,
      attachmentUrl: null,
      customerNote: null,
      staffDecision: null,
    };
    await page.route('**/api/admin/config/wallet-top-up-limit', (route) =>
      route.fulfill({ json: { limitIrR: 2000000, version: 0 } })
    );
    await page.route('**/api/admin/wallet/bank-receipt-top-ups', (route) =>
      route.fulfill({ json: { items: [receipt] } })
    );
    await page.route(`**/api/admin/wallet/bank-receipt-top-ups/${id}`, (route) =>
      route.fulfill({ json: receipt })
    );
    await page.goto('/admin/wallet-receipts');
    const details = page.locator('section[aria-labelledby="receipt-review-heading"]');
    await expect(details).toContainText(await expected(page, locale));
    await expect(details).toContainText(
      await formatBrowserDate(
        page,
        locale === 'en' ? 'en-GB' : 'fa-IR',
        {
          timeZone: 'UTC',
          dateStyle: 'medium',
        },
        '2026-09-01T00:00:00Z'
      )
    );
  });
}

for (const locale of ['en', 'fa']) {
  test(`due override uses account wall clock, rejects gaps and binds edits to their timezone (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let accountZone = zone;
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: accountZone } })
    );
    await page.route('**/api/admin/config/invoice-reminder-offsets', (route) =>
      route.fulfill({ json: [] })
    );
    let dueAt = '2026-11-01T08:30:45.000Z';
    const writes: { dueAt: string; reason: string }[] = [];
    await page.route(`**/api/admin/invoices/${id}/due-at`, (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        writes.push(body);
        dueAt = body.dueAt;
      }
      return route.fulfill({
        json: {
          invoiceId: id,
          issuedAt: stamp,
          payableFrom: stamp,
          dueAt,
          state: 'Unpaid',
          canOverride: true,
          dueAtOverride: null,
        },
      });
    });
    await page.goto('/admin/invoices');
    await page.locator('#invoice-id').fill(id);
    const load = page
      .locator('#invoice-id')
      .locator('..')
      .locator('..')
      .getByRole('button', {
        name: locale === 'fa' ? 'بارگذاری' : 'Load',
        exact: true,
      });
    await expect(page.getByRole('table')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
      )
      .toBeLessThanOrEqual(1);
    await load.click();
    const input = page.locator('#due-at');
    const form = input.locator('..').locator('..');
    const save = form.locator('button[type=submit]');
    await expect(input).toHaveValue('2026-11-01T01:30');
    await page.locator('#override-reason').fill('Customer requested corrected deadline');
    await save.click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]!.dueAt).toBe('2026-11-01T08:30:45.000Z');
    await input.fill('2026-03-08T02:30');
    await save.click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(writes).toHaveLength(1);
    await input.fill('2026-11-02T10:15');
    await save.click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]!.dueAt).toBe('2026-11-02T18:15:00.000Z');
    accountZone = 'Asia/Tokyo';
    await page.evaluate(() => window.dispatchEvent(new Event('barghsa:timezone-changed')));
    await expect(input).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(form.getByRole('alert')).toBeVisible();
    await load.click();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('2026-11-03T03:15');
    expect(writes).toHaveLength(2);
  });
}

import { test, expect, type Page } from './coverage-fixture';
const id = '11111111-1111-4111-8111-111111111111';
const request = {
  id,
  actionType: 'bank_payment_confirmation',
  amountIrR: '10000000000000001',
  initiatorId: 'initiator',
  initiatorUsername: 'finance@example.test',
  reason: 'Bank evidence reviewed',
  status: 'pending',
  reviewerId: null,
  reviewerUsername: null,
  reviewReason: null,
  details: { entityType: 'wallet_bank_receipt' },
};
async function shell(page: Page, locale = 'en') {
  await page.addInitScript((value) => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = value;
    }).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
}
for (const locale of ['fa', 'en']) {
  test(`approval retains exact amount and request across step-up (${locale})`, async ({ page }) => {
    await shell(page, locale);
    let verified = false,
      resolved = false;
    const actions: string[] = [];
    await page.route('**/api/admin/approval-requests?*', (route) =>
      route.fulfill({ json: resolved ? [] : [request] })
    );
    await page.route(`**/api/admin/approval-requests/${id}/approve`, (route) => {
      actions.push(route.request().url());
      if (!verified) return route.fulfill({ status: 403, json: { requiresStepUp: true } });
      resolved = true;
      return route.fulfill({ json: { ...request, status: 'approved' } });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = true;
      return route.fulfill({ json: { verified: true } });
    });
    await page.goto('/admin/approval-requests');
    await expect(
      page.locator('dd').filter({
        hasText: new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(
          10000000000000001n
        ),
      })
    ).toHaveCount(1);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Approve', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(id);
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await dialog
      .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Test-password-123!');
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toBe(actions[1]);
    await expect(page.getByRole('status')).toContainText(
      locale === 'fa' ? 'باید در روند مربوط به خود تکمیل شود' : 'must still be completed'
    );
  });
}
test('rejection requires a reason and conflict never reports success', async ({ page }) => {
  await shell(page);
  await page.route('**/api/admin/approval-requests?*', (route) =>
    route.fulfill({ json: [request] })
  );
  await page.route(`**/api/admin/approval-requests/${id}/reject`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ reason: 'Evidence does not match' });
    return route.fulfill({ status: 409, json: {} });
  });
  await page.goto('/admin/approval-requests');
  await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
  await page.getByLabel('Reason for rejection').fill('  Evidence does not match  ');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already reviewed');
  await expect(page.getByText('Decision saved.', { exact: false })).toHaveCount(0);
});
test('pagination and history expose no decision controls', async ({ page }) => {
  await shell(page);
  await page.route('**/api/admin/approval-requests?*', (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get('status');
    if (status === 'approved')
      return route.fulfill({
        json: [
          { ...request, status, reviewerId: 'reviewer', reviewerUsername: 'reviewer@example.test' },
        ],
      });
    return route.fulfill({
      json:
        url.searchParams.get('offset') === '0'
          ? Array.from({ length: 26 }, (_, n) => ({ ...request, id: `${id}-${n}` }))
          : [],
    });
  });
  await page.goto('/admin/approval-requests');
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(25);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('No requests in this queue.')).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('approved');
  await expect(page.getByText('reviewer@example.test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
});
test('an obsolete pending response cannot replace selected history', async ({ page }) => {
  await shell(page);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/admin/approval-requests?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('status') === 'pending') {
      started();
      await pending;
      await route.fulfill({ json: [request] });
    } else await route.fulfill({ json: [] });
  });
  await page.goto('/admin/approval-requests');
  await arrived;
  await page.getByLabel('Status', { exact: true }).selectOption('rejected');
  await expect(page.getByText('No requests in this queue.')).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});

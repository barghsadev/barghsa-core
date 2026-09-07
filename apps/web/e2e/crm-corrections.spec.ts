import { test, expect, type Page } from './coverage-fixture';
const profileId = '11111111-1111-4111-8111-111111111111',
  caseId = '22222222-2222-4222-8222-222222222222';
const key = 'uploads/document/33333333-3333-4333-8333-333333333333.pdf';
const item = {
  id: caseId,
  profileId,
  fieldName: 'first_name',
  requestedValue: 'Corrected',
  reason: 'Document checked',
  status: 'Under Review',
  createdBy: 'creator',
};
async function shell(page: Page, locale = 'en') {
  await page.addInitScript((value) => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = value;
    }).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route(`**/api/crm/profiles/${profileId}`, (route) =>
    route.fulfill({ json: { profile: { profileType: 'INDIVIDUAL' } } })
  );
}
for (const locale of ['en', 'fa'])
  test(`correction evidence and target survive password confirmation (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let verified = false,
      created = false,
      uploads = 0;
    const bodies: unknown[] = [];
    await page.route('**/api/crm/verification-cases?*', (route) =>
      route.fulfill({
        json: {
          cases: created ? [{ ...item, status: 'Open' }] : [],
          total: created ? 1 : 0,
          viewer: { userId: 'creator', canCreate: true, canReview: true },
        },
      })
    );
    await page.route('**/api/upload/presigned-url', (route) =>
      route.fulfill({ json: { key, presignedUrl: '/test-evidence-upload' } })
    );
    await page.route('**/test-evidence-upload', (route) => {
      uploads++;
      return route.fulfill({ status: 200, body: '' });
    });
    await page.route('**/api/upload/*/verify', (route) =>
      route.fulfill({ json: { status: 'confirmed' } })
    );
    await page.route('**/api/upload/*/record', (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        profileId,
        purpose: 'verification_evidence',
      });
      return route.fulfill({ json: { status: 'recorded' } });
    });
    await page.route(`**/api/crm/profiles/${profileId}/verification-cases`, (route) => {
      bodies.push(route.request().postDataJSON());
      if (!verified) return route.fulfill({ status: 403, json: { requiresStepUp: true } });
      created = true;
      return route.fulfill({ status: 201, json: { success: true, id: caseId, status: 'Open' } });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = true;
      return route.fulfill({ json: { verified: true } });
    });
    await page.goto(`/admin/crm/corrections?profileId=${profileId}`);
    await page.locator('#correction-value').fill('Corrected');
    await page.locator('#correction-reason').fill('Document checked');
    await page.locator('#correction-files').setInputFiles({
      name: 'evidence.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nEvidence'),
    });
    await page
      .getByRole('button', {
        name:
          locale === 'fa' ? 'بارگذاری مدارک و بررسی درخواست' : 'Upload evidence and review request',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(profileId);
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
    expect(uploads).toBe(1);
    expect(bodies).toEqual(
      Array.from({ length: 2 }, () => ({
        fieldName: 'first_name',
        requestedValue: 'Corrected',
        reason: 'Document checked',
        evidenceUrls: [key],
      }))
    );
  });
test('correction reviewer sees fixed evidence and legacy cases stay blocked', async ({ page }) => {
  await shell(page);
  let legacy = false;
  await page.route('**/api/crm/verification-cases?*', (route) =>
    route.fulfill({
      json: {
        cases: [item],
        total: 1,
        viewer: { userId: 'reviewer', canCreate: false, canReview: true },
      },
    })
  );
  await page.route(`**/api/crm/verification-cases/${caseId}`, (route) =>
    route.fulfill({
      json: {
        ...item,
        currentValue: 'Original',
        evidenceUrls: ['verification-evidence/fixed'],
        evidenceDownloadUrls: legacy ? [] : ['https://storage.example.test/fixed?signature=test'],
        reviewerNotes: null,
      },
    })
  );
  await page.route(`**/api/crm/verification-cases/${caseId}/status`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ decision: 'Approved' });
    return route.fulfill({ json: { success: true } });
  });
  await page.goto('/admin/crm/corrections');
  await page.getByRole('button', { name: 'Review case', exact: true }).click();
  await expect(page.getByText('Original', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open evidence 1' })).toHaveAttribute(
    'href',
    'https://storage.example.test/fixed?signature=test'
  );
  await page.getByRole('button', { name: 'Review decision', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  legacy = true;
  await page.getByRole('button', { name: 'Review case', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review decision', exact: true })).toBeDisabled();
  await expect(page.getByText('Fixed evidence is unavailable.', { exact: false })).toBeVisible();
  await page.locator('#case-decision').selectOption('Rejected');
  await expect(page.getByRole('button', { name: 'Review decision', exact: true })).toBeDisabled();
  await page.locator('#case-notes').fill('Resubmit evidence');
  await expect(page.getByRole('button', { name: 'Review decision', exact: true })).toBeEnabled();
});

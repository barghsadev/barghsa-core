import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/documents';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
for (const locale of ['en', 'fa'] as const) {
  const words = locale === 'fa' ? fa : en;
  const confirm = locale === 'fa' ? 'تأیید' : 'Confirm';
  test(`${locale}: staff review keeps the same revision through password verification`, async ({
    page,
  }) => {
    await page.addInitScript((language) => {
      if (document.documentElement) document.documentElement.lang = language;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = language;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    let current = {
      id: ID,
      profileId: PROFILE,
      businessRecordType: 'standalone',
      businessRecordId: null,
      contractVersionId: null,
      contractRole: null,
      category: 'document',
      state: 'SubmittedForReview',
      originalName: 'review.pdf',
      detectedMime: 'application/pdf',
      sizeBytes: 8,
      uploadedBy: 'owner',
      uploadedByType: 'customer',
      supersedesDocumentId: null,
      rejectionReason: null,
      reviewComment: null,
      revision: 4,
      checksum: 'a'.repeat(64),
      createdAt: '2026-09-21T00:00:00Z',
      updatedAt: '2026-09-21T00:00:00Z',
    };
    let verified = false;
    const attempts: unknown[] = [];
    await page.route('**/api/admin/documents?*', (route) =>
      route.fulfill({
        json: {
          documents: current.state === 'SubmittedForReview' ? [current] : [],
          nextBefore: null,
        },
      })
    );
    await page.route(`**/api/admin/documents/${ID}`, (route) =>
      route.fulfill({
        json: {
          ...current,
          history: [
            { id: 'event', state: current.state, createdAt: current.createdAt, reason: null },
          ],
        },
      })
    );
    await page.route(`**/api/admin/documents/${ID}/approve`, (route) => {
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      current = { ...current, state: 'Approved', revision: 5 };
      return route.fulfill({ json: current });
    });
    await page.route('**/api/auth/step-up', (route) => {
      expect(route.request().postDataJSON()).toEqual({ password: 'Test-password' });
      verified = true;
      return route.fulfill({ json: { verified: true } });
    });
    await page.goto('/admin/documents');
    await page.getByRole('button', { name: 'review.pdf', exact: true }).click();
    const detail = page.getByRole('region', { name: words.details });
    await detail.getByRole('button', { name: words.approve, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: confirm, exact: true }).click();
    await dialog
      .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password', {
        exact: true,
      })
      .fill('Test-password');
    await dialog.getByRole('button', { name: confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(detail.getByText(words.Approved, { exact: true }).first()).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[1]).toMatchObject({ expectedRevision: 4, idempotencyKey: expect.any(String) });
  });
  test(`${locale}: customer uploads a document and submits its displayed revision`, async ({
    page,
  }) => {
    await page.addInitScript((language) => {
      if (document.documentElement) document.documentElement.lang = language;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = language;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [
            {
              id: PROFILE,
              title: 'Test profile',
              profileType: 'LEGAL',
              status: 'ACTIVE',
              isDefault: true,
            },
          ],
          activeProfileId: PROFILE,
          hasDefault: true,
        },
      })
    );
    let current = {
      id: ID,
      profileId: PROFILE,
      businessRecordType: 'standalone',
      businessRecordId: null,
      contractVersionId: null,
      contractRole: null,
      category: 'document',
      state: 'Uploading',
      originalName: 'proof.pdf',
      detectedMime: null as string | null,
      sizeBytes: 8,
      uploadedBy: 'owner',
      uploadedByType: 'customer',
      supersedesDocumentId: null,
      rejectionReason: null,
      reviewComment: null,
      revision: 1,
      checksum: null as string | null,
      createdAt: '2026-09-21T00:00:00Z',
      updatedAt: '2026-09-21T00:00:00Z',
    };
    let created = false,
      stored = false;
    await page.route('**/api/documents?*', (route) =>
      route.fulfill({
        json: {
          documents: created ? [current] : [],
          nextBefore: null,
        },
      })
    );
    await page.route('**/api/documents', async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toMatchObject({
        profileId: PROFILE,
        fileName: 'proof.pdf',
      });
      created = true;
      await route.fulfill({
        status: 201,
        json: {
          document: current,
          upload: {
            presignedUrl: new URL('/document-storage/proof', page.url()).href,
            headers: { 'If-None-Match': '*' },
          },
        },
      });
    });
    await page.route('**/document-storage/proof', async (route) => {
      expect(route.request().method()).toBe('PUT');
      expect(route.request().headers()['x-csrf-token']).toBeUndefined();
      expect(route.request().postDataBuffer()?.toString()).toBe('%PDF-1.7');
      stored = true;
      await route.fulfill({ status: 200, body: '' });
    });
    await page.route(`**/api/documents/${ID}/confirm`, (route) => {
      expect(stored).toBe(true);
      expect(route.request().postDataJSON()).toMatchObject({ expectedRevision: 1 });
      current = {
        ...current,
        state: 'Available',
        revision: 3,
        detectedMime: 'application/pdf',
        checksum: 'a'.repeat(64),
      };
      return route.fulfill({ json: current });
    });
    await page.route(`**/api/documents/${ID}`, (route) =>
      route.fulfill({
        json: {
          ...current,
          history: [
            {
              id: 'event',
              state: current.state,
              createdAt: current.createdAt,
              reason: null,
            },
          ],
        },
      })
    );
    await page.route(`**/api/documents/${ID}/submit`, (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ expectedRevision: 3 });
      current = { ...current, state: 'SubmittedForReview', revision: 4 };
      return route.fulfill({ json: current });
    });
    await page.goto('/documents');
    await expect(page.getByRole('heading', { name: words.title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: words.upload, exact: true }).click();
    const upload = page.getByRole('region', { name: words.upload });
    await upload.getByLabel(words.file, { exact: true }).setInputFiles({
      name: 'proof.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7'),
    });
    await upload.getByRole('button', { name: words.upload, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: confirm, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: words.uploadComplete })).toBeVisible();
    const detail = page.getByRole('region', { name: words.details });
    await expect(detail.getByRole('heading', { name: 'proof.pdf' })).toBeVisible();
    await detail.getByRole('button', { name: words.submit, exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').getByRole('button', { name: confirm, exact: true }).click();
    await expect(detail.getByText(words.SubmittedForReview, { exact: true }).first()).toBeVisible();
    await expect(
      page
        .locator('[dir]')
        .filter({ has: page.getByRole('heading', { name: words.title, exact: true }) })
        .last()
    ).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
  });
}

import { confirmationText } from '@barghsa/i18n/confirmation';
import { documentText } from '@barghsa/i18n/documents';
import { tSolar } from '@barghsa/i18n/solar';
import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';
import { solarProfile } from '../src/test/solar-staff-fixtures.js';
import { postalSiteAddress, setupSolarPostalForms } from './solar-postal-form-fixture';
import { test, expect, pdfPreviewFixture } from './upload-fixture';

test('solar site document pages keep replacement and upload bound to the same request', async ({
  page,
  uploadReceiver,
}) => {
  const locale = 'fa';
  const copy = (key: string) => tSolar(key, locale);
  const docs = (key: string) => documentText(key, locale);
  const { firstSolar, olderSolar } = await setupSolarPostalForms(page, locale, false, true);
  const request = `/solar/requests/${firstSolar}`;
  const queue = `${request}/documents`;
  const id = 'c0000000-0000-4000-8000-000000000001';
  const newId = 'c0000000-0000-4000-8000-000000000002';
  const original = {
    id,
    profileId: solarProfile,
    businessRecordType: 'solar_request',
    businessRecordId: firstSolar,
    category: 'document',
    originalName: 'site-plan.pdf',
    state: 'Rejected',
    uploadedByType: 'customer',
    detectedMime: 'application/pdf',
    revision: 4,
    sizeBytes: 300,
    createdAt: '2026-09-23T10:00:00.000Z',
    permissions: { download: true, write: true, replace: true, remove: true },
  };
  const file = pdfPreviewFixture();
  const successor = {
    ...original,
    id: newId,
    originalName: 'revised-site-plan.pdf',
    supersedesDocumentId: id,
    sizeBytes: file.length,
    revision: 1,
  };
  let phase = 'changes_requested';
  let wrongRequest = false;
  let confirmed = false;
  let policyReads = 0;
  await page.route(`**/api${request}`, (route) =>
    route.fulfill({
      json: {
        request: {
          id: firstSolar,
          profile_id: solarProfile,
          status: phase,
          site_address: postalSiteAddress.fa,
          submitted_at: original.createdAt,
        },
      },
    })
  );
  const wanted = 'نقشه به‌روز محل نصب';
  await page.route(`**/api${queue}`, (route) =>
    route.fulfill({
      json: {
        guidance: {
          fa: 'نقشه محل را بررسی و بارگذاری کنید.',
          en: 'Upload a site plan.',
          suggestions: [],
        },
        requestedDocuments: [{ id: 'request-plan', description: wanted }],
      },
    })
  );
  await page.route('**/api/documents?*', (route) =>
    route.fulfill({
      json: {
        documents: confirmed ? [{ ...successor, state: 'Available', revision: 2 }] : [original],
        nextBefore: null,
      },
    })
  );
  await page.route(`**/api/documents/${id}`, (route) =>
    route.fulfill({
      json: { ...original, businessRecordId: wrongRequest ? olderSolar : firstSolar, history: [] },
    })
  );
  await page.route('**/api/upload/policy/document', (route) => {
    policyReads++;
    return route.fulfill({ json: documentUploadPolicy('document') });
  });
  await page.route('**/api/documents', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      profileId: solarProfile,
      businessRecordType: 'solar_request',
      businessRecordId: firstSolar,
      supersedesDocumentId: id,
      category: 'document',
      fileName: successor.originalName,
    });
    return route.fulfill({
      json: {
        document: { ...successor, state: 'PendingUpload' },
        upload: { presignedUrl: uploadReceiver.url, headers: { 'If-None-Match': '*' } },
      },
    });
  });
  await page.route(`**/api/documents/${newId}/confirm`, (route) => {
    confirmed = true;
    return route.fulfill({ json: { ...successor, state: 'Available', revision: 2 } });
  });

  const replacement = `${queue}/${id}/replace`;
  const editor = page.locator('[data-slot="solar-document-editor"]');
  phase = 'waiting_for_postal_submission';
  await page.goto(`${queue}/new`);
  await expect(page.getByText(copy('documentStageUnavailable'), { exact: true })).toBeVisible();
  expect(policyReads).toBe(0);

  phase = 'changes_requested';
  wrongRequest = true;
  await page.goto(`${queue}/${id}`);
  await expect(
    page.getByRole('region', { name: docs('details'), exact: true }).getByRole('alert')
  ).toContainText(docs('denied'));
  await page.goto(replacement);
  await expect(editor.getByRole('alert')).toContainText(docs('denied'));
  expect(policyReads).toBe(0);

  wrongRequest = false;
  await page.goto(queue);
  const review = page.getByRole('region', { name: copy('documentGuidance'), exact: true });
  const reviewSubmission = review.getByRole('link', { name: copy('reviewDocumentSet') });
  const all = page.getByRole('checkbox', { name: copy('allUploaded'), exact: true });
  await expect(all).toHaveCount(0);
  await reviewSubmission.click();
  await expect(page).toHaveURL(`${queue}/review`);
  await expect(
    page.getByRole('heading', { name: copy('reviewDocumentSet'), exact: true })
  ).toBeFocused();
  await expect(page.getByText(original.originalName, { exact: true })).toBeVisible();
  await expect(page.getByText(wanted, { exact: true })).toBeVisible();
  await expect(page.getByText(postalSiteAddress.fa, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: docs('upload'), exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: docs('replace'), exact: true })).toHaveCount(0);
  const submission = page.getByRole('button', { name: copy('sendReview'), exact: true });
  await expect(submission).toBeDisabled();
  await all.check();
  await expect(submission).toBeEnabled();
  await page.getByRole('link', { name: copy('backToSolarDocuments'), exact: true }).click();
  await review.getByRole('link', { name: docs('upload'), exact: true }).click();
  await expect(page).toHaveURL(`${queue}/new`);
  await expect(editor.getByText(wanted, { exact: true })).toBeVisible();
  await expect(editor.getByText(postalSiteAddress.fa, { exact: true })).toBeVisible();
  await expect(
    editor.getByRole('heading', { name: copy('siteDocumentNew'), exact: true })
  ).toBeFocused();
  await editor.getByRole('button', { name: docs('cancel'), exact: true }).click();
  await expect(reviewSubmission).toBeEnabled();

  await review.getByRole('link', { name: original.originalName, exact: true }).click();
  await expect(page).toHaveURL(`${queue}/${id}`);
  const detail = page.getByRole('region', { name: docs('details'), exact: true });
  await expect(
    detail.getByRole('heading', { name: original.originalName, exact: true })
  ).toBeVisible();
  await detail.getByRole('link', { name: docs('replace'), exact: true }).click();
  await expect(page).toHaveURL(replacement);
  await expect(editor.getByText(original.originalName, { exact: true })).toBeVisible();
  const chooser = editor.locator('input[type=file]');
  await expect(chooser).toBeEnabled();
  await chooser.setInputFiles({
    name: successor.originalName,
    mimeType: 'application/pdf',
    buffer: file,
  });
  await editor.getByRole('button', { name: docs('replace'), exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: confirmationText('confirm', locale), exact: true })
    .click();
  await expect(page).toHaveURL(queue);
  await expect(
    review.getByRole('status').filter({ hasText: docs('uploadComplete') })
  ).toBeVisible();
  await expect(
    review.getByRole('link', { name: successor.originalName, exact: true })
  ).toBeVisible();
  await reviewSubmission.click();
  await expect(page).toHaveURL(`${queue}/review`);
  await expect(page.getByText(successor.originalName, { exact: true })).toBeVisible();
  await expect(all).not.toBeChecked();
  expect(uploadReceiver.uploads).toHaveLength(1);
  expect(uploadReceiver.uploads[0]!.body.equals(file)).toBe(true);
});

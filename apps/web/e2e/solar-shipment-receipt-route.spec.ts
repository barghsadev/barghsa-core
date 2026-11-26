import { confirmationText } from '@barghsa/i18n/confirmation';
import { documentText } from '@barghsa/i18n/documents';
import { tSolar } from '@barghsa/i18n/solar';
import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';
import { solarProfile } from '../src/test/solar-staff-fixtures.js';
import {
  postalSiteAddress,
  setSolarShipmentDate,
  setupSolarPostalForms,
} from './solar-postal-form-fixture';
import { test, expect, pdfPreviewImage } from './upload-fixture';

test('receipt page checks access and attaches only the confirmed image to the same draft', async ({
  page,
  uploadReceiver,
}) => {
  const locale = 'fa';
  await page.clock.setFixedTime(new Date('2026-09-25T02:00:00Z'));
  const copy = (key: string) => tSolar(key, locale);
  const docs = (key: string) => documentText(key, locale);
  const { firstSolar, olderSolar, state } = await setupSolarPostalForms(page, locale, false, true);
  const base = `/solar/requests/${firstSolar}/shipment`;
  const editorPath = `${base}/upload-receipt`;
  const fileName = 'shipment-receipt.png';
  const id = 'c0000000-0000-4000-8000-000000000009';
  const document = {
    id,
    profileId: solarProfile,
    businessRecordType: 'solar_request',
    businessRecordId: firstSolar,
    category: 'image',
    originalName: fileName,
    detectedMime: 'image/png',
    uploadedBy: 'buyer',
    uploadedByType: 'customer',
    sizeBytes: pdfPreviewImage.length,
    createdAt: '2026-09-23T10:00:00.000Z',
    updatedAt: '2026-09-23T10:00:00.000Z',
  };
  let policyReads = 0;
  let reads = 0;
  const confirmations: unknown[] = [];
  await page.route('**/api/upload/policy/image', (route) => {
    policyReads++;
    return route.fulfill({ json: documentUploadPolicy('image') });
  });
  await page.route('**/api/documents?*', (route) => {
    reads++;
    return route.fulfill({ json: { documents: [], nextBefore: null } });
  });
  await page.route('**/api/documents', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      profileId: solarProfile,
      businessRecordType: 'solar_request',
      businessRecordId: firstSolar,
      category: 'image',
      fileName,
    });
    return route.fulfill({
      json: {
        document: { ...document, state: 'PendingUpload', revision: 1 },
        upload: { presignedUrl: uploadReceiver.url, headers: { 'If-None-Match': '*' } },
      },
    });
  });
  await page.route(`**/api/documents/${id}/confirm`, (route) => {
    confirmations.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        ...document,
        businessRecordId: confirmations.length === 1 ? olderSolar : firstSolar,
        state: 'Available',
        revision: 2,
      },
    });
  });

  const editor = page.locator('[data-slot="shipment-receipt"]');
  state.customerReadMode = 'denied';
  await page.goto(editorPath);
  await expect(editor.getByRole('alert')).toContainText(copy('postalLoadError'));
  expect(policyReads).toBe(0);
  await expect(editor.locator('input[type=file]')).toHaveCount(0);

  state.customerReadMode = 'success';
  await page.goto(base);
  const shipment = page.getByRole('group', { name: copy('postalShipment'), exact: true });
  const courier = shipment.getByLabel(copy('postalCourier'), { exact: true });
  const tracking = shipment.getByLabel(copy('postalTracking'), { exact: true });
  await courier.fill('پست پیشتاز');
  await tracking.fill('IR-1405-024');
  const date = shipment.getByLabel(copy('postalSendDate'), { exact: true });
  await setSolarShipmentDate(page, date, locale, '2026-09-23');
  const upload = shipment.getByRole('link', { name: copy('postalUploadReceipt'), exact: true });
  await expect(upload).toHaveAttribute('href', editorPath);
  await upload.click();
  await expect(page).toHaveURL(editorPath);
  await expect(shipment).toHaveCount(0);
  await expect(editor.getByText(postalSiteAddress[locale], { exact: true })).toBeVisible();
  const picker = editor.locator('input[type=file]');
  await expect(picker).toBeEnabled();
  await picker.setInputFiles({ name: fileName, mimeType: 'image/png', buffer: pdfPreviewImage });
  await editor.getByRole('button', { name: docs('upload'), exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: confirmationText('confirm', locale), exact: true })
    .click();
  const retry = editor.getByRole('button', { name: docs('retryUpload'), exact: true });
  await expect(retry).toBeEnabled();
  await expect(page).toHaveURL(editorPath);
  await retry.click();

  await expect(page).toHaveURL(base);
  await expect(courier).toHaveValue('پست پیشتاز');
  await expect(tracking).toHaveValue('IR-1405-024');
  await expect(date).toContainText('۱ مهر ۱۴۰۵');
  const receipt = shipment.getByLabel(copy('postalReceipt'), { exact: true });
  await expect(receipt).toBeFocused();
  await expect(receipt).toHaveValue(id);
  expect(confirmations).toHaveLength(2);
  expect(confirmations[0]).toEqual(confirmations[1]);
  expect(uploadReceiver.uploads).toHaveLength(1);
  expect(uploadReceiver.uploads[0]?.body.equals(pdfPreviewImage)).toBe(true);
  expect(state.shipmentWrites).toEqual([]);
  expect(reads).toBeGreaterThan(0);
});

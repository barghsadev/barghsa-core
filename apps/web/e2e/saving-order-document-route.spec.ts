import { confirmationText } from '@barghsa/i18n/confirmation';
import { documentText } from '@barghsa/i18n/documents';
import { tSaving } from '@barghsa/i18n/saving';
import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';
import {
  savingChangeOrder,
  setupSavingChangeAddressForms,
} from './saving-change-address-form-fixture';
import { test, expect, pdfPreviewFixture } from './upload-fixture';

for (const staff of [false, true]) {
  test(`saving order document routes retain the order and its attachments for ${staff ? 'staff' : 'customer'}`, async ({
    page,
    uploadReceiver,
  }) => {
    const locale = 'fa';
    const copy = (key: string) => tSaving(key, locale);
    const word = (key: string) => documentText(key, locale);
    const { state } = await setupSavingChangeAddressForms(page, locale, staff);
    const staffDetail = state.staffDetails.get(savingChangeOrder)!;
    const linkedOrderId = 'b0000000-0000-4000-8000-000000000001';
    const anotherOrderId = 'b0000000-0000-4000-8000-000000000002';
    state.customerDetail.order_id = linkedOrderId;
    staffDetail.orderId = linkedOrderId;
    const profileId = staff ? staffDetail.profileId : state.customerDetail.profile_id;
    const order = `${staff ? '/admin/saving-orders' : '/savings/orders'}/${savingChangeOrder}`;
    const base = `${order}/documents`;
    const suffix = staff ? '?lane=fulfillment' : '';
    const documentsApi = `/api/${staff ? 'admin/' : ''}documents`;
    const originalId = 'c0000000-0000-4000-8000-000000000001';
    const replacementId = 'c0000000-0000-4000-8000-000000000002';
    const original = {
      id: originalId,
      profileId,
      businessRecordType: 'order',
      businessRecordId: linkedOrderId,
      category: 'document',
      originalName: 'installation-report.pdf',
      state: 'Available',
      uploadedByType: staff ? 'staff' : 'customer',
      detectedMime: 'application/pdf',
      revision: 3,
      sizeBytes: 3000,
      createdAt: '2026-09-23T10:00:00.000Z',
      permissions: { download: true, write: true, replace: true, remove: false },
    };
    const pdf = pdfPreviewFixture();
    const next = {
      ...original,
      id: replacementId,
      supersedesDocumentId: originalId,
      originalName: 'revised-installation-report.pdf',
      sizeBytes: pdf.length,
    };
    let otherOrder = true;
    let confirmed = false;
    let reads = 0;
    await page.route(`**${documentsApi}?*`, (route) => {
      expect(new URL(route.request().url()).searchParams.get('businessRecordId')).toBe(
        linkedOrderId
      );
      return route.fulfill({
        json: {
          documents: confirmed ? [{ ...next, revision: 2 }] : [original],
          nextBefore: null,
        },
      });
    });
    await page.route(`**${documentsApi}/${originalId}`, (route) =>
      route.fulfill({
        json: {
          ...original,
          businessRecordId: otherOrder ? anotherOrderId : linkedOrderId,
          history: [],
        },
      })
    );
    await page.route('**/api/upload/policy/document', (route) => {
      reads++;
      return route.fulfill({ json: documentUploadPolicy('document') });
    });
    await page.route(`**${documentsApi}`, (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        profileId,
        businessRecordType: 'order',
        businessRecordId: linkedOrderId,
        supersedesDocumentId: originalId,
        fileName: next.originalName,
      });
      return route.fulfill({
        json: {
          document: { ...next, state: 'Uploading', revision: 1 },
          upload: { presignedUrl: uploadReceiver.url, headers: { 'If-None-Match': '*' } },
        },
      });
    });
    await page.route(`**${documentsApi}/${replacementId}/confirm`, (route) => {
      confirmed = true;
      return route.fulfill({ json: { ...next, revision: 2 } });
    });

    const uploadPath = `${base}/new${suffix}`;
    const detailPath = `${base}/${originalId}${suffix}`;
    const replacePath = `${base}/${originalId}/replace${suffix}`;
    const editor = page.locator('[data-slot="saving-order-document"]');
    const chooser = editor.locator('input[type=file]');
    const section = page.getByRole('region', { name: copy('documents'), exact: true });
    const assertReturn = () => expect(page).toHaveURL(`${order}${suffix}#order-documents`);

    await page.goto(replacePath);
    await expect(editor.getByRole('alert')).toContainText(word('denied'));
    await expect(chooser).toHaveCount(0);
    expect(reads).toBe(0);
    otherOrder = false;

    await page.goto(`${order}${suffix}`);
    const add = section.getByRole('link', { name: word('upload'), exact: true });
    await expect(add).toHaveAttribute('href', uploadPath);
    await add.click();
    await expect(page).toHaveURL(uploadPath);
    await expect(
      editor.getByRole('heading', { name: copy('documentUpload'), exact: true })
    ).toBeFocused();
    await expect(editor.getByText('1234567890123', { exact: true })).toBeVisible();
    await editor.getByRole('link', { name: copy('backToOrderDocuments'), exact: true }).click();
    await assertReturn();

    await section.getByRole('link', { name: original.originalName, exact: true }).click();
    await expect(page).toHaveURL(detailPath);
    await editor.getByRole('link', { name: word('replace'), exact: true }).click();
    await expect(page).toHaveURL(replacePath);
    await expect(editor.getByText(original.originalName, { exact: true })).toBeVisible();
    await expect(chooser).toBeEnabled();
    await chooser.setInputFiles({
      name: next.originalName,
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    await editor.getByRole('button', { name: word('replace'), exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: confirmationText('confirm', locale), exact: true })
      .click();
    await assertReturn();
    await expect(section.getByRole('link', { name: next.originalName, exact: true })).toBeVisible();
    expect(uploadReceiver.uploads).toHaveLength(1);
    expect(uploadReceiver.uploads[0]?.body.equals(pdf)).toBe(true);

    state.customerDetail.status = 'completed';
    staffDetail.status = 'completed';
    const policyReads = reads;
    await page.goto(uploadPath);
    await expect(editor.getByText(copy('orderDocumentsReadOnly'), { exact: true })).toBeVisible();
    await expect(chooser).toHaveCount(0);
    expect(reads).toBe(policyReads);
  });
}

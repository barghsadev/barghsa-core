import { confirmationText } from '@barghsa/i18n/confirmation';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractReviewSignature } from '@barghsa/i18n/contract-review-signature';
import { documentText } from '@barghsa/i18n/documents';
import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';
import { crmShell, mockActiveCustomerProfile } from './crm-shell-fixture';
import { fullNavigation } from './navigation-fixture';
import { test, expect, pdfPreviewFixture } from './upload-fixture';

const id = 'a0000000-0000-4000-8000-000000000001';
const profileId = 'a0000000-0000-4000-8000-000000000002';
const historical = 'b0000000-0000-4000-8000-000000000001';
const current = 'b0000000-0000-4000-8000-000000000002';
const pending = 'b0000000-0000-4000-8000-000000000003';
const documentId = 'c0000000-0000-4000-8000-000000000001';
const replacementId = 'c0000000-0000-4000-8000-000000000002';
const createdAt = '2026-09-23T10:00:00.000Z';

for (const staff of [false, true]) {
  test(`contract replacement stays with the exact ${staff ? 'proposed amendment' : 'accepted contract'} version`, async ({
    page,
    uploadReceiver,
  }) => {
    const locale = 'fa';
    const word = (key: string) => documentText(key, locale);
    const copy = (key: string) => contractText(key, locale);
    await crmShell(page, locale);
    if (!staff) {
      await mockActiveCustomerProfile(page, profileId);
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'contract-buyer',
            isStaff: false,
            operatingContext: 'customer',
            requiresTosAcceptance: false,
            navigation: fullNavigation('customer', 'LEGAL'),
          },
        })
      );
    }
    const base = `${staff ? '/admin' : ''}/contracts/${id}`;
    const api = `/api${base}`;
    const docApi = `/api${staff ? '/admin' : ''}/documents`;
    const versionId = staff ? pending : current;
    const role = staff ? 'amendment' : 'signed';
    const versions = [historical, current, pending].map((snapshotId, index) => ({
      id: snapshotId,
      versionNumber: index + 1,
      changeDescription: 'Updated service conditions',
      createdAt,
      content: { text: 'Revised terms' },
    }));
    const contract = {
      id,
      profileId,
      contractNumber: 'EL-1405-024',
      serviceType: 'electricity',
      currentVersionId: current,
      state: staff ? 'Active' : 'Accepted',
      ...(staff
        ? {
            currentVersion: versions[1],
            pendingAmendment: {
              versionId: pending,
              baseVersionId: current,
              state: 'Draft',
              proposedBy: 'reviewer',
              createdAt,
              publishedAt: null,
            },
          }
        : { version: versions[1] }),
    };
    const toDocument = (snapshot = versionId) =>
      `${base}/versions/${snapshot}/documents/${documentId}`;
    const original = {
      id: documentId,
      profileId,
      businessRecordType: 'contract',
      businessRecordId: id,
      contractVersionId: versionId,
      contractRole: role,
      category: 'contract',
      state: 'Available',
      uploadedByType: staff ? 'staff' : 'customer',
      originalName: 'original-contract.pdf',
      revision: 3,
      sizeBytes: 1240,
      createdAt,
      detectedMime: 'application/pdf',
      permissions: { download: true, write: true, replace: true, remove: false },
    };
    const pdf = pdfPreviewFixture();
    const replacement = {
      ...original,
      id: replacementId,
      supersedesDocumentId: documentId,
      originalName: 'revised-contract.pdf',
      sizeBytes: pdf.length,
    };
    let mismatched = true;
    let available = false;
    let policies = 0;
    let documentReads = 0;
    const confirmBodies: unknown[] = [];
    await page.route(`**${api}`, (route) => route.fulfill({ json: contract }));
    await page.route(`**${api}/versions`, (route) =>
      route.fulfill({ json: { versions, nextBefore: null } })
    );
    await page.route(`**${api}/versions/*`, (route) => {
      const version = versions.find((item) =>
        new URL(route.request().url()).pathname.endsWith(item.id)
      );
      return route.fulfill({ json: staff ? version : { ...contract, version } });
    });
    await page.route(`**${api}/activation?*`, (route) =>
      route.fulfill({
        json: { checks: [], isCurrent: !staff, ready: false, evaluatedAt: createdAt },
      })
    );
    await page.route(`**${api}/signature?*`, (route) =>
      route.fulfill({
        json: {
          contractId: id,
          versionId,
          state: staff ? 'Draft' : 'Accepted',
          isCurrent: !staff,
          isAmendment: staff,
          canRequest: false,
          canRecord: false,
          request: null,
          signature: null,
        },
      })
    );
    await page.route(`**${docApi}?*`, (route) => {
      const selected = new URL(route.request().url()).searchParams.get('contractVersionId');
      return route.fulfill({
        json: {
          documents:
            selected === versionId ? [available ? { ...replacement, revision: 2 } : original] : [],
          nextBefore: null,
        },
      });
    });
    await page.route(`**${docApi}/${documentId}`, (route) => {
      documentReads++;
      return route.fulfill({
        json: { ...original, contractVersionId: mismatched ? historical : versionId, history: [] },
      });
    });
    await page.route('**/api/upload/policy/contract', (route) => {
      policies++;
      return route.fulfill({ json: documentUploadPolicy('contract') });
    });
    await page.route(`**${docApi}`, (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        profileId,
        businessRecordId: id,
        businessRecordType: 'contract',
        contractVersionId: versionId,
        contractRole: role,
        supersedesDocumentId: documentId,
      });
      return route.fulfill({
        json: {
          document: { ...replacement, state: 'Uploading', revision: 1 },
          upload: { presignedUrl: uploadReceiver.url, headers: { 'If-None-Match': '*' } },
        },
      });
    });
    await page.route(`**${docApi}/${replacementId}/confirm`, (route) => {
      confirmBodies.push(route.request().postDataJSON());
      available = confirmBodies.length > 1;
      return route.fulfill({
        json: {
          ...replacement,
          supersedesDocumentId: available ? documentId : replacementId,
          revision: 2,
        },
      });
    });

    const editor = page.locator('[data-slot="contract-document"]');
    const replacePath = `${toDocument()}/replace`;
    await page.goto(`${toDocument(historical)}/replace`);
    await expect(editor.getByRole('alert')).toContainText(
      tContractReviewSignature('uploadUnavailable', locale)
    );
    expect(documentReads).toBe(0);

    await page.goto(toDocument(historical));
    await expect(
      editor.getByRole('heading', { name: original.originalName, exact: true })
    ).toBeVisible();
    await expect(editor.getByRole('link', { name: word('replace'), exact: true })).toHaveCount(0);
    expect(policies).toBe(0);

    await page.goto(replacePath);
    await expect(editor.getByRole('alert')).toContainText(word('denied'));
    expect(policies).toBe(0);
    mismatched = false;

    const returnPath = `${base}${staff ? `?versionId=${versionId}` : ''}#contract-documents`;
    await page.goto(returnPath);
    const documents = page.locator('#contract-documents');
    const open = documents.getByRole('link', { name: original.originalName, exact: true });
    await expect(open).toHaveAttribute('href', toDocument());
    await open.click();
    await expect(page).toHaveURL(toDocument());
    await editor.getByRole('link', { name: word('replace'), exact: true }).click();
    await expect(page).toHaveURL(replacePath);
    await expect(
      editor.getByRole('heading', { name: copy('contractDocumentReplace'), exact: true })
    ).toBeFocused();
    await expect(editor.getByText('EL-1405-024', { exact: true })).toBeVisible();
    await expect(editor.getByText(original.originalName, { exact: true })).toBeVisible();
    await editor
      .locator('input[type=file]')
      .setInputFiles({ name: replacement.originalName, mimeType: 'application/pdf', buffer: pdf });
    await editor.getByRole('button', { name: word('replace'), exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: confirmationText('confirm', locale), exact: true })
      .click();
    const retry = editor.getByRole('button', { name: word('retryUpload'), exact: true });
    await expect(retry).toBeEnabled();
    await expect(page).toHaveURL(replacePath);
    await retry.click();

    await expect(page).toHaveURL(returnPath);
    await expect(
      documents.getByRole('link', { name: replacement.originalName, exact: true })
    ).toBeVisible();
    expect(confirmBodies).toHaveLength(2);
    expect(confirmBodies[0]).toEqual(confirmBodies[1]);
    expect(uploadReceiver.uploads).toHaveLength(1);
    expect(uploadReceiver.uploads[0]?.body.equals(pdf)).toBe(true);
  });
}

import { test, expect } from './upload-fixture';
import { en as documentWords } from '../../../packages/i18n/src/documents';

const profileId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const documentId = '33333333-3333-4333-8333-333333333333';
const submittedAt = '2026-09-23T10:00:00.000Z';

test('solar customer resumes intake, uploads documents, and records postal shipment', async ({
  page,
  uploadReceiver,
}) => {
  let draft: Record<string, unknown> | null = null;
  let requestStatus = 'submitted';
  let documentStatus = 'Uploading';
  let shipment: Record<string, unknown> | null = null;
  const submissions: Array<Record<string, unknown>> = [];
  const document = {
    id: documentId,
    profileId,
    businessRecordType: 'solar_request',
    businessRecordId: requestId,
    contractVersionId: null,
    contractRole: null,
    category: 'document',
    originalName: 'site-plan.pdf',
    detectedMime: 'application/pdf',
    sizeBytes: 8,
    uploadedBy: 'buyer',
    uploadedByType: 'customer',
    supersedesDocumentId: null,
    rejectionReason: null,
    reviewComment: null,
    revision: 3,
    checksum: 'a'.repeat(64),
    createdAt: submittedAt,
    updatedAt: submittedAt,
  };

  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: 'buyer', requiresTosAcceptance: false } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId, profileType: 'INDIVIDUAL', title: 'Buyer' }],
        activeProfileId: profileId,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/profiles/verification-status', (route) =>
    route.fulfill({
      json: {
        activeProfileId: profileId,
        profileStatus: 'ACTIVE',
        verificationRequired: true,
        isVerified: true,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route(`**/api/profiles/${profileId}/addresses`, (route) =>
    route.fulfill({ json: { addresses: [] } })
  );
  await page.route('**/api/solar/requests/draft?*', (route) => {
    if (route.request().method() === 'PUT') {
      draft = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: { ...draft, updatedAt: submittedAt } });
    }
    return route.fulfill({
      json: { currentStep: 1, data: draft?.data ?? null, updatedAt: draft ? submittedAt : null },
    });
  });
  await page.route('**/api/solar/requests', (route) => {
    expect(route.request().method()).toBe('POST');
    submissions.push(route.request().postDataJSON() as Record<string, unknown>);
    draft = null;
    return route.fulfill({ status: 201, json: { requestId } });
  });
  await page.route(`**/api/solar/requests/${requestId}`, (route) =>
    route.fulfill({
      json: {
        request: {
          id: requestId,
          profile_id: profileId,
          status: requestStatus,
          status_reason: null,
          support_path: null,
          contract_id: null,
          contract_published: false,
          initial_invoice_id: null,
          building_type: 'building_apartment',
          grid_type: 'off_grid',
          bill_identifier: null,
          property_form: 'villa',
          structural_frame: 'concrete',
          building_completion_date: '2020-01-01',
          total_units: null,
          site_category: null,
          installation_surface: null,
          usable_area_sqm: null,
          site_address: null,
          site_relationship: null,
          site_description: null,
          agreement_version: '2026-09',
          agreement_snapshot: 'Construction terms',
          agreement_accepted_at: submittedAt,
          submitted_at: submittedAt,
        },
      },
    })
  );
  await page.route(`**/api/solar/requests/${requestId}/documents`, (route) =>
    route.fulfill({
      json: {
        guidance: { en: 'Upload a site plan.', fa: 'نقشه سایت را بارگذاری کنید.', suggestions: [] },
        requestedDocuments: [],
      },
    })
  );
  await page.route(`**/api/solar/requests/${requestId}/documents/complete`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ allDocumentsUploaded: true });
    expect(documentStatus).toBe('Available');
    requestStatus = 'documents_under_review';
    return route.fulfill({ json: { status: requestStatus } });
  });
  await page.route('**/api/documents?*', (route) =>
    route.fulfill({
      json: {
        documents: documentStatus === 'Uploading' ? [] : [{ ...document, state: documentStatus }],
        nextBefore: null,
      },
    })
  );
  await page.route('**/api/documents', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      profileId,
      businessRecordType: 'solar_request',
      businessRecordId: requestId,
      fileName: 'site-plan.pdf',
    });
    return route.fulfill({
      status: 201,
      json: {
        document: { ...document, state: 'Uploading', revision: 1 },
        upload: { presignedUrl: uploadReceiver.url, headers: { 'If-None-Match': '*' } },
      },
    });
  });
  await page.route(`**/api/documents/${documentId}/confirm`, (route) => {
    expect(uploadReceiver.uploads).toHaveLength(1);
    expect(uploadReceiver.uploads[0]?.body.toString()).toBe('%PDF-1.7');
    documentStatus = 'Available';
    return route.fulfill({ json: { ...document, state: documentStatus } });
  });
  await page.route(`**/api/documents/${documentId}`, (route) =>
    route.fulfill({ json: { ...document, state: documentStatus, history: [] } })
  );
  await page.route(`**/api/solar/requests/${requestId}/postal`, (route) =>
    route.fulfill({
      json: {
        requestStatus,
        guidance: {
          en: 'Mail the originals.',
          fa: 'اصل مدارک را پست کنید.',
          destinationAddress: 'Solar office',
          contactDetails: null,
          originals: [],
        },
        postal: shipment
          ? {
              ...shipment,
              status: 'shipped',
              courier: shipment.courier,
              tracking_number: shipment.trackingNumber,
              send_date: shipment.sendDate,
            }
          : { status: 'waiting_for_shipment' },
      },
    })
  );
  await page.route(`**/api/solar/requests/${requestId}/postal/shipment`, (route) => {
    shipment = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { status: 'shipped' } });
  });

  await page.goto('/solar/requests/new');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(
    page.getByRole('heading', { name: 'Solar power station construction request' })
  ).toBeVisible();
  await page.getByLabel('Property form').selectOption('villa');
  await page.getByLabel('Building completion date').fill('2020-01-01');
  await page.getByLabel('Off-grid').check();
  await page.getByRole('button', { name: 'Save progress' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Progress saved.' })).toBeVisible();
  expect(draft?.data).toMatchObject({ propertyForm: 'villa', gridType: 'off_grid' });

  await page.reload();
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(page.getByLabel('Property form')).toHaveValue('villa');
  await expect(page.getByLabel('Building completion date')).toHaveValue('2020-01-01');
  await expect(page.getByLabel('Off-grid')).toBeChecked();
  await page.getByLabel('I accept the contract registration terms.').check();
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page).toHaveURL(new RegExp(`/solar/requests/${requestId}$`));
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    profileId,
    buildingType: 'building_apartment',
    propertyForm: 'villa',
    gridType: 'off_grid',
    agreementAccepted: true,
  });

  const documents = page.getByRole('region', { name: 'Document guidance' });
  await documents.getByRole('button', { name: documentWords.upload, exact: true }).click();
  const upload = page.getByRole('region', { name: documentWords.upload });
  await upload.getByLabel(documentWords.file, { exact: true }).setInputFiles({
    name: 'site-plan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7'),
  });
  await upload.getByRole('button', { name: documentWords.upload, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(
    documents.getByRole('status').filter({ hasText: documentWords.uploadComplete })
  ).toBeVisible();
  await documents.getByLabel('I have uploaded all documents').check();
  await documents.getByRole('button', { name: 'Send documents for review' }).click();
  await expect(
    documents.getByRole('status').filter({ hasText: 'Document set sent for review.' })
  ).toBeVisible();

  // Staff completes document review between the two customer visits.
  requestStatus = 'waiting_for_postal_submission';
  await page.reload();
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  const postal = page.getByRole('region', { name: 'Postal submission of documents' });
  await expect(postal.getByText('Mail the originals.')).toBeVisible();
  await postal.getByLabel('Courier').fill('Post office');
  await postal.getByLabel('Tracking number').fill('TRACK-123');
  await postal.getByLabel('Send date').fill(new Date().toISOString().slice(0, 10));
  await postal.getByRole('button', { name: 'Record shipment' }).click();
  await expect(
    postal.getByRole('status').filter({ hasText: 'Shipped, awaiting staff confirmation' })
  ).toBeVisible();
  expect(shipment).toMatchObject({ courier: 'Post office', trackingNumber: 'TRACK-123' });
});

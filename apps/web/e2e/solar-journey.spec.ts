import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';
import { test, expect } from './upload-fixture';
import { en as documentWords } from '../../../packages/i18n/src/documents';

const profileId = '11111111-1111-4111-8111-111111111111';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'en'));
});

const requestId = '22222222-2222-4222-8222-222222222222';
const documentId = '33333333-3333-4333-8333-333333333333';
const submittedAt = '2026-09-23T10:00:00.000Z';

test('solar request moves from customer upload through staff review and postal receipt', async ({
  page,
  uploadReceiver,
}) => {
  let draft: Record<string, unknown> | null = null;
  let requestStatus = 'submitted';
  let documentStatus = 'Uploading';
  let staffDocumentStatus = 'pending';
  let postalStatus = 'waiting_for_shipment';
  let isStaff = false;
  let operatingContext: 'customer' | 'staff' = 'customer';
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
  await page.route('**/api/upload/policy/*', (route) =>
    route.fulfill({
      json: documentUploadPolicy(new URL(route.request().url()).pathname.split('/').at(-1)),
    })
  );
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: { isStaff, operatingContext, userId: 'buyer', requiresTosAcceptance: false },
    })
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
      json: {
        currentStep: draft?.currentStep ?? 1,
        data: draft?.data ?? null,
        updatedAt: draft ? submittedAt : null,
      },
    });
  });
  await page.route('**/api/solar/requests/review', (route) =>
    route.fulfill({
      status: 201,
      json: {
        hash: 'a'.repeat(64),
        data: {
          submission: route.request().postDataJSON(),
          siteAddress: null,
          agreementVersion: 'solar-construction-request-v1',
          agreementText: 'شرایط ثبت قرارداد را می‌پذیرم.',
          createsContract: false,
          createsInvoice: false,
        },
      },
    })
  );
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
  await page.route('**/api/admin/solar/document-review-queue', (route) =>
    route.fulfill({
      json: {
        documents:
          requestStatus === 'documents_under_review' && staffDocumentStatus === 'pending'
            ? [
                {
                  id: 'review-1',
                  request_id: requestId,
                  document_id: documentId,
                  file_name: document.originalName,
                  uploaded_by: 'buyer',
                  uploaded_by_name: 'Buyer',
                  uploaded_at: submittedAt,
                  staff_status: staffDocumentStatus,
                },
              ]
            : [],
        nextBefore: null,
      },
    })
  );
  await page.route('**/api/admin/solar/requests', (route) =>
    route.fulfill({
      json: {
        requests: [
          {
            id: requestId,
            profile_id: profileId,
            profile_name: 'Buyer',
            status: requestStatus,
            building_type: 'building_apartment',
            document_count: 1,
            created_at: submittedAt,
          },
        ],
        nextBefore: null,
      },
    })
  );
  await page.route(`**/api/admin/solar/requests/${requestId}/documents`, (route) =>
    route.fulfill({
      json: {
        request: { id: requestId, profile_id: profileId, status: requestStatus },
        documents: [
          {
            id: 'review-1',
            document_id: documentId,
            file_name: document.originalName,
            staff_status: staffDocumentStatus,
            staff_reason: null,
            uploaded_by: 'buyer',
            uploaded_at: submittedAt,
            state: documentStatus,
            revision: document.revision,
          },
        ],
        requestedDocuments: [],
      },
    })
  );
  await page.route('**/api/admin/solar/document-guidance', (route) =>
    route.fulfill({
      json: { en: 'Upload a site plan.', fa: 'نقشه سایت را بارگذاری کنید.', suggestions: [] },
    })
  );
  await page.route(
    `**/api/admin/solar/requests/${requestId}/documents/${documentId}/approve`,
    (route) => {
      expect(route.request().postDataJSON()).toEqual({ expectedRevision: document.revision });
      expect(requestStatus).toBe('documents_under_review');
      staffDocumentStatus = 'approved';
      documentStatus = 'Approved';
      return route.fulfill({ json: { status: staffDocumentStatus } });
    }
  );
  const setReviewHash = 'b'.repeat(64);
  await page.route(
    `**/api/admin/solar/requests/${requestId}/documents/review-set-decision`,
    (route) => {
      expect(route.request().postDataJSON()).toEqual({ decision: 'advance' });
      return route.fulfill({
        json: {
          hash: setReviewHash,
          data: {
            requestId,
            currentStatus: 'documents_under_review',
            documents: [
              {
                documentId,
                fileName: document.originalName,
                staffStatus: staffDocumentStatus,
                state: documentStatus,
              },
            ],
            existingRequests: [],
            description: null,
            nextStatus: 'waiting_for_postal_submission',
          },
        },
      });
    }
  );
  await page.route(`**/api/admin/solar/requests/${requestId}/documents/advance`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ expectedReviewHash: setReviewHash });
    expect(staffDocumentStatus).toBe('approved');
    requestStatus = 'waiting_for_postal_submission';
    return route.fulfill({ json: { status: requestStatus } });
  });
  await page.route('**/api/admin/solar/postal-queue?*', (route) =>
    route.fulfill({
      json: {
        requests:
          postalStatus === 'shipped'
            ? [
                {
                  id: requestId,
                  profile_id: profileId,
                  profile_name: 'Buyer',
                  request_status: requestStatus,
                  postal_status: postalStatus,
                  courier: shipment?.courier,
                  tracking_number: shipment?.trackingNumber,
                  send_date: shipment?.sendDate,
                  receipt_image_id: null,
                  staff_notes: null,
                  created_at: submittedAt,
                },
              ]
            : [],
        nextBefore: null,
      },
    })
  );
  await page.route('**/api/admin/solar/postal-guidance', (route) =>
    route.fulfill({
      json: {
        en: 'Mail the originals.',
        fa: 'اصل مدارک را پست کنید.',
        destinationAddress: 'Solar office',
        contactDetails: '',
        originals: [],
      },
    })
  );
  const postalReviewHash = 'a'.repeat(64);
  await page.route(`**/api/admin/solar/requests/${requestId}/postal/review`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ decision: 'received' });
    return route.fulfill({
      json: {
        hash: postalReviewHash,
        data: {
          requestId,
          currentRequestStatus: 'waiting_for_postal_submission',
          currentPostalStatus: 'shipped',
          courier: 'Post office',
          trackingNumber: 'TRACK-123',
          sendDate: new Date().toISOString().slice(0, 10),
          receiptImageId: null,
          reason: null,
          postalOutcome: 'received',
          requestOutcome: 'postal_documents_received',
        },
      },
    });
  });
  await page.route(`**/api/admin/solar/requests/${requestId}/postal/confirm-received`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ expectedReviewHash: postalReviewHash });
    expect(postalStatus).toBe('shipped');
    postalStatus = 'received';
    requestStatus = 'postal_documents_received';
    return route.fulfill({ json: { status: postalStatus, requestStatus } });
  });
  await page.route(`**/api/solar/requests/${requestId}/postal`, (route) =>
    route.fulfill({
      json: {
        requestStatus,
        guidance: {
          en: 'Mail the originals.',
          fa: 'اصل مدارک را پست کنید.',
          destinationAddress: 'Solar office',
          contactDetails: '',
          originals: [],
        },
        postal: {
          status: postalStatus,
          courier: shipment?.courier ?? null,
          tracking_number: shipment?.trackingNumber ?? null,
          send_date: shipment?.sendDate ?? null,
          receipt_image_id: shipment?.receiptImageId ?? null,
          staff_notes: null,
        },
      },
    })
  );
  await page.route(`**/api/solar/requests/${requestId}/postal/shipment`, (route) => {
    shipment = route.request().postDataJSON() as Record<string, unknown>;
    postalStatus = 'shipped';
    return route.fulfill({ json: { status: 'shipped' } });
  });

  await page.goto('/solar/requests/new');

  await expect(
    page.getByRole('heading', { name: 'Solar power station construction request' })
  ).toBeVisible();
  await page.getByLabel('Property form').selectOption('villa');
  await page.getByLabel('Building completion date').fill('2020-01-01');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Off-grid').check();
  await page.getByRole('button', { name: 'Save progress' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Progress saved.' })).toBeVisible();
  expect(draft?.data).toMatchObject({ propertyForm: 'villa', gridType: 'off_grid' });

  await page.reload();
  await expect(page).toHaveURL(/step=2$/);
  await expect(page.getByLabel('Off-grid')).toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Property form')).toHaveValue('villa');
  await expect(page.getByLabel('Building completion date')).toHaveValue('2020-01-01');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('I accept the contract registration terms.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your solar request' })).toBeVisible();
  await expect(
    page.getByText(
      'Submitting this request creates no contract or invoice. Staff will review it first.'
    )
  ).toBeVisible();
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page).toHaveURL(new RegExp(`/solar/requests/${requestId}$`));
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    profileId,
    buildingType: 'building_apartment',
    propertyForm: 'villa',
    gridType: 'off_grid',
    agreementAccepted: true,
    expectedReviewHash: 'a'.repeat(64),
  });

  const documents = page.getByRole('region', { name: 'Document guidance' });
  await documents.getByRole('button', { name: documentWords.upload, exact: true }).click();
  const upload = page.getByRole('region', { name: documentWords.upload });
  await expect(upload.getByLabel(documentWords.file, { exact: true })).toBeEnabled();
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

  isStaff = true;
  operatingContext = 'staff';
  await page.goto('/admin/solar-requests');
  await expect(page.getByRole('heading', { name: 'Solar document review' })).toBeVisible();
  await page.getByRole('button', { name: /site-plan\.pdf.*Buyer/ }).click();
  await page.getByRole('button', { name: 'Approve file' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => staffDocumentStatus).toBe('approved');
  await page
    .getByRole('button', { name: 'Documents sufficient — advance to postal stage' })
    .click();
  await expect(page.getByRole('dialog').getByText('Review document-stage decision')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('site-plan.pdf')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => requestStatus).toBe('waiting_for_postal_submission');

  operatingContext = 'customer';
  await page.goto(`/solar/requests/${requestId}`);
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

  operatingContext = 'staff';
  await page.goto('/admin/solar-postal');
  await expect(page.getByRole('heading', { name: 'Solar postal review' })).toBeVisible();
  await page.getByRole('button', { name: /Buyer.*Shipped/ }).click();
  await expect(page.getByText('TRACK-123')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByRole('dialog').getByText('Review postal decision')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('TRACK-123')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => requestStatus).toBe('postal_documents_received');

  operatingContext = 'customer';
  await page.goto(`/solar/requests/${requestId}`);
  await expect(page.getByText('Postal originals received').first()).toBeVisible();
});

test('solar intake returns from address setup with its saved site details', async ({ page }) => {
  const siteAddress = {
    id: '99999999-9999-4999-8999-999999999999',
    profileId,
    provinceId: '33333333-3333-4333-8333-333333333333',
    cityId: '44444444-4444-4444-8444-444444444444',
    fullAddress: 'Solar Field Road',
    postalCode: '9876543210',
    mainAddress: true,
  };
  const addresses: Array<typeof siteAddress> = [];
  let draft: Record<string, unknown> | null = null;
  let submission: Record<string, unknown> | null = null;

  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/upload/policy/*', (route) =>
    route.fulfill({
      json: documentUploadPolicy(new URL(route.request().url()).pathname.split('/').at(-1)),
    })
  );
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { isStaff: false, userId: 'buyer', requiresTosAcceptance: false } })
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
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route(`**/api/profiles/${profileId}/addresses`, (route) => {
    if (route.request().method() === 'POST') {
      addresses.push(siteAddress);
      return route.fulfill({ status: 201, json: siteAddress });
    }
    return route.fulfill({ json: { addresses } });
  });
  await page.route('**/api/geography/provinces', (route) =>
    route.fulfill({ json: [{ id: siteAddress.provinceId, nameFa: 'تهران', nameEn: 'Tehran' }] })
  );
  await page.route(`**/api/geography/provinces/${siteAddress.provinceId}/cities`, (route) =>
    route.fulfill({
      json: [
        {
          id: siteAddress.cityId,
          provinceId: siteAddress.provinceId,
          nameFa: 'تهران',
          nameEn: 'Tehran',
        },
      ],
    })
  );
  await page.route('**/api/solar/requests/draft?*', (route) => {
    if (route.request().method() === 'PUT') {
      draft = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: { ...draft, updatedAt: submittedAt } });
    }
    return route.fulfill({
      json: {
        currentStep: draft?.currentStep ?? 1,
        data: draft?.data ?? null,
        updatedAt: draft ? submittedAt : null,
      },
    });
  });
  await page.route('**/api/solar/requests/review', (route) =>
    route.fulfill({
      status: 201,
      json: {
        hash: 'b'.repeat(64),
        data: {
          submission: route.request().postDataJSON(),
          siteAddress: siteAddress.fullAddress,
          agreementVersion: 'solar-construction-request-v1',
          agreementText: 'شرایط ثبت قرارداد را می‌پذیرم.',
          createsContract: false,
          createsInvoice: false,
        },
      },
    })
  );
  await page.route('**/api/solar/requests', (route) => {
    submission = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { requestId } });
  });

  await page.goto('/solar/requests/new');

  await page.locator('input[value="non_household"]').check();
  await page.locator('#solar-area').fill('250');
  await page
    .getByRole('link', { name: 'Add a site address in profile settings before submitting.' })
    .click();
  await expect(page).toHaveURL(/\/settings\/addresses\?/);
  expect(draft?.data).toMatchObject({ buildingType: 'non_household', usableAreaSqm: '250' });

  await page.getByRole('button', { name: 'Add Address' }).click();
  await page.locator('#addresses-field-1').selectOption(siteAddress.provinceId);
  await page.locator('#addresses-field-2').selectOption(siteAddress.cityId);
  await page.locator('#addresses-field-3').fill(siteAddress.fullAddress);
  await page.locator('#addresses-field-4').fill(siteAddress.postalCode);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(siteAddress.fullAddress)).toBeVisible();
  await page.getByRole('link', { name: 'Return to solar construction request' }).click();
  await expect(page).toHaveURL(/\/solar\/requests\/new\?step=1$/);
  await expect(page.locator('#solar-area')).toHaveValue('250');
  await expect(page.getByLabel('Site address')).toHaveValue(siteAddress.id);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Off-grid').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('I accept the contract registration terms.').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your solar request' })).toBeVisible();
  await expect(page.getByText(siteAddress.fullAddress)).toBeVisible();
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page).toHaveURL(new RegExp(`/solar/requests/${requestId}$`));
  expect(submission).toMatchObject({
    buildingType: 'non_household',
    usableAreaSqm: 250,
    siteAddressId: siteAddress.id,
    gridType: 'off_grid',
    expectedReviewHash: 'b'.repeat(64),
  });
});

test('staff confirms the reviewed solar contract and exact initial invoice', async ({ page }) => {
  let reviewed: Record<string, unknown> | null = null;
  let issued: Record<string, unknown> | null = null;
  const contractId = '66666666-6666-4666-8666-666666666666';
  const invoiceId = '77777777-7777-4777-8777-777777777777';
  const templateVersionId = '55555555-5555-4555-8555-555555555555';
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/upload/policy/*', (route) =>
    route.fulfill({
      json: documentUploadPolicy(new URL(route.request().url()).pathname.split('/').at(-1)),
    })
  );
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        isStaff: true,
        operatingContext: 'staff',
        userId: 'reviewer',
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/admin/solar/postal-queue?*', (route) =>
    route.fulfill({
      json: {
        requests: [
          {
            id: requestId,
            profile_id: profileId,
            profile_name: 'Buyer',
            request_status: 'approved',
            postal_status: 'received',
            courier: null,
            tracking_number: null,
            send_date: null,
            receipt_image_id: null,
            staff_notes: null,
            created_at: submittedAt,
          },
        ],
        nextBefore: null,
      },
    })
  );
  await page.route('**/api/admin/solar/postal-guidance', (route) =>
    route.fulfill({
      json: {
        fa: 'راهنمای پستی',
        en: 'Postal guidance',
        destinationAddress: 'Office',
        contactDetails: '',
        originals: [],
      },
    })
  );
  await page.route(`**/api/admin/solar/requests/${requestId}/contract-options`, (route) =>
    route.fulfill({
      json: {
        templates: [{ version_id: templateVersionId, name: 'Solar agreement', version_number: 2 }],
        documents: [],
      },
    })
  );
  await page.route(`**/api/admin/solar/requests/${requestId}/create-contract/review`, (route) => {
    reviewed = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      json: {
        hash: 'c'.repeat(64),
        data: {
          title: 'Solar agreement',
          text: 'Build the station.',
          changeDescription: 'Initial draft',
          commercialValue: { kind: 'fixed', amountIrr: '900000' },
          source: { kind: 'template', label: 'Solar agreement', versionNumber: 2 },
          invoiceLines: [
            {
              description: 'Deposit',
              quantity: 1,
              unitPrice: '100000',
              lineTotal: '100000',
              vatAmount: '0',
            },
          ],
          totals: { subtotal: '100000', vat: '0', total: '100000' },
          dueRule: { configDays: 7 },
        },
      },
    });
  });
  await page.route(`**/api/admin/solar/requests/${requestId}/create-contract`, (route) => {
    issued = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      json: { status: 'contract_created', contractId, invoiceIds: [invoiceId] },
    });
  });

  await page.goto('/admin/solar-postal');

  await page.getByRole('button', { name: /Buyer/ }).click();
  await page.getByLabel('Contract source').selectOption(`template:${templateVersionId}`);
  await page.getByLabel('Contract title').fill('Solar agreement');
  await page.getByLabel('Contract terms').fill('Build the station.');
  await page.getByLabel('Draft description').fill('Initial draft');
  await page.getByLabel('Stated contract value').selectOption('fixed');
  await page.getByLabel('Fixed amount (IRR)').fill('900000');
  await page.getByLabel('Description').last().fill('Deposit');
  await page.getByLabel('Unit price (IRR)').fill('100000');
  await page.getByRole('button', { name: 'Create solar contract and invoice' }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('region', { name: 'Review contract and initial invoice' })
  ).toContainText('IRR');
  await expect(dialog).toContainText('100,000');
  await expect(dialog).toContainText('7 days after issue');
  expect(reviewed).toMatchObject({ profileId, invoiceLines: [{ unitPrice: '100000' }] });
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Solar contract created' })
  ).toBeVisible();
  expect(issued).toMatchObject({ ...reviewed, expectedReviewHash: 'c'.repeat(64) });
});

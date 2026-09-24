import { test, expect } from './coverage-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const solarId = '22222222-2222-4222-8222-222222222222';
const olderSolarId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const consultationId = '33333333-3333-4333-8333-333333333333';
const olderConsultationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const solarRequest = {
  id: solarId,
  profile_id: profileId,
  status: 'submitted',
  status_reason: null,
  support_path: null,
  contract_id: null,
  contract_published: false,
  initial_invoice_id: null,
  building_type: 'building_apartment',
  grid_type: 'on_grid',
  bill_identifier: '1234567890123',
  property_form: 'apartment',
  structural_frame: 'concrete',
  building_completion_date: '2025-01-01',
  total_units: 2,
  site_category: null,
  installation_surface: null,
  usable_area_sqm: null,
  site_address: 'Solar Street',
  site_relationship: 'owner',
  site_description: null,
  agreement_version: '2026-09',
  agreement_snapshot: 'Construction terms',
  agreement_accepted_at: '2026-09-23T10:00:00.000Z',
  submitted_at: '2026-09-23T10:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: 'buyer', requiresTosAcceptance: false } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId, profileType: 'LEGAL', title: 'Buyer' }],
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
});

test('solar list opens intake and detail routes', async ({ page }) => {
  await page.route('**/api/solar/requests?*', (route) => {
    const before = new URL(route.request().url()).searchParams.get('before');
    return route.fulfill({
      json: {
        requests: [
          {
            id: before ? olderSolarId : solarId,
            status: 'submitted',
            building_type: 'building_apartment',
            grid_type: 'on_grid',
            submitted_at: before ? '2026-09-22T10:00:00.000Z' : '2026-09-23T10:00:00.000Z',
          },
        ],
        nextBefore: before ? null : solarId,
      },
    });
  });
  await page.route(`**/api/solar/requests/${solarId}`, (route) =>
    route.fulfill({
      json: {
        request: solarRequest,
      },
    })
  );
  await page.goto('/solar/requests');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(page.getByRole('heading', { name: 'My solar requests' })).toBeVisible();
  await page.getByRole('button', { name: 'More requests' }).click();
  await expect(page.locator(`a[href="/solar/requests/${solarId}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/solar/requests/${olderSolarId}"]`)).toBeVisible();
  await page.getByRole('link', { name: 'Submit request' }).click();
  await expect(
    page.getByRole('heading', { name: 'Solar power station construction request' })
  ).toBeVisible();

  await page.goto(`/solar/requests/${solarId}`);
  await expect(page.getByRole('heading', { name: 'Request details' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Status and next action' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to requests' }).click();
  await expect(page.getByRole('heading', { name: 'My solar requests' })).toBeVisible();
});

test('solar list shows document and contract next actions, with the current document stage', async ({
  page,
}) => {
  const publishedId = '66666666-6666-4666-8666-666666666666';
  const contractId = '77777777-7777-4777-8777-777777777777';
  await page.route('**/api/solar/requests?*', (route) =>
    route.fulfill({
      json: {
        requests: [
          { ...solarRequest, status: 'changes_requested' },
          {
            ...solarRequest,
            id: publishedId,
            status: 'contract_created',
            contract_id: contractId,
            contract_published: true,
          },
        ],
      },
    })
  );
  await page.route(`**/api/solar/requests/${solarId}`, (route) =>
    route.fulfill({ json: { request: { ...solarRequest, status: 'changes_requested' } } })
  );

  await page.goto('/solar/requests');
  const persianRequest = page.getByRole('link', { name: /نیازمند اصلاح مدارک/ });
  await expect(persianRequest).toContainText('مدارک درخواستی را بارگذاری کنید');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  const documentRequest = page.getByRole('link', { name: /Changes requested/ });
  await expect(documentRequest).toContainText('Upload the requested documents');
  await expect(documentRequest).toContainText('Who acts next: You');
  await expect(page.getByRole('link', { name: /Contract created/ })).toContainText('View contract');
  await documentRequest.click();
  await expect(page.getByText('Current stage: Document upload')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Status and next action' })).toContainText(
    'Upload the requested documents'
  );
});

test('consultation list opens its request detail route', async ({ page }) => {
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Pacific/Kiritimati' } })
  );
  await page.route('**/api/consultations/products?*', (route) =>
    route.fulfill({
      json: {
        products: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            systemKey: 'electricity_generation_station',
            title: { en: 'Site advice', fa: 'مشاوره مکان' },
            description: null,
          },
        ],
      },
    })
  );
  await page.route('**/api/consultations/requests?*', (route) => {
    const before = new URL(route.request().url()).searchParams.get('before');
    return route.fulfill({
      json: {
        requests: [
          {
            id: before ? olderConsultationId : consultationId,
            status: 'submitted',
            product_snapshot: { title: { en: 'Site advice', fa: 'مشاوره مکان' } },
            submitted_at: before ? '2026-09-22T10:00:00.000Z' : '2026-09-23T10:00:00.000Z',
            expected_next_step: null,
          },
        ],
        nextBefore: before ? null : consultationId,
      },
    });
  });
  await page.route(`**/api/consultations/requests/${consultationId}`, (route) =>
    route.fulfill({
      json: {
        request: {
          id: consultationId,
          status: 'submitted',
          product_snapshot: { title: { en: 'Site advice', fa: 'مشاوره مکان' } },
          submitted_at: '2026-09-23T10:00:00.000Z',
          fee: null,
          scope: null,
          deliverables: null,
          expected_next_step: null,
          offer_valid_until: null,
          invoice_id: null,
          invoice_state: null,
          has_paid_invoice: false,
          accepted_at: null,
        },
        history: [],
        adjustments: [],
        refunds: [],
      },
    })
  );
  await page.goto('/consultations');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(page.getByRole('heading', { name: 'Consultations' })).toBeVisible();
  await expect(page.locator(`a[href="/consultations/${consultationId}"] time`)).toHaveText(
    '09/24/2026'
  );
  await page.getByRole('button', { name: 'More requests' }).click();
  await expect(page.locator(`a[href="/consultations/${consultationId}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/consultations/${olderConsultationId}"]`)).toBeVisible();
  await page.locator(`a[href="/consultations/${consultationId}"]`).click();
  await expect(page.getByRole('heading', { name: 'Consultation details' })).toBeVisible();
  await expect(page.locator('time[datetime="2026-09-23T10:00:00.000Z"]')).toHaveText('09/24/2026');
  await expect(page.getByRole('region', { name: 'Status and next action' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to consultations' }).click();
  await expect(page.getByRole('heading', { name: 'Consultations' })).toBeVisible();

  await page.route('**/api/consultations/requests', (route) => {
    submissions.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 201, json: { requestId: consultationId } });
  });
  await page.goto('/consultations');
  await page.getByRole('radio', { name: 'Site advice' }).check();
  await page
    .getByRole('checkbox', { name: 'I confirm this request is for the selected profile.' })
    .check();
  await page.getByRole('button', { name: 'Request consultation' }).click();
  await expect(page).toHaveURL(new RegExp(`/consultations/${consultationId}$`));
  await expect(page.getByRole('heading', { name: 'Consultation details' })).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    profileId,
    productId: '44444444-4444-4444-8444-444444444444',
    submissionKey: expect.any(String),
  });
});

test('consultation list and detail show assigned staff and the payment action', async ({
  page,
}) => {
  const offer = {
    id: consultationId,
    status: 'offer_pending',
    product_snapshot: { title: { en: 'Site advice', fa: 'مشاوره مکان' } },
    submitted_at: '2026-09-23T10:00:00.000Z',
    staff_owner_username: 'reviewer@consultation.test',
    staff_team: 'Engineering',
    expected_next_step: 'Pay the invoice',
    invoice_id: '55555555-5555-4555-8555-555555555555',
    invoice_state: 'Unpaid',
    accepted_at: '2026-09-23T11:00:00.000Z',
    offer_valid_until: '2099-01-01T00:00:00.000Z',
    refund_pending: false,
  };
  await page.route('**/api/consultations/products?*', (route) =>
    route.fulfill({ json: { products: [] } })
  );
  await page.route('**/api/consultations/requests?*', (route) =>
    route.fulfill({ json: { requests: [offer] } })
  );
  await page.route(`**/api/consultations/requests/${consultationId}`, (route) =>
    route.fulfill({
      json: {
        request: {
          ...offer,
          fee: '500000',
          scope: 'Site review',
          deliverables: 'Report',
          has_paid_invoice: false,
        },
        history: [],
        adjustments: [],
        refunds: [],
      },
    })
  );

  await page.goto('/consultations');
  const requestLink = page.getByRole('link', { name: /مشاوره مکان/ });
  await expect(requestLink).toContainText('کارشناس مسئول: reviewer@consultation.test');
  await expect(requestLink).toContainText('شما این پیشنهاد را پذیرفته‌اید');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  const englishRequestLink = page.getByRole('link', { name: /Site advice/ });
  await expect(englishRequestLink).toContainText('You accepted this offer. Pay the invoice');
  await englishRequestLink.click();
  await expect(page.getByText('Staff owner:')).toBeVisible();
  await expect(page.getByText('reviewer@consultation.test')).toBeVisible();
  await expect(page.getByText('Engineering')).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { __consultationNavigation?: string }).__consultationNavigation = 'kept';
  });
  await page.getByRole('link', { name: 'View invoice' }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${offer.invoice_id}$`));
  expect(
    await page.evaluate(
      () => (window as Window & { __consultationNavigation?: string }).__consultationNavigation
    )
  ).toBe('kept');
});

test('accepting a consultation offer opens its invoice without reloading the app', async ({
  page,
}) => {
  const invoiceId = '55555555-5555-4555-8555-555555555555';
  await page.route(`**/api/consultations/requests/${consultationId}`, (route) =>
    route.fulfill({
      json: {
        request: {
          id: consultationId,
          status: 'offer_pending',
          product_snapshot: { title: { en: 'Site advice', fa: 'مشاوره مکان' } },
          submitted_at: '2026-09-23T10:00:00.000Z',
          staff_owner_username: 'reviewer@consultation.test',
          staff_team: null,
          fee: '500000',
          scope: 'Site review',
          deliverables: 'Report',
          expected_next_step: 'Accept the offer',
          offer_valid_until: '2099-01-01T00:00:00.000Z',
          invoice_id: invoiceId,
          invoice_state: 'Unpaid',
          has_paid_invoice: false,
          accepted_at: null,
        },
        history: [],
        adjustments: [],
        refunds: [],
      },
    })
  );
  await page.route(`**/api/consultations/requests/${consultationId}/accept`, (route) =>
    route.fulfill({ json: { paymentRequired: true, invoiceId } })
  );
  await page.goto(`/consultations/${consultationId}`);
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await page.evaluate(() => {
    (window as Window & { __consultationNavigation?: string }).__consultationNavigation = 'kept';
  });
  await page.getByRole('button', { name: 'Accept offer and pay' }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoiceId}$`));
  expect(
    await page.evaluate(
      () => (window as Window & { __consultationNavigation?: string }).__consultationNavigation
    )
  ).toBe('kept');
});

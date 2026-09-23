import { test, expect } from './coverage-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const solarId = '22222222-2222-4222-8222-222222222222';
const consultationId = '33333333-3333-4333-8333-333333333333';

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
  await page.route('**/api/solar/requests?*', (route) =>
    route.fulfill({
      json: {
        requests: [
          {
            id: solarId,
            status: 'submitted',
            building_type: 'building_apartment',
            grid_type: 'on_grid',
            submitted_at: '2026-09-23T10:00:00.000Z',
          },
        ],
      },
    })
  );
  await page.route(`**/api/solar/requests/${solarId}`, (route) =>
    route.fulfill({
      json: {
        request: {
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
        },
      },
    })
  );
  await page.goto('/solar/requests');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(page.getByRole('heading', { name: 'My solar requests' })).toBeVisible();
  await page.getByRole('link', { name: 'Submit request' }).click();
  await expect(
    page.getByRole('heading', { name: 'Solar power station construction request' })
  ).toBeVisible();

  await page.goto(`/solar/requests/${solarId}`);
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(page.getByRole('heading', { name: 'Request details' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Status and next action' })).toBeVisible();
});

test('consultation list opens its request detail route', async ({ page }) => {
  const submissions: Array<Record<string, unknown>> = [];
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
  await page.route('**/api/consultations/requests?*', (route) =>
    route.fulfill({
      json: {
        requests: [
          {
            id: consultationId,
            status: 'submitted',
            product_snapshot: { title: { en: 'Site advice', fa: 'مشاوره مکان' } },
            submitted_at: '2026-09-23T10:00:00.000Z',
            expected_next_step: null,
          },
        ],
      },
    })
  );
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
  await page.getByRole('link', { name: /Site advice/ }).click();
  await expect(page.getByRole('heading', { name: 'Consultation details' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Status and next action' })).toBeVisible();

  await page.route('**/api/consultations/requests', (route) => {
    submissions.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 201, json: { requestId: consultationId } });
  });
  await page.goto('/consultations');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
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

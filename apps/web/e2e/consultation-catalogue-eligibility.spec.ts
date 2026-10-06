import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { fullNavigation } from './navigation-fixture';
const individual = '11111111-1111-4111-8111-111111111111';
const legal = '22222222-2222-4222-8222-222222222222';
const general = {
  id: '33333333-3333-4333-8333-333333333333',
  systemKey: 'electricity_generation_station',
  title: { en: 'Station advice', fa: 'مشاوره نیروگاه' },
  description: null,
};
const certificate = {
  id: '44444444-4444-4444-8444-444444444444',
  systemKey: 'electricity_saving_certificate',
  title: { en: 'Certificate advice', fa: 'مشاوره گواهی' },
  description: null,
};
for (const locale of ['en', 'fa'] as const)
  test(`consultation catalogue exposes certificate only for the owned legal profile (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    let active = individual;
    await page.route('**/api/auth/user', (r) =>
      r.fulfill({
        json: {
          userId: 'eligibility-buyer',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
          navigation: fullNavigation('customer'),
        },
      })
    );
    await page.route('**/api/profiles', (r) =>
      r.fulfill({
        json: {
          activeProfileId: active,
          hasDefault: true,
          profiles: [
            {
              id: individual,
              profileType: 'INDIVIDUAL',
              title: 'Individual',
              status: 'ACTIVE',
              firstName: 'Buyer',
              lastName: 'Individual',
            },
            {
              id: legal,
              profileType: 'LEGAL',
              title: 'Company',
              status: 'ACTIVE',
              companyName: 'Company',
            },
          ],
        },
      })
    );
    await page.route('**/api/profiles/verification-status', (r) =>
      r.fulfill({
        json: {
          activeProfileId: active,
          profileStatus: 'ACTIVE',
          isVerified: true,
          verificationRequired: false,
        },
      })
    );
    await page.route('**/api/consultations/products?*', (r) => {
      expect(new URL(r.request().url()).searchParams.get('profileId')).toBe(active);
      return r.fulfill({
        json: { products: active === legal ? [general, certificate] : [general] },
      });
    });
    await page.route('**/api/consultations/requests?*', (r) =>
      r.fulfill({ json: { requests: [], nextBefore: null } })
    );
    await page.goto('/consultations');
    const advice = page.getByRole('radio', { name: new RegExp(general.title[locale]) });
    const certificateChoice = page.getByRole('radio', {
      name: new RegExp(certificate.title[locale]),
    });
    await expect(advice).toBeVisible();
    await expect(certificateChoice).toHaveCount(0);
    active = legal;
    await page.reload();
    await expect(certificateChoice).toBeVisible();
    await certificateChoice.click();
    await expect(certificateChoice).toBeChecked();
    active = individual;
    await page.reload();
    await expect(advice).toBeVisible();
    await expect(certificateChoice).toHaveCount(0);
    await expect(advice).not.toBeChecked();
  });

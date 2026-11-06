import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { verificationConfigText as copy } from '@barghsa/i18n/verification-config';
import { t } from '@barghsa/i18n/admin-ui';
import { t as crmText } from '@barghsa/i18n/crm';
import {
  DEFAULT_VERIFICATION_POLICY,
  type VerificationPolicyView,
} from '@barghsa/shared/verification';

for (const width of [390, 1440])
  for (const locale of ['en', 'fa'] as const)
    for (const dark of [false, true])
      test(`verification requirements publish exact drafts and hold uncertain outcomes (${width}, ${locale}, ${dark})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await setupCatalogueForms(page, locale, dark);
        const text = (key: Parameters<typeof copy>[0]) => copy(key, locale);
        let view: VerificationPolicyView = {
          active: structuredClone(DEFAULT_VERIFICATION_POLICY),
          draft: null,
          version: 0,
        };
        let mismatch = false,
          denied = false;
        const writes: unknown[] = [];
        const path = '/api/admin/config/profile-verification-policy';
        await page.route(`**${path}`, (route) => {
          if (route.request().method() === 'GET')
            return route.fulfill({ status: denied ? 403 : 200, json: denied ? {} : view });
          const body = route.request().postDataJSON();
          writes.push(body);
          if (mismatch) return route.fulfill({ json: { ...view, version: 999 } });
          view = {
            active: body.action === 'activate' ? body.policy : view.active,
            draft: body.action === 'draft' ? body.policy : null,
            version: body.expectedVersion + 1,
          };
          return route.fulfill({ json: view });
        });
        await page.route('**/api/auth/step-up', (route) =>
          route.fulfill({ json: { verified: true } })
        );
        await page.goto('/admin/verification');
        const section = page.getByRole('region', {
          name: text('policyTitle'),
          exact: true,
          includeHidden: true,
        });
        const individual = section.getByRole('group', { name: text('INDIVIDUAL'), exact: true });
        const expiry = section.locator('#verification-expiry-INDIVIDUAL');
        const save = section.getByRole('button', { name: text('save'), exact: true });
        await expect(expiry).toBeEnabled();
        await expiry.fill('1e3');
        await save.click();
        await expect(expiry).toBeFocused();
        await expect(expiry).toHaveAttribute('aria-invalid', 'true');
        expect(writes).toEqual([]);
        await expiry.fill('۳۰');
        await individual.getByRole('checkbox', { name: text('national_id'), exact: true }).check();
        await section.getByRole('checkbox', { name: text('policyStaff'), exact: true }).uncheck();
        await save.click();
        const dialog = page.getByRole('dialog'),
          confirm = dialog.getByRole('button', { name: t('team.confirm', locale), exact: true });
        await expect(expiry).toBeDisabled();
        await confirm.click();
        await expect(dialog).toHaveCount(0);
        expect(view.active).toEqual(DEFAULT_VERIFICATION_POLICY);
        expect(view.draft).toMatchObject({
          INDIVIDUAL: { expiryDays: 30, documents: ['national_id'] },
          autoVerifyStaff: false,
        });
        await section.getByRole('button', { name: text('activate'), exact: true }).click();
        await dialog.locator('#team-step-up-password').fill('test-only');
        await confirm.click();
        await expect(dialog).toHaveCount(0);
        expect(writes).toHaveLength(2);
        expect(view.version).toBe(2);
        expect(view.draft).toBeNull();
        await expect(section.getByRole('status')).toContainText(text('policySaved'));
        expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        if (width === 390)
          await individual.screenshot({
            path: `/Users/majid/.local/state/barghsa-manual-batches/release-0.5-expanded-verification/captures/policy-${locale}-${dark ? 'dark' : 'light'}.png`,
          });
        await expiry.fill('31');
        mismatch = true;
        await save.click();
        await confirm.click();
        await expect(confirm).toBeDisabled();
        await expect(section).toContainText(text('unverified'));
        await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
        await expect(save).toBeDisabled();
        expect(writes).toHaveLength(3);
        await expect(
          section.getByRole('button', { name: text('resetSaved'), exact: true })
        ).toBeEnabled();
        await section.getByRole('button', { name: text('resetSaved'), exact: true }).click();
        await expect(expiry).toHaveValue('30');
        expect(writes).toHaveLength(3);
        denied = true;
        await section.getByRole('button', { name: text('policyReload'), exact: true }).click();
        await expect(expiry).toHaveCount(0);
        await expect(section).toContainText(text('forbidden'));
      });

for (const locale of ['en', 'fa'] as const)
  test(`CRM captures required evidence before manual verification (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await setupCatalogueForms(page, locale, locale === 'fa');
    const id = '11111111-1111-4111-8111-111111111111';
    const policy = structuredClone(DEFAULT_VERIFICATION_POLICY);
    policy.INDIVIDUAL.documents = ['national_id'];
    let status = 'PENDING_VERIFICATION';
    const detail = () => ({
      profile: {
        id,
        profileType: 'INDIVIDUAL',
        status,
        isDefault: true,
        archived: false,
        archivedAt: null,
        archivedReason: null,
        title: 'Customer',
        firstName: 'Example',
        lastName: 'Customer',
        nationalId: null,
        contactEmail: null,
        contactMobile: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: status === 'VERIFIED' ? '2026-11-06T12:00:00Z' : '2026-01-01T00:00:00Z',
      },
      user: {
        userId: 'customer',
        username: 'customer@example.test',
        email: 'customer@example.test',
        mobile: null,
        lastLogin: null,
        lastPasswordChange: null,
        isAdmin: false,
        createdAt: '2026-01-01T00:00:00Z',
      },
      viewerPermissions: {
        canVerify: true,
        canEdit: false,
        canManageUser: false,
        canOverrideVerification: false,
      },
      verificationPolicy: policy,
      verificationCurrent: status === 'VERIFIED',
      legalInfo: null,
      addresses: [],
      sessions: { count: 0, entries: [], lastActive: null },
      siblingProfiles: [],
      agentRelationships: { items: [], nextCursor: null },
      verificationHistory: { items: [], nextCursor: null },
    });
    await page.route(`**/api/crm/profiles/${id}`, (route) => route.fulfill({ json: detail() }));
    const key = 'uploads/document/33333333-3333-4333-8333-333333333333.pdf';
    const uploads: unknown[] = [],
      writes: unknown[] = [];
    await page.route('**/api/upload/presigned-url', (route) => {
      uploads.push(route.request().postDataJSON());
      return route.fulfill({ json: { key, presignedUrl: '/review-evidence-upload' } });
    });
    await page.route('**/review-evidence-upload', (route) => route.fulfill({ status: 200 }));
    await page.route('**/api/upload/*/verify', (route) =>
      route.fulfill({ json: { status: 'confirmed' } })
    );
    await page.route('**/api/upload/*/record', (route) =>
      route.fulfill({ json: { status: 'recorded' } })
    );
    await page.route(`**/api/crm/profiles/${id}/verify`, (route) => {
      writes.push(route.request().postDataJSON());
      status = 'VERIFIED';
      return route.fulfill({
        json: {
          success: true,
          profileId: id,
          previousStatus: 'PENDING_VERIFICATION',
          newStatus: 'VERIFIED',
          reason: null,
        },
      });
    });
    await page.goto(`/admin/crm/profiles/${id}`);
    const review = page.getByRole('button', {
      name: crmText('crm.profile.verification.review', locale),
      exact: true,
    });
    await review.click();
    await expect(page.getByRole('alert')).toContainText(copy('national_id', locale));
    await expect(page.locator('#verification-file-national_id')).toBeFocused();
    await expect(page.locator('#verification-file-national_id')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(uploads).toEqual([]);
    expect(writes).toEqual([]);
    await page.locator('#verification-file-national_id').setInputFiles({
      name: 'identity.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n'),
    });
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await review.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(writes).toEqual([]);
    expect(uploads).toEqual([
      expect.objectContaining({ profileId: id, purpose: 'verification_evidence' }),
    ]);
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([{ action: 'verify', evidence: [{ type: 'national_id', key }] }]);
  });

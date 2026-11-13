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

for (const locale of ['en', 'fa'] as const) {
  test(`reviews a prior verification policy before preparing a recovery draft (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    const text = (key: Parameters<typeof copy>[0]) => copy(key, locale);
    const path = '/api/admin/config/profile-verification-policy';
    const id = '00000000-0000-4000-8000-000000000051';
    const oldPolicy = structuredClone(DEFAULT_VERIFICATION_POLICY);
    oldPolicy.LEGAL.documents = ['registration_notice'];
    let view: VerificationPolicyView = {
      active: DEFAULT_VERIFICATION_POLICY,
      draft: null,
      version: 4,
    };
    const commands: unknown[] = [];
    await page.route(`**${path}/history`, (route) =>
      route.fulfill({
        json: { items: [{ id, version: 2, policy: oldPolicy }], nextBeforeVersion: null },
      })
    );
    await page.route(`**${path}`, (route) => {
      if (route.request().method() === 'PUT') {
        commands.push(route.request().postDataJSON());
        view = { ...view, draft: oldPolicy, version: 5 };
      }
      return route.fulfill({ json: view });
    });
    await page.goto('/admin/verification');
    const section = page.getByRole('region', { name: text('policyTitle'), exact: true });
    await section.getByRole('button', { name: text('policyHistory') }).click();
    await section.getByRole('button', { name: text('policyRestore') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(text('registration_notice'), { exact: true })).toBeVisible();
    expect(commands).toEqual([]);
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(commands).toEqual([{ action: 'restore', sourceId: id, expectedVersion: 4 }]);
    expect(view.active).toEqual(DEFAULT_VERIFICATION_POLICY);
    await expect(
      section
        .getByRole('group', { name: text('LEGAL'), exact: true })
        .getByRole('checkbox', { name: text('registration_notice'), exact: true })
    ).toBeChecked();
    await expect(
      section.getByRole('button', { name: text('activate'), exact: true })
    ).toBeEnabled();
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`verification read denial withdraws all three settings and late replies (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    const text = (key: Parameters<typeof copy>[0]) => copy(key, locale);
    const reads = { mode: 0, otp: 0, policy: 0 };
    let phase: 'current' | 'denied' | 'recovered' = 'current';
    let finish!: () => void;
    const heldOtp = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route('**/api/admin/config/profile-verification-mode', (route) => {
      expect(route.request().method()).toBe('GET');
      reads.mode++;
      return route.fulfill({ json: { mode: 'MANUAL', draft: null, version: reads.mode } });
    });
    await page.route('**/api/admin/config/otp', async (route) => {
      expect(route.request().method()).toBe('GET');
      if (++reads.otp === 2) {
        await heldOtp;
        return route.fulfill({ json: { ttlSeconds: 899, version: 2 } });
      }
      return route.fulfill({
        json: { ttlSeconds: phase === 'recovered' ? 420 : 300, version: reads.otp },
      });
    });
    await page.route('**/api/admin/config/profile-verification-policy', (route) => {
      expect(route.request().method()).toBe('GET');
      reads.policy++;
      return phase === 'denied'
        ? route.fulfill({ status: locale === 'fa' ? 403 : 401, json: {} })
        : route.fulfill({
            json: { active: DEFAULT_VERIFICATION_POLICY, draft: null, version: reads.policy },
          });
    });
    try {
      await page.goto('/admin/verification');
      const main = page.getByRole('main');
      const mode = main.locator('#verification-mode-MANUAL');
      const ttl = main.locator('#otp-lifetime');
      const expiry = main.locator('#verification-expiry-INDIVIDUAL');
      await expect(mode).toBeChecked();
      await expect(ttl).toHaveValue('300');
      await expect(expiry).toBeEnabled();
      await ttl.fill('360');
      await main.getByRole('button', { name: text('otpReload'), exact: true }).click();
      await expect.poll(() => reads.otp).toBe(2);
      phase = 'denied';
      await main.getByRole('button', { name: text('policyReload'), exact: true }).click();
      const denied = main.getByRole('alert').filter({ hasText: text('forbidden') });
      await expect(denied).toBeVisible();
      await expect(mode).toHaveCount(0);
      await expect(ttl).toHaveCount(0);
      await expect(expiry).toHaveCount(0);
      expect(reads).toEqual({ mode: 1, otp: 2, policy: 2 });
      finish();
      phase = 'recovered';
      await denied.getByRole('button', { name: text('reload'), exact: true }).press('Enter');
      await expect(ttl).toHaveValue('420');
      await expect(expiry).toBeEnabled();
      await expect(mode).toBeChecked();
      await expect(denied).toHaveCount(0);
      expect(reads).toEqual({ mode: 2, otp: 3, policy: 3 });
    } finally {
      finish();
    }
  });
}

for (const width of [390, 1440])
  for (const locale of ['en', 'fa'] as const)
    for (const dark of [false, true])
      test(`verification requirements publish exact drafts and hold uncertain outcomes (${width}, ${locale}, ${dark})`, async ({
        page,
      }, info) => {
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
            path: info.outputPath(`policy-${locale}-${dark ? 'dark' : 'light'}.png`),
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
        await expect(
          page
            .getByRole('main')
            .getByRole('alert')
            .filter({ hasText: text('forbidden') })
        ).toBeVisible();
        await expect(section).toHaveCount(0);
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

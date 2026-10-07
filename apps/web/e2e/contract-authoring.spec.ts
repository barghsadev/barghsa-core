import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { cookieResponse } from './cookie-response';
import { verifyClippedContrast } from './clipped-contrast';
import { en, fa } from '../../../packages/i18n/src/contracts';
const ID = '11111111-1111-4111-8111-111111111111',
  PROFILE = '22222222-2222-4222-8222-222222222222',
  ORDER = '33333333-3333-4333-8333-333333333333';
const V1 = '44444444-4444-4444-8444-444444444444',
  V2 = '55555555-5555-4555-8555-555555555555',
  CREATED = '66666666-6666-4666-8666-666666666666',
  CREATED_VERSION = '77777777-7777-4777-8777-777777777777';
for (const locale of ['en', 'fa'] as const) {
  test(`staff creates a draft safely and revises an imported snapshot (${locale})`, async ({
    page,
  }, testInfo) => {
    const words = locale === 'fa' ? fa : en,
      confirm = locale === 'fa' ? 'تأیید' : 'Confirm';
    await page.addInitScript((language) => {
      localStorage.setItem('barghsa.locale', language);
      const apply = () => {
        if (document.documentElement) {
          document.documentElement.lang = language;
          document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
        }
      };
      apply();
      new MutationObserver(apply).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (r) => r.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'contract-test-user',
          isStaff: true,
          operatingContext: 'staff',
          canSwitchContext: true,
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/public/branding/config', (r) =>
      r.fulfill({
        json: {
          appTitle: 'Draft workspace',
          appTitleFa: 'قراردادها',
          supportEmail: 'support@example.com',
          supportPhone: '02126658042',
          supportMobile: '09002550292',
          slogan: '',
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode: locale === 'fa',
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (r) =>
      r.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/admin/contracts/authoring-options?*', (r) =>
      r.fulfill({
        json: new URL(r.request().url()).searchParams.has('profileId')
          ? {
              orders: [
                { id: ORDER, serviceType: 'electricity', createdAt: '2026-09-21T00:00:00Z' },
              ],
              nextBefore: null,
            }
          : { profiles: [{ id: PROFILE, title: 'Acme', profileType: 'LEGAL' }], nextBefore: null },
      })
    );
    const versions = [
      {
        id: V1,
        contractId: ID,
        createdBy: 'contract-test-user',
        versionNumber: 1,
        content: {
          title: 'Supply contract',
          text: 'Initial terms',
          price: '9007199254740993',
          policy: { retain: true },
        },
        changeDescription: 'Initial draft',
        createdAt: '2026-09-21T00:00:00Z',
        acceptedAt: null,
      },
    ];
    let current = versions[0]!,
      created = false;
    const dto = () => ({
      id: ID,
      contractNumber: '1',
      profileId: PROFILE,
      orderId: ORDER,
      serviceType: 'electricity',
      state: 'Draft',
      createdAt: '2026-09-21T00:00:00Z',
      updatedAt: '2026-09-21T00:00:00Z',
      submittedAt: null,
      acceptedAt: null,
      signedAt: null,
      activatedAt: null,
      completedAt: null,
      cancelledAt: null,
      amendmentSupported: true,
      linkedOrderStatus: 'DRAFT',
      acceptedParty: null,
      pendingAmendment: null,
      currentVersionId: current.id,
      currentVersion: current,
    });
    let createdDto: ReturnType<typeof dto> | undefined;
    await page.route(`**/api/admin/contracts/${CREATED}`, (r) => r.fulfill({ json: createdDto }));
    await page.route(`**/api/admin/contracts/${CREATED}/versions`, (r) =>
      r.fulfill({ json: { versions: [createdDto!.currentVersion], nextBefore: null } })
    );
    await page.route('**/api/admin/contracts?*', (r) =>
      r.fulfill({
        json: {
          contracts: created
            ? [
                {
                  id: ID,
                  profileId: PROFILE,
                  serviceType: 'electricity',
                  state: 'Draft',
                  versionId: current.id,
                  versionNumber: current.versionNumber,
                },
              ]
            : [],
          nextBefore: null,
        },
      })
    );
    await page.route(`**/api/admin/contracts/${ID}/versions`, (r) =>
      r.fulfill({ json: { versions, nextBefore: null } })
    );
    await page.route(`**/api/admin/contracts/${ID}/versions/*`, (r) =>
      r.fulfill({ json: versions.find((v) => r.request().url().endsWith(v.id)) })
    );
    for (const contractId of [ID, CREATED]) {
      await page.route(`**/api/admin/contracts/${contractId}/activation?*`, (r) =>
        r.fulfill({
          json: {
            contractId,
            versionId: new URL(r.request().url()).searchParams.get('versionId'),
            state: 'Draft',
            checks: [
              { key: 'staffApproval', required: true, status: 'unmet' },
              { key: 'customerAcceptance', required: true, status: 'unmet' },
              { key: 'signature', required: false, status: 'not_required' },
              { key: 'initialPayment', required: true, status: 'unmet' },
              { key: 'serviceStart', required: false, status: 'not_required' },
            ],
            ruleRevision: 1,
            isCurrent:
              new URL(r.request().url()).searchParams.get('versionId') ===
              (contractId === ID ? current.id : CREATED_VERSION),
            ready: false,
            initialInvoiceId: null,
            serviceStartsAt: null,
            serviceEndsAt: null,
            evaluatedAt: '2026-09-21T00:00:00Z',
          },
        })
      );
      await page.route(`**/api/admin/contracts/${contractId}/signature?*`, (r) =>
        r.fulfill({
          json: {
            contractId,
            versionId: new URL(r.request().url()).searchParams.get('versionId'),
            state: 'Draft',
            isCurrent:
              new URL(r.request().url()).searchParams.get('versionId') ===
              (contractId === ID ? current.id : CREATED_VERSION),
            isAmendment: false,
            request: null,
            signature: null,
            canRequest: false,
            canRecord: false,
          },
        })
      );
    }
    const attempts: unknown[] = [];
    await page.route('**/api/admin/contracts', (r) => {
      expect(r.request().method()).toBe('POST');
      expect(r.request().headers()['x-csrf-token']).toBe('draft-fresh');
      attempts.push(r.request().postDataJSON());
      if (attempts.length === 1)
        return r.fulfill({ status: 409, json: { error: 'CONFLICT:STATE' } });
      if (attempts.length === 2) return r.fulfill({ status: 403, json: { requiresStepUp: true } });
      created = true;
      const body = r.request().postDataJSON();
      createdDto = {
        ...dto(),
        id: CREATED,
        contractNumber: '2',
        currentVersionId: CREATED_VERSION,
        currentVersion: {
          ...current,
          id: CREATED_VERSION,
          contractId: CREATED,
          content: body.content,
          changeDescription: body.changeDescription,
        },
      };
      return r.fulfill({ status: 201, json: createdDto });
    });
    await page.route(`**/api/admin/contracts/${ID}`, (r) => {
      if (r.request().method() === 'PATCH') {
        const body = r.request().postDataJSON();
        expect(body.expectedVersionId).toBe(V1);
        expect(body.content).toEqual({ ...versions[0]!.content, text: 'Revised terms' });
        expect(body).not.toHaveProperty('activationContext');
        current = {
          ...current,
          id: V2,
          versionNumber: 2,
          content: body.content,
          changeDescription: body.changeDescription,
        };
        versions.push(current);
      }
      return r.fulfill({ json: dto() });
    });
    await page.route('**/api/auth/step-up', (r) => {
      expect(r.request().postDataJSON()).toEqual({ password: 'Draft-password' });
      return cookieResponse(r, {
        json: { verified: true },
        headers: { 'Set-Cookie': 'barghsa_csrf=draft-fresh; Path=/; SameSite=Lax' },
      });
    });
    await page.goto('/admin/contracts');
    await page.getByRole('button', { name: words.draftCreate, exact: true }).click();
    const form = page.getByRole('form', { name: words.draftCreate });
    await form.getByLabel(words.draftProfile, { exact: true }).selectOption(PROFILE);
    await form.getByLabel(words.draftOrder, { exact: true }).selectOption(ORDER);
    await form.getByLabel(words.titleField, { exact: true }).fill('Supply contract');
    await form.getByLabel(words.draftTerms, { exact: true }).fill('Initial terms');
    await form.getByLabel(words.contextReason, { exact: true }).fill('Initial draft');
    await expect(page.locator('html')).toHaveClass(locale === 'fa' ? /dark/ : /^(?!.*\bdark\b)/);
    const a11y = await new AxeBuilder({ page })
      .include('form[aria-label]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(a11y.violations).toEqual([]);
    const clipped = await verifyClippedContrast(page, a11y);
    await testInfo.attach('draft-contrast-geometry', {
      body: JSON.stringify(clipped),
      contentType: 'application/json',
    });
    await page.screenshot({ path: testInfo.outputPath('draft-form.png'), fullPage: true });
    await form.getByRole('button', { name: words.draftReview, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password', {
        exact: true,
      })
      .fill('Draft-password');
    await dialog.getByRole('button', { name: confirm, exact: true }).click();
    await expect(dialog).toContainText(words.conflict);
    await dialog.getByRole('button', { name: confirm, exact: true }).click();
    await dialog
      .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password', {
        exact: true,
      })
      .fill('Draft-password');
    await dialog.getByRole('button', { name: confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toHaveLength(3);
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[0]).toEqual(attempts[2]);
    expect(attempts[1]).toMatchObject({
      profileId: PROFILE,
      orderId: ORDER,
      content: { title: 'Supply contract', text: 'Initial terms' },
    });
    // Revise the separately imported full snapshot, retaining its opaque fields.
    await page
      .getByRole('button', {
        name: `${words.electricity} · ${words.version} ${(1).toLocaleString(locale)}`,
        exact: true,
      })
      .click();
    const detail = page.getByRole('region', { name: words.terms, exact: true });
    await detail.getByRole('button', { name: words.draftEdit, exact: true }).click();
    const edit = detail.getByRole('form', { name: words.draftEdit });
    await edit.getByLabel(words.draftTerms, { exact: true }).fill('Revised terms');
    await edit.getByLabel(words.contextReason, { exact: true }).fill('Reviewed revision');
    await edit.getByRole('button', { name: words.draftReview, exact: true }).click();
    await dialog
      .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password', {
        exact: true,
      })
      .fill('Draft-password');
    await dialog.getByRole('button', { name: confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(detail.getByText('Revised terms', { exact: true })).toBeVisible();
    await expect(detail.getByText('9007199254740993', { exact: true })).toBeVisible();
    await detail
      .getByRole('button', { name: `${words.version} ${(1).toLocaleString(locale)}`, exact: true })
      .click();
    await expect(detail.getByText('Initial terms', { exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: words.draftEdit, exact: true })).toHaveCount(0);
  });
}

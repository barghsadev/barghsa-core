import { readFile } from 'node:fs/promises';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ErrorCodes } from '@barghsa/shared/errors';
import { contractText } from '@barghsa/i18n/contracts';
import { t } from '@barghsa/i18n/app';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { fullNavigation } from './navigation-fixture';

const id = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const firstInvoice = '44444444-4444-4444-8444-444444444444';
const invoiceId = '55555555-5555-4555-8555-555555555555';
const requestId = '66666666-6666-4666-8666-666666666666';
const intentId = '77777777-7777-4777-8777-777777777777';
type Surface = 'customer' | 'rejection' | 'decision';
async function fixture(page: Page, locale: 'en' | 'fa', dark: boolean, surface: Surface) {
  await crmShell(page, locale);
  const staff = surface !== 'customer';
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'operator',
        isStaff: true,
        operatingContext: staff ? 'staff' : 'customer',
        navigation: fullNavigation(staff ? 'staff' : 'customer'),
        canSwitchContext: true,
      },
    })
  );
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Contracts',
        appTitleFa: 'قراردادها',
        slogan: '',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode: dark,
      },
    })
  );
  await page.addInitScript((language) => {
    new MutationObserver(() => {
      document.documentElement.lang = language;
    }).observe(document, { childList: true });
  }, locale);
  const base = staff ? '/api/admin/contracts' : '/api/contracts';
  const version = {
    id: versionId,
    versionNumber: 1,
    content: { text: 'Published terms', price: '100' },
    changeDescription: 'Original',
    createdAt: '2026-09-21T00:00:00Z',
    acceptedAt: null,
  };
  const serviceType = surface === 'decision' ? 'solar' : 'electricity';
  const pending = {
    id: requestId,
    contractId: id,
    versionId,
    reason: 'Customer reason',
    preferredDestination: 'wallet',
    status: 'Pending',
    resolutionReason: null,
    contractState: 'Active',
    stale: false,
  };
  let resolved = false,
    cancelled = false;
  let currentRequest: Record<string, unknown> | null = surface === 'rejection' ? pending : null;
  await page.route(`**${base}?*`, (route) =>
    route.fulfill({
      json: {
        contracts: [{ id, serviceType, state: 'Active', versionId, versionNumber: 1 }],
        nextBefore: null,
      },
    })
  );
  await page.route(`**${base}/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        profileId: 'profile',
        serviceType,
        state: cancelled ? 'Cancelled' : 'Active',
        ...(staff
          ? { currentVersionId: versionId, currentVersion: version }
          : { version, canAccept: false }),
      },
    })
  );
  await page.route(`**${base}/${id}/versions`, (route) =>
    route.fulfill({ json: { versions: [version], nextBefore: null } })
  );
  await page.route(`**${base}/${id}/activation?*`, (route) =>
    route.fulfill({
      json: { checks: [], isCurrent: true, ready: false, evaluatedAt: '2026-09-21T00:00:00Z' },
    })
  );
  await page.route(`**${base}/${id}/cancellation-status`, (route) =>
    route.fulfill({
      json: {
        contractId: id,
        state: cancelled ? 'Cancelled' : 'Active',
        cancelledAt: null,
        financialStatus: cancelled ? 'refunds_pending' : 'not_cancelled',
        financiallyClosed: false,
        refundAmount: '0',
        returnedAmount: '0',
        refunds: [],
        canCancel: staff && !cancelled,
        canChooseRefund: staff,
      },
    })
  );
  await page.route(`**${base}/${id}/cancellation-requests`, (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { request: currentRequest, canRequest: !resolved } });
    return write(route);
  });
  await page.route('**/api/admin/contract-cancellation-requests/*/reject', write);
  const preview = {
    contractId: id,
    profileId: 'profile',
    versionId,
    fingerprint: 'a'.repeat(64),
    serviceType,
    refundableAmount: '9007199254741093',
    blockers: [],
    invoices: [
      {
        id: firstInvoice,
        paidAmount: '100',
        refundedAmount: '0',
        availableRefundAmount: '100',
        refundableAmount: '100',
      },
      {
        id: invoiceId,
        paidAmount: '9007199254740993',
        refundedAmount: '0',
        availableRefundAmount: '9007199254740993',
        refundableAmount: '9007199254740993',
      },
    ],
  };
  await page.route(`**/api/admin/contracts/${id}/cancellation-preview`, (route) =>
    route.fulfill({ json: preview })
  );
  let intent: null | Record<string, unknown> = null;
  await page.route(`**/api/admin/contracts/${id}/cancellations`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { intent } }) : write(route)
  );
  await page.route(`**/api/admin/contracts/${id}/cancellations/execute`, (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      intentId,
      idempotencyKey: expect.any(String),
    });
    cancelled = true;
    return route.fulfill({
      status: 201,
      json: { contractId: id, versionId, intentId, state: 'Cancelled', financiallyClosed: false },
    });
  });
  let mode: 'owned' | 'mixed' | 'service' | 'mismatch' | 'denied' | 'success' = 'owned';
  let verified = false;
  const writes: unknown[] = [];
  await page.route('**/api/auth/step-up', (route) => {
    expect(route.request().postDataJSON()).toEqual({ password: 'Test-password' });
    verified = true;
    return route.fulfill({ json: { verified: true } });
  });
  async function write(route: Route) {
    const body = route.request().postDataJSON();
    writes.push(body);
    if (!verified)
      return route.fulfill({
        status: 403,
        json: { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
      });
    if (mode === 'owned' || mode === 'mixed')
      return route.fulfill({
        status: 400,
        json: {
          error: {
            code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            fields:
              mode === 'mixed'
                ? ['reason', 'expectedVersionId']
                : surface === 'decision'
                  ? ['refundAmount0']
                  : ['reason'],
          },
          message: 'private-cancellation-diagnostic',
        },
      });
    if (mode === 'service')
      return route.fulfill({ status: 503, json: { message: 'private-cancellation-diagnostic' } });
    if (mode === 'denied')
      return route.fulfill({
        status: 403,
        json: { error: { code: ErrorCodes.AUTHZ_FORBIDDEN.code } },
      });
    let receipt: Record<string, unknown>;
    if (surface === 'decision')
      receipt = {
        id: intentId,
        contractId: id,
        versionId,
        financialFingerprint: preview.fingerprint,
        reason: body.reason,
        refundDecision: body.refundDecision,
        status: 'ready',
        approvalRequestId: null,
        customerRequestId: null,
      };
    else if (surface === 'rejection')
      receipt = { ...pending, status: 'Rejected', resolutionReason: body.reason };
    else
      receipt = {
        ...pending,
        reason: body.reason,
        preferredDestination: body.preferredDestination,
      };
    if (mode === 'mismatch')
      return route.fulfill({ status: 201, json: { ...receipt, contractId: 'other' } });
    resolved = true;
    if (surface === 'decision') intent = receipt;
    else currentRequest = receipt;
    return route.fulfill({ status: 201, json: receipt });
  }
  await page.goto(staff ? '/admin/contracts' : '/contracts');
  await page
    .getByRole('button', {
      name: `${contractText(serviceType, locale)} · ${contractText('version', locale)} ${(1).toLocaleString(locale)}`,
      exact: true,
    })
    .click();
  return {
    writes,
    setMode: (next: typeof mode) => {
      mode = next;
    },
  };
}
for (const surface of ['customer', 'rejection', 'decision'] as const)
  for (const locale of ['en', 'fa'] as const)
    for (const dark of [false, true]) {
      test(`cancellation ${surface} corrects owned fields and retains exact drafts (${locale}, ${dark ? 'dark' : 'light'})`, async ({
        page,
      }, testInfo) => {
        const w = (key: string) => contractText(key, locale);
        const f = await fixture(page, locale, dark, surface);
        await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*\bdark\b)/);
        const region = page.getByRole('region', {
          name: w(surface === 'decision' ? 'cancellationTitle' : 'cancellationRequestTitle'),
          exact: true,
          includeHidden: true,
        });
        if (surface === 'decision')
          await region.getByRole('button', { name: w('cancellationReview'), exact: true }).click();
        const form = region.locator('form');
        const reason =
          surface === 'decision'
            ? page.locator('#cancellation-reason')
            : page.locator(`#request-reason-${id}`);
        const submitLabel = w(
          surface === 'decision'
            ? 'cancellationSave'
            : surface === 'rejection'
              ? 'cancellationRequestReject'
              : 'cancellationRequestSubmit'
        );
        const submit = () =>
          form.getByRole('button', { name: submitLabel, exact: true, includeHidden: true }).click();
        await submit();
        await expect(reason).toBeFocused();
        await expect(reason).toHaveAttribute('aria-invalid', 'true');
        const feedback = await reason.getAttribute('aria-describedby');
        expect(feedback).toBeTruthy();
        await expect(page.locator(`[id="${feedback}"]`)).toContainText(
          w('cancellationReasonInvalid')
        );
        expect(f.writes).toHaveLength(0);
        await reason.fill('  Raw reason  ');
        const amount = page.locator(`#return-${invoiceId}`);
        if (surface === 'customer')
          await page.locator(`#request-destination-${id}`).selectOption('external_bank');
        if (surface === 'decision') {
          await form.getByRole('checkbox', { name: w('cancellationCustom'), exact: true }).check();
          await page.locator(`#return-${firstInvoice}`).fill('0');
          await amount.fill('9007199254740994');
          await submit();
          await expect(amount).toBeFocused();
          expect(f.writes).toHaveLength(0);
          await amount.fill('40');
          await page.locator(`#destination-${invoiceId}`).selectOption('external_bank');
        }
        await region
          .getByRole('button', {
            name: w(surface === 'decision' ? 'cancellationRefresh' : 'refresh'),
            exact: true,
          })
          .click();
        await expect(reason).toHaveValue('  Raw reason  ');
        if (surface === 'decision') {
          await expect(amount).toHaveValue('40');
          await expect(page.locator(`#destination-${invoiceId}`)).toHaveValue('external_bank');
        }
        await submit();
        const dialog = page.getByRole('dialog').last();
        const confirm = () =>
          dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
        await expect(reason).toBeDisabled();
        await confirm();
        await dialog.locator('input[type=password]').fill('Test-password');
        await confirm();
        await expect(dialog).toHaveCount(0);
        const owned = surface === 'decision' ? amount : reason;
        await expect(owned).toBeFocused();
        await expect(owned).toHaveAttribute('aria-invalid', 'true');
        await expect(reason).toHaveValue('  Raw reason  ');
        expect(f.writes).toHaveLength(2);
        expect(f.writes[0]).toEqual(f.writes[1]);
        if (surface === 'decision') {
          expect(f.writes[0]).toMatchObject({
            expectedVersionId: versionId,
            expectedFingerprint: 'a'.repeat(64),
            reason: 'Raw reason',
            refundDecision: {
              mode: 'custom',
              refunds: [{ invoiceId, amount: '40', destination: 'external_bank' }],
            },
          });
          await amount.fill('40');
        } else await reason.fill('  Raw reason  ');
        f.setMode('mixed');
        await submit();
        await confirm();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(reason).toHaveValue('  Raw reason  ');
        f.setMode('service');
        await confirm();
        await expect(dialog.getByRole('alert')).toBeVisible();
        f.setMode('mismatch');
        await confirm();
        await expect(dialog.getByRole('alert')).toBeVisible();
        expect(f.writes[2]).toEqual(f.writes[3]);
        expect(f.writes[3]).toEqual(f.writes[4]);
        await expect(page.locator('body')).not.toContainText('private-cancellation-diagnostic');
        await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
        await expect(reason).toHaveValue('  Raw reason  ');
        await expect(reason).toBeFocused();
        expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
        expect(await page.locator('html').getAttribute('dir')).toBe(
          locale === 'fa' ? 'rtl' : 'ltr'
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true);
        if (
          surface === 'decision' &&
          locale === 'fa' &&
          dark &&
          testInfo.project.name === 'mobile-safari'
        )
          await page.screenshot({
            path: '/tmp/barghsa-cancellation-fa-dark-mobile.png',
            fullPage: true,
          });
        f.setMode('denied');
        await submit();
        await confirm();
        await expect(dialog).toHaveCount(0);
        await expect(reason).toHaveCount(0);
        await region
          .getByRole('button', {
            name: w(surface === 'decision' ? 'cancellationRefresh' : 'refresh'),
            exact: true,
          })
          .click();
        await expect(reason).toHaveValue('');
        await reason.fill('  Raw reason  ');
        if (surface === 'decision') {
          await form.getByRole('checkbox', { name: w('cancellationCustom'), exact: true }).check();
          await page.locator(`#return-${firstInvoice}`).fill('0');
          await amount.fill('40');
          await page.locator(`#destination-${invoiceId}`).selectOption('external_bank');
        }
        f.setMode('success');
        await submit();
        await confirm();
        await expect(dialog).toHaveCount(0);
        if (surface === 'decision') {
          await region.getByRole('button', { name: w('cancellationConfirm'), exact: true }).click();
          await confirm();
          await expect(
            region.getByText(w('cancellationServiceEnded'), { exact: true })
          ).toBeVisible();
        } else {
          await expect(
            region.getByText(
              w(`cancellationRequest.${surface === 'customer' ? 'Pending' : 'Rejected'}`),
              { exact: true }
            )
          ).toBeVisible();
        }
      });
    }

for (const locale of ['en', 'fa'] as const)
  test(`cancellation blocks submission when validation cannot load (${locale})`, async ({
    page,
  }) => {
    const f = await fixture(page, locale, false, 'customer');
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    );
    await page.route(`**/${manifest['src/lib/cancellation-form-schemas.ts'].file}`, (route) =>
      route.abort()
    );
    const reason = page.locator(`#request-reason-${id}`);
    await reason.fill('  Keep this draft  ');
    const region = page.getByRole('region', {
      name: contractText('cancellationRequestTitle', locale),
      exact: true,
    });
    await region
      .getByRole('button', { name: contractText('cancellationRequestSubmit', locale), exact: true })
      .click();
    await expect(region.getByRole('alert')).toContainText(
      contractText('cancellationValidationUnavailable', locale)
    );
    await expect(reason).toHaveValue('  Keep this draft  ');
    expect(f.writes).toHaveLength(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

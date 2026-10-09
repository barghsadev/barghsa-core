import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/recovery';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
const id = '22222222-2222-4222-8222-222222222222',
  profileId = '11111111-1111-4111-8111-111111111111',
  challengeId = '33333333-3333-4333-8333-333333333333';
for (const locale of ['en', 'fa'] as const) {
  test(`claimant verifies only the new contact with pre-login CSRF and retains failed input (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/auth/user', (route) => route.fulfill({ status: 401, json: {} }));
    await page.route('**/api/auth/csrf', (route) =>
      route.fulfill({ json: { csrfToken: 'a'.repeat(64) } })
    );
    let fail = true;
    const requests: unknown[] = [];
    await page.route('**/api/auth/recovery/verify', (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('a'.repeat(64));
      requests.push(route.request().postDataJSON());
      return route.fulfill({ status: fail ? 401 : 200, json: fail ? {} : { verified: true } });
    });
    await page.goto('/support');
    await page.locator('#recovery-caseId').fill(id);
    await page.locator('#recovery-challengeId').fill(challengeId);
    const digit = page.getByRole('textbox', {
      name: t('auth.otp.digitLabel', locale) + ' 1',
      exact: true,
    });
    await digit.fill(locale === 'fa' ? '۱۲۳۴۵۶' : '123456');
    const submit = page.getByRole('button', {
      name: t('auth.recovery.verify', locale),
      exact: true,
    });
    await submit.click();
    await expect(
      page.getByRole('alert').filter({ hasText: t('auth.recovery.error', locale) })
    ).toBeVisible();
    await expect(page.locator('#recovery-caseId')).toHaveValue(id);
    await expect(page.locator('#recovery-challengeId')).toHaveValue(challengeId);
    fail = false;
    await submit.click();
    await expect(
      page.getByRole('status').filter({ hasText: t('auth.recovery.verified', locale) })
    ).toBeVisible();
    expect(requests).toEqual([
      { caseId: id, challengeId, code: '123456' },
      { caseId: id, challengeId, code: '123456' },
    ]);
    expect(
      (await new AxeBuilder({ page }).include('form:has(#recovery-caseId)').analyze()).violations
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.locator('form:has(#recovery-caseId)').screenshot({
      path: `/Users/majid/.local/state/barghsa-manual-batches/release-0.2-closure/recovery-public-${locale}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
  test(`staff captures the exact recovery target and hides denied private detail (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    let state = 'approved',
      denied = false;
    const writes: unknown[] = [];
    await page.route(`**/api/crm/account-recovery/${id}`, (route) =>
      route.fulfill({
        status: denied ? 403 : 200,
        json: denied
          ? {}
          : {
              id,
              profileId,
              targetUserId: 'claimant',
              oldLogin: 'old@example.test',
              newLogin: 'new@example.test',
              supportReference: 'support-1',
              reason: 'Identity documents checked',
              reviewerNotes: 'Independent review',
              state,
              createdBy: 'collector',
              reviewedBy: 'reviewer',
              challengeId,
              contactVerified: true,
              evidenceDownloadUrls: [],
              history: [
                {
                  event: 'account_recovery_reviewed',
                  created_at: '2026-10-09T08:00:00Z',
                  user_id: 'reviewer',
                  metadata: '{"decision":"approved"}',
                  correlation_id: 'case-correlation',
                },
              ],
            },
      })
    );
    await page.route(`**/api/crm/account-recovery/${id}/apply`, (route) => {
      writes.push(route.request().postDataJSON());
      state = 'applied';
      return route.fulfill({ json: { id, state } });
    });
    await page.goto('/admin/crm/recovery');
    await page.locator('#recovery-case-id').fill(id);
    await page
      .getByRole('button', { name: t('auth.recovery.load', locale), exact: true })
      .first()
      .click();
    await expect(page.getByText('new@example.test', { exact: true })).toBeVisible();
    const apply = page.getByRole('button', { name: t('auth.recovery.apply', locale), exact: true });
    await apply.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('old@example.test → new@example.test');
    await expect(dialog).toContainText(id);
    await expect(dialog).toHaveCSS('opacity', '1');
    expect(
      (await new AxeBuilder({ page }).include('[data-slot="dialog-content"]').analyze()).violations
    ).toEqual([]);
    await page.screenshot({
      path: `/Users/majid/.local/state/barghsa-manual-batches/release-0.2-closure/recovery-staff-${locale}-${test.info().project.name}.png`,
      fullPage: true,
    });
    // No recovery command executes merely by opening its explicit confirmation.
    expect(writes).toHaveLength(0);
    await page.keyboard.press('Escape');
    denied = true;
    await page
      .getByRole('button', { name: t('auth.recovery.load', locale), exact: true })
      .last()
      .click();
    await expect(page.getByText('new@example.test', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('alert').filter({ hasText: t('auth.recovery.error', locale) })
    ).toBeVisible();
  });
}
test('native browser CSP reports carry the provenance required by the bounded telemetry guard', async ({
  page,
}) => {
  const reports: Array<Record<string, string>> = [];
  await page.route('**/native-csp-closure', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: {
        'Content-Security-Policy-Report-Only': "default-src 'none'; report-uri /api/csp-report",
        'Referrer-Policy': 'no-referrer',
      },
      body: '<html><head><title>CSP test</title></head><body><img src="/csp-blocked.png" alt="Controlled CSP probe"></body></html>',
    })
  );
  await page.route('**/api/csp-report', (route) => {
    reports.push(route.request().headers());
    return route.fulfill({ status: 204 });
  });
  await page.goto('/native-csp-closure');
  await expect.poll(() => reports.length).toBeGreaterThan(0);
  for (const report of reports) {
    if (report.origin === 'null') {
      expect(report['sec-fetch-site']).toBe('same-origin');
      expect(report['sec-fetch-mode']).toBe('no-cors');
    } else expect(report.origin).toBe(new URL(page.url()).origin);
    expect(report['content-type']).toMatch(/^application\/csp-report/);
    if (report['sec-fetch-site']) expect(report['sec-fetch-site']).toBe('same-origin');
  }
});

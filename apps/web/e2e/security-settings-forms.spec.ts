import AxeBuilder from '@axe-core/playwright';
import type { Page, Route, Locator } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';
import { cookieResponse } from './cookie-response';
import { t } from '@barghsa/i18n/app';
import { trustedDeviceText } from '@barghsa/i18n/trusted-devices';
import { securitySettingsText as copy } from '@barghsa/i18n/security-settings-forms';
type Locale = 'en' | 'fa';
const session = (sessionId: string, isCurrentSession = false) => ({
  sessionId,
  deviceInfo: { userAgent: 'Windows', ip: '192.0.2.2' },
  location: { countryCode: 'US' },
  createdAt: '2026-10-05T00:00:00Z',
  updatedAt: '2026-10-05T00:00:00Z',
  expiresAt: '2030-01-01T00:00:00Z',
  idleDeadline: '2030-01-01T00:00:00Z',
  isCurrentSession,
});
const device = {
  id: 'trust-current',
  userAgent: null,
  ip: null,
  trustedAt: '2026-10-05T00:00:00Z',
  expiresAt: '2030-01-01T00:00:00Z',
  isCurrentDevice: true,
};
async function setup(page: Page, locale: Locale) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'opaque/security:customer',
        isStaff: false,
        operatingContext: 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: fullNavigation('customer', 'LEGAL'),
      },
    })
  );
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], next_cursor: null, unread_count: 0 } })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page
    .context()
    .addCookies([
      { name: 'barghsa_csrf', value: 'security-original', url: 'http://127.0.0.1:4173' },
    ]);
  const state = {
    sessions: [session('current', true), session('other-one'), session('other-two')],
    devices: [device],
    csrf: 'security-original',
    requests: [] as {
      path: string;
      method: string;
      body: unknown;
      csrf: string | undefined;
      keyed: boolean;
    }[],
    mode: 'success' as 'success' | 'stepup' | 'reject' | 'lost' | 'hold',
    readStatus: 200,
    held: null as Route | null,
    readHeld: null as Route | null,
    holdRead: false,
  };
  async function handle(route: Route) {
    const req = route.request(),
      method = req.method(),
      path = new URL(req.url()).pathname;
    const body: unknown = method === 'POST' ? req.postDataJSON() : null;
    state.requests.push({
      path,
      method,
      body,
      csrf: req.headers()['x-csrf-token'],
      keyed: 'idempotency-key' in req.headers(),
    });
    if (method === 'GET') {
      if (state.holdRead) {
        state.readHeld = route;
        return;
      }
      return route.fulfill({
        status: state.readStatus,
        json: path.endsWith('trusted-devices') ? state.devices : state.sessions,
      });
    }
    expect(req.headers()['x-csrf-token']).toBe(state.csrf);
    expect(req.headers()).not.toHaveProperty('idempotency-key');
    if (path.endsWith('step-up')) {
      if ((body as { password: string }).password === 'wrong-password')
        return route.fulfill({
          status: 422,
          json: {
            error: 'AUTH:LOGIN:INVALID_CREDENTIALS',
            message: 'private rejected-password detail',
          },
        });
      state.csrf = 'security-rotated';
      state.sessions[0] = session('rotated-current', true);
      return cookieResponse(route, {
        headers: { 'set-cookie': 'barghsa_csrf=security-rotated; Path=/; SameSite=Strict' },
        json: {
          message: 'Step-up authentication successful.',
          stepUpVerifiedAt: new Date().toISOString(),
        },
      });
    }
    if (state.mode === 'stepup') {
      state.mode = 'success';
      return route.fulfill({ status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } });
    }
    if (state.mode === 'reject')
      return route.fulfill({ status: 400, json: { message: 'private validation detail' } });
    if (state.mode === 'hold') {
      state.held = route;
      return;
    }
    if (state.mode === 'lost') return route.fulfill({ status: 503, json: {} });
    if (path.endsWith('revoke-all')) {
      const count = state.sessions.filter((v) => !v.isCurrentSession).length;
      state.sessions = state.sessions.filter((v) => v.isCurrentSession);
      return route.fulfill({
        json: {
          message: count
            ? `All ${count} other session(s) revoked.`
            : 'No other sessions to revoke.',
          revokedCount: count,
        },
      });
    }
    state.sessions = state.sessions.filter(
      (v) => path !== '/api/auth/sessions/' + encodeURIComponent(v.sessionId)
    );
    return route.fulfill({ json: { message: 'Session revoked.' } });
  }
  await page.route('**/api/auth/sessions{,/**}', handle);
  await page.route('**/api/auth/trusted-devices', handle);
  await page.route('**/api/auth/step-up', handle);
  return state;
}
async function submit(form: Locator) {
  await form.evaluate((node: HTMLFormElement) => {
    node.requestSubmit();
  });
}
async function capture(target: Locator, name: string) {
  await expect(target).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page: target.page() })
        .include('[role="dialog"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
  ).toEqual([]);
  expect(
    await target.page().evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true);
  await target.screenshot({ path: `test-results/${name}.png` });
}
for (const locale of ['en', 'fa'] as const) {
  test(`security native single/all forms retain rejected passwords and rotated authority (${locale})`, async ({
    page,
  }, info) => {
    const state = await setup(page, locale);
    await page.goto('/settings/security');
    const sessions = page.getByRole('region', {
      name: t('settings.security.sessionsTitle', locale),
      exact: true,
    });
    await expect(
      sessions.getByRole('button', { name: t('settings.security.revoke', locale), exact: true })
    ).toHaveCount(2);
    state.mode = 'stepup';
    await sessions
      .getByRole('button', { name: t('settings.security.revoke', locale), exact: true })
      .first()
      .click();
    let dialog = page.getByRole('dialog');
    await submit(dialog.locator('form'));
    const password = dialog.getByLabel(t('settings.security.passwordLabel', locale), {
      exact: true,
    });
    await expect(password).toBeFocused();
    await submit(dialog.locator('form'));
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(state.requests.filter((v) => v.method === 'POST')).toHaveLength(0);
    await password.fill('wrong-password');
    await submit(dialog.locator('form'));
    await expect(dialog.getByRole('alert')).toHaveText(copy('invalidPassword', locale));
    await expect(password).toHaveValue('wrong-password');
    await expect(dialog).not.toContainText('private');
    await capture(dialog, `security-single-rejected-${locale}-${info.project.name}`);
    await password.fill(' correct password ');
    await submit(dialog.locator('form'));
    await expect(dialog).toHaveCount(0);
    const deletes = state.requests.filter((v) => v.method === 'DELETE');
    expect(deletes).toHaveLength(2);
    expect(deletes[1]!.path).toBe('/api/auth/sessions/other-one');
    expect(deletes[1]!.csrf).toBe('security-rotated');
    const rotatedRead = state.requests.findIndex(
      (v) =>
        v.method === 'GET' &&
        v.path.endsWith('sessions') &&
        state.requests.indexOf(v) >
          state.requests.findIndex(
            (x) =>
              x.path.endsWith('step-up') &&
              (x.body as { password?: string })?.password === ' correct password '
          )
    );
    expect(rotatedRead).toBeGreaterThan(0);
    expect(rotatedRead).toBeLessThan(state.requests.indexOf(deletes[1]!));
    await sessions
      .getByRole('button', { name: t('settings.security.revokeAll', locale), exact: true })
      .click();
    dialog = page.getByRole('dialog');
    const allPassword = dialog.getByLabel(t('settings.security.passwordLabel', locale), {
      exact: true,
    });
    await submit(dialog.locator('form'));
    await expect(allPassword).toHaveAttribute('aria-invalid', 'true');
    await allPassword.fill(' retained raw password ');
    state.mode = 'reject';
    await submit(dialog.locator('form'));
    await expect(allPassword).toHaveValue(' retained raw password ');
    await expect(dialog.getByRole('alert')).toHaveText(copy('error', locale));
    await expect(dialog).not.toContainText('private');
    await capture(dialog, `security-all-rejected-${locale}-${info.project.name}`);
    state.mode = 'success';
    await submit(dialog.locator('form'));
    await expect(dialog).toHaveCount(0);
    expect(state.sessions).toEqual([session('rotated-current', true)]);
    expect(state.devices).toEqual([device]);
    expect(state.requests.filter((v) => v.path.endsWith('revoke-all')).map((v) => v.body)).toEqual([
      { password: ' retained raw password ' },
      { password: ' retained raw password ' },
    ]);
    await expect(page.getByRole('status')).toHaveText(copy('confirmed', locale));
    await expect(page.locator('main')).not.toContainText('settings.security.');
  });
  test(`security uncertain writes use authorized reads, retain intent and retire denied state (${locale})`, async ({
    page,
  }, info) => {
    const state = await setup(page, locale);
    await page.goto('/settings/security');
    const sessions = page.getByRole('region', {
      name: t('settings.security.sessionsTitle', locale),
      exact: true,
    });
    await sessions
      .getByRole('button', { name: t('settings.security.revoke', locale), exact: true })
      .first()
      .click();
    let dialog = page.getByRole('dialog');
    state.mode = 'hold';
    await dialog.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => state.held !== null).toBe(true);
    await expect(
      page.getByRole('button', { name: copy('refresh', locale), exact: true, includeHidden: true })
    ).toBeDisabled();
    await expect(
      page.getByRole('button', {
        name: trustedDeviceText('remove', locale),
        exact: true,
        includeHidden: true,
      })
    ).toBeDisabled();
    state.sessions = state.sessions.filter((v) => v.sessionId !== 'other-one');
    await state.held!.fulfill({ status: 503, json: {} });
    state.held = null;
    await expect(dialog.getByRole('alert')).toHaveText(copy('uncertain', locale));
    await capture(dialog, `security-single-uncertain-${locale}-${info.project.name}`);
    await dialog.getByRole('button', { name: copy('check', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.requests.filter((v) => v.method === 'DELETE')).toHaveLength(1);
    await sessions
      .getByRole('button', { name: t('settings.security.revokeAll', locale), exact: true })
      .click();
    dialog = page.getByRole('dialog');
    const password = dialog.getByLabel(t('settings.security.passwordLabel', locale), {
      exact: true,
    });
    await password.fill(' retained uncertain password ');
    state.mode = 'lost';
    await submit(dialog.locator('form'));
    await expect(password).toBeDisabled();
    await dialog.getByRole('button', { name: copy('check', locale), exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: copy('restart', locale), exact: true })
    ).toBeVisible();
    state.holdRead = true;
    await dialog.evaluate(
      (node, labels) => {
        const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>('button'));
        const restart = buttons.find((v) => v.textContent === labels.restart)!;
        buttons.find((v) => v.textContent === labels.check)!.click();
        restart.click();
        node.querySelector<HTMLFormElement>('form')!.requestSubmit();
      },
      { check: copy('check', locale), restart: copy('restart', locale) }
    );
    await expect.poll(() => state.readHeld !== null).toBe(true);
    expect(state.requests.filter((v) => v.path.endsWith('revoke-all'))).toHaveLength(1);
    await state.readHeld!.fulfill({ json: state.sessions });
    state.readHeld = null;
    state.holdRead = false;
    await expect(
      dialog.getByRole('button', { name: copy('restart', locale), exact: true })
    ).toBeVisible();
    await capture(dialog, `security-all-checked-${locale}-${info.project.name}`);
    await dialog.getByRole('button', { name: copy('restart', locale), exact: true }).click();
    await expect(password).toHaveValue(' retained uncertain password ');
    state.mode = 'success';
    await submit(dialog.locator('form'));
    await expect(dialog).toHaveCount(0);
    state.readStatus = 401;
    await page
      .getByRole('button', { name: trustedDeviceText('refresh', locale), exact: true })
      .click();
    await expect(
      page.getByRole('region', { name: trustedDeviceText('title', locale), exact: true })
    ).toHaveCount(0);
    await expect(sessions).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveText(copy('denied', locale));
    expect(state.requests.filter((v) => v.path.endsWith('revoke-all'))).toHaveLength(2);
  });
}

import AxeBuilder from '@axe-core/playwright';
import type { Page, Route, Locator } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { mockPublicAuthCsrf } from './public-auth-fixture';
import { t } from '@barghsa/i18n/auth';
import { passwordRecoveryText as copy } from '@barghsa/i18n/password-recovery-forms';
type Locale = 'en' | 'fa';
async function setup(page: Page, locale: Locale) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  await mockPublicAuthCsrf(page);
  const state = {
    challengeId: '00000000-0000-4000-8000-000000000001',
    issued: 0,
    mode: 'success' as
      'success' | 'codeReject' | 'passwordReject' | 'malformedVerify' | 'holdReset',
    held: null as Route | null,
    writes: [] as { path: string; body: Record<string, string> }[],
  };
  await page.route(
    '**/api/auth/{forgot-password,reset-password,reset-password/verify}',
    async (route) => {
      const path = new URL(route.request().url()).pathname,
        body = route.request().postDataJSON() as Record<string, string>;
      expect(route.request().headers()['x-csrf-token']).toBe('c'.repeat(64));
      expect(route.request().headers()['accept-language']).toBe(locale);
      expect(route.request().headers()).not.toHaveProperty('idempotency-key');
      state.writes.push({ path, body });
      if (path.endsWith('forgot-password')) {
        state.issued++;
        state.challengeId = `00000000-0000-4000-8000-${String(state.issued).padStart(12, '0')}`;
        return route.fulfill({
          json: {
            challengeId: state.challengeId,
            sent: true,
            message: 'If an account exists, a verification code has been queued.',
          },
        });
      }
      expect(body.challengeId).toBe(state.challengeId);
      if (path.endsWith('/verify')) {
        expect(body.otp).toBe('123456');
        if (state.mode === 'codeReject')
          return route.fulfill({
            status: 401,
            json: { error: { code: 'AUTH:OTP:INVALID' }, message: 'private OTP detail' },
          });
        return route.fulfill({
          json: {
            verified: true,
            challengeId: state.mode === 'malformedVerify' ? 'wrong-challenge' : state.challengeId,
            resetToken: 'a'.repeat(64),
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          },
        });
      }
      expect(body.resetToken).toBe('a'.repeat(64));
      expect(body).not.toHaveProperty('otp');
      if (state.mode === 'passwordReject')
        return route.fulfill({
          status: 422,
          json: { error: 'AUTH:LOGIN:PASSWORD_REUSED', message: 'private password-history detail' },
        });
      if (state.mode === 'holdReset') {
        state.held = route;
        return;
      }
      return route.fulfill({
        json: { message: 'Your password has been reset. Please log in with your new password.' },
      });
    }
  );
  return state;
}
async function submit(page: Page) {
  await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
}
async function code(page: Page, locale: Locale) {
  await page.locator('#recovery-code').fill(locale === 'fa' ? '۱۲۳۴۵۶' : '123456');
}
async function passwords(page: Page) {
  await page.locator('#new-password').fill(' Raw synthetic recovery value 12A ');
  await page.locator('#confirm-password').fill(' Raw synthetic recovery value 12A ');
}
async function capture(form: Locator, name: string) {
  const page = form.page();
  const panel = form.locator('..');
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      panel.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === 'running' || a.pending).length
      )
    )
    .toBe(0);
  expect(
    (
      await new AxeBuilder({ page })
        .include('div.space-y-6[dir]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await panel.screenshot({ path: `test-results/${name}.png` });
}
for (const locale of ['en', 'fa'] as const) {
  test(`native password recovery validates each stage and retains rejected code/password (${locale})`, async ({
    page,
  }, info) => {
    const state = await setup(page, locale);
    await page.goto('/forgot-password');
    await page.locator('#username').fill('invalid value');
    await submit(page);
    await expect(page.locator('#username')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#username')).toBeFocused();
    expect(state.writes).toHaveLength(0);
    await capture(
      page.locator('form'),
      `recovery-destination-invalid-${locale}-${info.project.name}`
    );
    await page.locator('#username').fill(' Recovery@Example.test ');
    await submit(page);
    await expect(page.locator('#reset-otp input')).toHaveCount(6);
    expect(state.writes[0]!.body).toEqual({ username: 'recovery@example.test' });
    state.mode = 'codeReject';
    await code(page, locale);
    await expect(page.getByRole('alert')).toHaveText(t('auth.otp.error.invalid', locale));
    await expect(page.locator('#recovery-code')).toHaveValue('1');
    await expect(page.locator('#recovery-code')).toHaveAttribute(
      'aria-describedby',
      'recovery-code-error'
    );
    await page.locator('#recovery-code').fill('');
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText(copy('codeInvalid', locale));
    expect(state.writes).toHaveLength(2);
    state.mode = 'success';
    await code(page, locale);
    await expect(page.locator('#new-password')).toBeFocused();
    await page.locator('#new-password').fill('weak');
    await page.locator('#confirm-password').fill('weak');
    await submit(page);
    await expect(page.locator('#new-password')).toHaveAttribute('aria-invalid', 'true');
    expect(state.writes).toHaveLength(3);
    await passwords(page);
    await page.locator('#confirm-password').fill('Different synthetic recovery value 12A');
    await submit(page);
    await expect(page.locator('#confirm-password')).toHaveAttribute('aria-invalid', 'true');
    expect(state.writes).toHaveLength(3);
    await passwords(page);
    state.mode = 'passwordReject';
    await submit(page);
    await expect(page.getByRole('alert').first()).toHaveText(
      t('auth.login.error.passwordReused', locale)
    );
    await expect(page.locator('#new-password')).toHaveValue(' Raw synthetic recovery value 12A ');
    await expect(page.locator('#confirm-password')).toHaveValue(
      ' Raw synthetic recovery value 12A '
    );
    await expect(page.locator('form')).not.toContainText('private');
    await capture(
      page.locator('form'),
      `recovery-password-rejected-${locale}-${info.project.name}`
    );
    state.mode = 'success';
    await submit(page);
    await expect(page).toHaveURL(/\/login$/);
    expect(state.writes).toHaveLength(5);
    expect(state.writes.at(-1)!.body).toEqual({
      challengeId: state.challengeId,
      resetToken: 'a'.repeat(64),
      newPassword: ' Raw synthetic recovery value 12A ',
    });
    expect(await page.evaluate(() => JSON.stringify([sessionStorage, localStorage]))).not.toContain(
      ' Raw synthetic recovery value 12A '
    );
    await expect(page.locator('#password')).toHaveValue('');
  });
  test(`unknown recovery results never replay a consumed capability and explicit restart retires old forms (${locale})`, async ({
    page,
  }, info) => {
    await page.clock.install();
    const state = await setup(page, locale);
    await page.goto('/forgot-password');
    await page.locator('#username').fill(' Recovery@Example.test ');
    await submit(page);
    state.mode = 'malformedVerify';
    await code(page, locale);
    await expect(page.getByRole('alert')).toHaveText(copy('uncertain', locale));
    await expect(page.locator('button[type=submit]')).toBeDisabled();
    await submit(page);
    expect(state.writes).toHaveLength(2);
    await expect(page.locator('#recovery-code')).toHaveValue('1');
    await expect(page.locator('#new-password')).toHaveCount(0);
    await capture(page.locator('form'), `recovery-code-uncertain-${locale}-${info.project.name}`);
    await page.getByRole('button', { name: copy('restart', locale), exact: true }).click();
    await expect(page.locator('#username')).toHaveValue(' Recovery@Example.test ');
    await page.clock.runFor(61_000);
    state.mode = 'success';
    await submit(page);
    await code(page, locale);
    await passwords(page);
    state.mode = 'holdReset';
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => !!state.held).toBe(true);
    await expect(page.locator('#new-password')).toBeDisabled();
    expect(state.writes.filter((v) => v.path.endsWith('reset-password'))).toHaveLength(1);
    await state.held!.fulfill({ status: 503, json: {} });
    state.held = null;
    await expect(page.getByRole('alert')).toHaveText(copy('uncertain', locale));
    await expect(page.locator('#new-password')).toHaveValue(' Raw synthetic recovery value 12A ');
    await capture(page.locator('form'), `recovery-reset-uncertain-${locale}-${info.project.name}`);
    await page.locator('form').evaluate(
      (form: HTMLFormElement, restartLabel) => {
        Array.from(form.querySelectorAll<HTMLButtonElement>('button'))
          .find((v) => v.textContent === restartLabel)!
          .click();
        form.requestSubmit();
      },
      copy('restart', locale)
    );
    await expect(page.locator('#new-password')).toHaveCount(0);
    expect(state.writes.filter((v) => v.path.endsWith('reset-password'))).toHaveLength(1);
    expect(state.writes).toHaveLength(5);
    await expect(page.locator('#username')).toHaveValue(' Recovery@Example.test ');
  });
}

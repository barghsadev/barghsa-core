import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { mockPublicAuthCsrf } from './public-auth-fixture';
import { loginFormText } from '@barghsa/i18n/login-forms';
type Locale = 'en' | 'fa';
const id = '00000000-0000-4000-8000-000000000001';
const secret = [' old synthetic ', 'credential '].join('');
const newSecret = [' Raw synthetic change ', '12A '].join('');
async function setup(page: Page, locale: Locale) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  await page.addInitScript((lang) => localStorage.setItem('barghsa-locale', lang), locale);
  await mockPublicAuthCsrf(page);
  const state = {
    writes: [] as { path: string; body: Record<string, unknown> }[],
    mode: 'holdLogin' as 'holdLogin' | 'change' | 'knownChange' | 'otp' | 'holdVerify',
    held: null as Route | null,
  };
  await page.route(
    '**/api/auth/{login,force-change-password,login/verify,login/resend}',
    async (route) => {
      const path = new URL(route.request().url()).pathname,
        body = route.request().postDataJSON() as Record<string, unknown>;
      expect(route.request().headers()['x-csrf-token']).toBe('c'.repeat(64));
      expect(route.request().headers()['accept-language']).toBe(locale);
      expect(route.request().headers()).not.toHaveProperty('idempotency-key');
      state.writes.push({ path, body });
      if (path.endsWith('/login')) {
        expect(body).toEqual({ username: 'draft@example.test', password: secret });
        if (state.mode === 'holdLogin') {
          state.held = route;
          return;
        }
        return route.fulfill({
          json:
            state.mode === 'otp'
              ? { requiresOtp: true, challengeId: id }
              : {
                  requiresOtp: false,
                  mustChangePassword: true,
                  passwordChangeToken: 'change-grant',
                },
        });
      }
      if (path.endsWith('/force-change-password')) {
        expect(body).toEqual({ passwordChangeToken: 'change-grant', newPassword: newSecret });
        return state.mode === 'knownChange'
          ? route.fulfill({
              status: 422,
              json: { error: 'AUTH:LOGIN:PASSWORD_REUSED', message: 'private detail' },
            })
          : route.fulfill({ json: { message: 'Password changed' } });
      }
      expect(body.challengeId).toBe(id);
      if (path.endsWith('/verify')) {
        expect(body).toEqual({ challengeId: id, otp: '123456', trustDevice: true });
        if (state.mode === 'holdVerify') {
          state.held = route;
          return;
        }
      }
      return route.fulfill({ json: { challengeId: id } });
    }
  );
  return state;
}
async function submit(page: Page) {
  await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
}
async function capture(page: Page, name: string) {
  const panel = page.locator('div.space-y-6[dir]');
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      panel.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === 'running' || animation.pending).length
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: `test-results/${name}.png` });
}
for (const locale of ['en', 'fa'] as const) {
  test(`native login validates credentials and owns an unknown sign-in through explicit restart (${locale})`, async ({
    page,
  }, info) => {
    const state = await setup(page, locale);
    await page.goto('/login');
    await page.locator('#username').fill('invalid');
    await submit(page);
    await expect(page.locator('#username')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#username')).toBeFocused();
    expect(state.writes).toHaveLength(0);
    await capture(page, `login-credentials-invalid-${locale}-${info.project.name}`);
    await page.locator('#username').fill(' Draft@Example.test ');
    await page.locator('#password').fill(secret);
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => !!state.held).toBe(true);
    expect(state.writes).toHaveLength(1);
    await expect(page.locator('#username')).toBeDisabled();
    await expect(page.locator('#password')).toBeDisabled();
    await state.held!.fulfill({ status: 503, json: {} });
    state.held = null;
    await expect(page.getByRole('alert')).toContainText(loginFormText('uncertain', locale));
    await expect(page.locator('#password')).toHaveValue(secret);
    await expect(page.locator('button[type=submit]')).toBeDisabled();
    await capture(page, `login-credentials-uncertain-${locale}-${info.project.name}`);
    await page.evaluate(
      (restart) => {
        const form = document.querySelector('form')!,
          password = document.querySelector<HTMLInputElement>('#password')!;
        [...document.querySelectorAll('button')]
          .find((button) => button.textContent === restart)!
          .click();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          password,
          'retired input'
        );
        password.dispatchEvent(new Event('input', { bubbles: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      },
      loginFormText('restart', locale)
    );
    await expect(page.locator('#password')).toHaveValue('');
    await expect(page.locator('#username')).toHaveValue(' Draft@Example.test ');
    expect(state.writes).toHaveLength(1);
  });
  test(`native required change and OTP preserve captured values, trust and uncertain ownership (${locale})`, async ({
    page,
  }, info) => {
    await page.clock.install();
    const state = await setup(page, locale);
    state.mode = 'change';
    await page.goto('/login');
    await page.locator('#username').fill(' Draft@Example.test ');
    await page.locator('#password').fill(secret);
    await submit(page);
    await page.locator('#new-password').fill('weak');
    await page.locator('#confirm-password').fill('different');
    await submit(page);
    await expect(page.locator('#new-password')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#confirm-password')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#new-password')).toBeFocused();
    expect(state.writes).toHaveLength(1);
    await capture(page, `login-change-invalid-${locale}-${info.project.name}`);
    await page.locator('#new-password').fill(newSecret);
    await submit(page);
    await expect(page.locator('#confirm-password')).toBeFocused();
    expect(state.writes).toHaveLength(1);
    await page.locator('#confirm-password').fill(newSecret);
    state.mode = 'knownChange';
    await submit(page);
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.locator('#new-password')).toHaveValue(newSecret);
    await expect(page.locator('#confirm-password')).toHaveValue(newSecret);
    await expect(page.locator('main')).not.toContainText('private detail');
    state.mode = 'change';
    await submit(page);
    await expect(page.locator('#password')).toHaveValue('');
    await expect(page.locator('#username')).toHaveValue(' Draft@Example.test ');
    state.mode = 'otp';
    await page.locator('#password').fill(secret);
    await submit(page);
    await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(6);
    await page.clock.fastForward(61_000);
    const resend = page.getByRole('button', {
      name: locale === 'fa' ? 'ارسال مجدد' : 'Resend code',
      exact: true,
    });
    await expect(resend).toBeEnabled();
    const digits = page.locator('input[inputmode="numeric"]');
    await digits.first().fill('123');
    await submit(page);
    await expect(digits.first()).toHaveAttribute('aria-invalid', 'true');
    await expect(digits.first()).toBeFocused();
    expect(state.writes.filter((x) => x.path.endsWith('/verify'))).toHaveLength(0);
    state.mode = 'holdVerify';
    await digits.first().fill('۱۲۳۴۵۶');
    // Completing the code must leave time to opt into device trust.
    await expect(page.locator('#trust-device')).toBeEnabled();
    expect(state.writes.filter((x) => x.path.endsWith('/verify'))).toHaveLength(0);
    await page.locator('#trust-device').check();
    await page.screenshot({
      path: `test-results/login-trust-ready-${locale}-${info.project.name}.png`,
      fullPage: true,
    });
    await page.locator('button[type=submit]').click();
    await expect.poll(() => !!state.held).toBe(true);
    await expect(page.locator('#trust-device')).toBeDisabled();
    await expect(resend).toBeDisabled();
    await submit(page);
    expect(state.writes.filter((x) => x.path.endsWith('/verify'))).toHaveLength(1);
    expect(state.writes.filter((x) => x.path.endsWith('/resend'))).toHaveLength(0);
    await state.held!.fulfill({ json: null });
    state.held = null;
    await expect(page.locator('main [role="alert"]')).toContainText(
      loginFormText('uncertain', locale)
    );
    await expect(digits.first()).toHaveValue('1');
    await expect(digits.first()).toBeDisabled();
    await expect(page.locator('#trust-device')).toBeChecked();
    await expect(page).toHaveURL(/\/login$/);
    await capture(page, `login-otp-uncertain-${locale}-${info.project.name}`);
    await page.getByRole('button', { name: loginFormText('restart', locale), exact: true }).click();
    await expect(page.locator('#password')).toHaveValue('');
    await expect(digits).toHaveCount(0);
  });
}

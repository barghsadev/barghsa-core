import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { mockPublicAuthCsrf } from './public-auth-fixture';
import { registrationFormText } from '@barghsa/i18n/registration-forms';
import { t } from '@barghsa/i18n/auth';
type Locale = 'en' | 'fa';
const id = '00000000-0000-4000-8000-000000000001';
const secret = ' Raw synthetic registration value 12A ';
async function setup(page: Page, locale: Locale) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  await mockPublicAuthCsrf(page);
  await page.route('**/api/tos/current?*', (route) =>
    route.fulfill({
      json: {
        id,
        versionId: 'v1',
        content: 'Published terms',
        updatedAt: '2026-09-01T00:00:00Z',
        publishedAt: '2026-09-01T00:00:00Z',
      },
    })
  );
  const state = {
    writes: [] as { path: string; body: Record<string, unknown> }[],
    mode: 'holdRegister' as 'holdRegister' | 'holdVerify' | 'knownCode' | 'success',
    held: null as Route | null,
  };
  await page.route('**/api/auth/{register,register/verify,register/resend}', async (route) => {
    const path = new URL(route.request().url()).pathname,
      body = route.request().postDataJSON() as Record<string, unknown>;
    expect(route.request().headers()['x-csrf-token']).toBe('c'.repeat(64));
    expect(route.request().headers()['accept-language']).toBe(locale);
    expect(route.request().headers()).not.toHaveProperty('idempotency-key');
    state.writes.push({ path, body });
    if (path.endsWith('/register')) {
      expect(body).toEqual({ username: 'draft@example.test', password: secret, tosVersionId: id });
      if (state.mode === 'holdRegister') {
        state.held = route;
        return;
      }
      return route.fulfill({ json: { challengeId: id } });
    }
    expect(body.challengeId).toBe(id);
    if (path.endsWith('/verify')) {
      expect(body.otp).toBe('123456');
      if (state.mode === 'knownCode')
        return route.fulfill({
          status: 401,
          json: { error: 'AUTH:OTP:INVALID', message: 'private registration detail' },
        });
      if (state.mode === 'holdVerify') {
        state.held = route;
        return;
      }
      return route.fulfill({
        json: {
          userId: 'user',
          sessionId: 'session',
          csrfToken: 'csrf',
          expiresAt: '2030-01-01T00:00:00Z',
        },
      });
    }
    return route.fulfill({ json: { challengeId: id } });
  });
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
  test(`native registration validates destination and consent and holds an uncertain captured start (${locale})`, async ({
    page,
  }, info) => {
    const state = await setup(page, locale);
    await page.goto('/register');
    await page.locator('#username').fill('invalid value');
    await submit(page);
    await expect(page.locator('#username')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#username')).toBeFocused();
    expect(state.writes).toHaveLength(0);
    await capture(page, `registration-destination-invalid-${locale}-${info.project.name}`);
    await page.locator('#username').fill(' Draft@Example.test ');
    await page.locator('#username').press('Tab');
    await page.locator('#password').fill(secret);
    await submit(page);
    await expect(page.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('checkbox')).toBeFocused();
    expect(state.writes).toHaveLength(0);
    await capture(page, `registration-consent-invalid-${locale}-${info.project.name}`);
    await page.getByRole('checkbox').check();
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => !!state.held).toBe(true);
    expect(state.writes).toHaveLength(1);
    await expect(page.locator('#username')).toBeDisabled();
    await expect(page.locator('#password')).toBeDisabled();
    await expect(page.getByRole('checkbox')).toBeDisabled();
    const terms = page.locator('#tos-label a');
    await expect(terms).toHaveAttribute('aria-disabled', 'true');
    await terms.evaluate((element: HTMLElement) => element.click());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await state.held!.fulfill({ status: 503, json: {} });
    state.held = null;
    await expect(page.locator('form [role=alert]').first()).toHaveText(
      registrationFormText('uncertain', locale)
    );
    await expect(page.locator('#username')).toHaveValue(' Draft@Example.test ');
    await expect(page.locator('#password')).toHaveValue(secret);
    await expect(page.getByRole('checkbox')).toBeChecked();
    await submit(page);
    expect(state.writes).toHaveLength(1);
    await capture(page, `registration-start-uncertain-${locale}-${info.project.name}`);
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      const password = form.querySelector<HTMLInputElement>('#password')!,
        consent = form.querySelector<HTMLElement>('[role="checkbox"]')!;
      const restart = form.querySelector<HTMLButtonElement>('button[type=button]')!;
      // The visibility toggle precedes restart; select the enabled outline action.
      Array.from(form.querySelectorAll<HTMLButtonElement>('button[type=button]'))
        .find((button) => !button.disabled && button !== restart)!
        .click();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        password,
        ' Retired synthetic value 12A '
      );
      password.dispatchEvent(new Event('input', { bubbles: true }));
      consent.click();
      form.requestSubmit();
    });
    expect(state.writes).toHaveLength(1);
    await expect(page.locator('#username')).toHaveValue(' Draft@Example.test ');
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    expect(
      (await page.locator('#password').count()) ? await page.locator('#password').inputValue() : ''
    ).toBe('');
    await page.locator('#username').press('Tab');
    await page.locator('#password').fill(secret);
    await page.getByRole('checkbox').check();
    state.mode = 'success';
    await submit(page);
    await expect(page).toHaveURL(/\/register\/verify\?/);
    expect(state.writes).toHaveLength(2);
    expect(new URL(page.url()).searchParams.get('destination')).toBe('d***@example.test');
    expect(page.url()).not.toContain(secret);
  });
  test(`native registration OTP keeps clearing policy and serializes uncertainty with resend (${locale})`, async ({
    page,
  }, info) => {
    await page.clock.install();
    const state = await setup(page, locale);
    state.mode = 'knownCode';
    await page.goto(`/register/verify?challengeId=${id}&destination=d***@example.test`);
    await page.locator('#registration-code').fill('123');
    await submit(page);
    expect(state.writes).toHaveLength(0);
    await expect(page.locator('#registration-code')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#registration-code')).toBeFocused();
    await page.locator('#registration-code').fill(locale === 'fa' ? '۱۲۳۴۵۶' : '123456');
    await expect(page.getByRole('alert').first()).toHaveText(t('auth.otp.error.invalid', locale));
    await expect(page.locator('#registration-code')).toHaveValue('');
    await expect(page.locator('#registration-code')).toBeFocused();
    await page.clock.runFor(61_000);
    state.mode = 'holdVerify';
    await page.locator('#registration-code').fill('123456');
    await expect.poll(() => !!state.held).toBe(true);
    await expect(page.locator('#registration-code')).toBeDisabled();
    const resend = page.getByRole('button', { name: t('auth.otp.resend', locale), exact: true });
    await expect(resend).toBeDisabled();
    await resend.evaluate((button: HTMLButtonElement) => button.click());
    await submit(page);
    expect(state.writes).toHaveLength(2);
    await state.held!.fulfill({ json: { userId: 'incomplete' } });
    state.held = null;
    await expect(page.getByRole('alert').first()).toHaveText(
      registrationFormText('uncertain', locale)
    );
    await expect(page.locator('#registration-code')).toHaveValue('1');
    await expect(page.locator('#registration-code')).toBeDisabled();
    await page.clock.runFor(1_000);
    await capture(page, `registration-code-uncertain-${locale}-${info.project.name}`);
    await submit(page);
    await resend.evaluate((button: HTMLButtonElement) => button.click());
    expect(state.writes).toHaveLength(2);
    await expect(page).toHaveURL(/\/register\/verify\?/);
    await page
      .getByRole('button', { name: registrationFormText('restart', locale), exact: true })
      .click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.locator('#username')).toHaveValue('');
    expect(state.writes).toHaveLength(2);
  });
}

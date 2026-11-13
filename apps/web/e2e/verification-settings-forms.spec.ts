import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { cookieResponse } from './cookie-response';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const) {
  test(`reviews an audited verification mode before restoring its draft (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    const text = (key: Parameters<typeof verificationConfigText>[0]) =>
      verificationConfigText(key, locale);
    const path = '/api/admin/config/profile-verification-mode';
    const sourceId = '00000000-0000-4000-8000-000000000062';
    const commands: unknown[] = [];
    let state: { mode: string; draft: string | null; version: number } = {
      mode: 'DISABLED',
      draft: null,
      version: 4,
    };
    await page.route('**' + path + '/history', (route) =>
      route.fulfill({
        json: {
          items: [{ id: sourceId, version: 2, value: 'MANUAL' }],
          nextBeforeVersion: null,
        },
      })
    );
    await page.route('**' + path, (route) => {
      if (route.request().method() === 'PUT') {
        commands.push(route.request().postDataJSON());
        state = { ...state, draft: 'MANUAL', version: 5 };
      }
      return route.fulfill({ json: state });
    });
    await page.goto('/admin/verification');
    await page.getByRole('button', { name: text('modeHistory'), exact: true }).click();
    const history = page.getByRole('region', { name: text('modeHistory') });
    await history.getByRole('button', { name: text('policyRestore') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(text('MANUAL'), { exact: true })).toBeVisible();
    expect(commands).toEqual([]);
    await dialog
      .getByRole('button', { name: adminText('team.confirm', locale), exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(commands).toEqual([{ action: 'restore', sourceId, expectedVersion: 4 }]);
    await expect(
      page.getByText(`${text('activeMode')}: ${text('DISABLED')}`, { exact: true })
    ).toBeVisible();
    await expect(page.locator('#verification-mode-MANUAL')).toBeChecked();
  });
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`verification and OTP forms preserve independent drafts and owned feedback (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      const text = (key: Parameters<typeof verificationConfigText>[0]) =>
        verificationConfigText(key, locale);
      let verification: { mode: string; draft: string | null; version: number } = {
        mode: 'DISABLED',
        draft: null,
        version: 0,
      };
      let otp = { ttlSeconds: 300, version: 0 };
      let denyRead = false;
      const draftWrites: unknown[] = [],
        otpWrites: unknown[] = [],
        activations: unknown[] = [];
      await page.route('**/api/auth/step-up', (route) =>
        cookieResponse(route, {
          json: { verified: true },
          headers: { 'Set-Cookie': 'barghsa_csrf=forms-fresh; Path=/; SameSite=Lax' },
        })
      );
      const invalid = (field: string) => ({
        status: 400,
        json: {
          error: {
            code: 'VALIDATION:INPUT:INVALID',
            fields: [field],
            message: 'private-server-value',
          },
        },
      });
      await page.route('**/api/admin/config/profile-verification-mode', (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ status: denyRead ? 503 : 200, json: verification });
        const body = route.request().postDataJSON();
        if (body.action === 'draft') {
          draftWrites.push(body);
          if (draftWrites.length === 1) return route.fulfill(invalid('mode'));
          verification = { ...verification, draft: body.mode, version: body.expectedVersion + 1 };
        } else {
          activations.push(body);
          expect(route.request().headers()['x-csrf-token']).toBe('forms-fresh');
          verification = { mode: body.mode, draft: null, version: body.expectedVersion + 1 };
        }
        return route.fulfill({ json: verification });
      });
      await page.route('**/api/admin/config/otp', (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ status: denyRead ? 503 : 200, json: otp });
        const body = route.request().postDataJSON();
        otpWrites.push(body);
        expect(route.request().headers()['x-csrf-token']).toBe('forms-fresh');
        if (otpWrites.length === 1) return route.fulfill(invalid('ttlSeconds'));
        otp = { ttlSeconds: body.ttlSeconds, version: body.expectedVersion + 1 };
        return route.fulfill({ json: otp });
      });
      await page.goto('/admin/verification');
      const mode = page.locator('#verification-mode-MANUAL'),
        ttl = page.locator('#otp-lifetime');
      const button = (key: Parameters<typeof text>[0]) =>
        page.getByRole('button', { name: text(key), exact: true });
      const status = (key: Parameters<typeof text>[0]) =>
        page
          .getByRole('main')
          .getByRole('status')
          .filter({ hasText: text(key) });
      const confirm = async () => {
        const dialog = page.getByRole('dialog');
        await dialog
          .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
          .fill('Settings-password-123!');
        await dialog.locator('button[type=submit]').click();
        await expect(dialog).toHaveCount(0);
      };
      await expect(ttl).toHaveValue('300');
      await mode.check();
      await ttl.fill('60.5');
      await button('otpSave').click();
      await expect(ttl).toBeFocused();
      await expect(ttl).toHaveAttribute('aria-invalid', 'true');
      expect(otpWrites).toHaveLength(0);
      await expect(mode).toBeChecked();
      await ttl.fill('120');
      await button('save').click();
      await expect(mode).toBeFocused();
      await expect(mode.locator('xpath=ancestor::fieldset')).toHaveAttribute(
        'aria-invalid',
        'true'
      );
      await expect(ttl).toHaveValue('120');
      await expect(page.locator('main[data-area=admin]')).not.toContainText('private-server-value');
      const linked = await mode.getAttribute('aria-describedby');
      expect(linked).toContain('-mode-error');
      await page.screenshot({
        path: info.outputPath('verification-mode-feedback.png'),
        fullPage: true,
      });
      await button('otpSave').click();
      await confirm();
      await expect(ttl).toBeFocused();
      await expect(mode).toBeChecked();
      await expect(ttl).toHaveValue('120');
      const results = await new AxeBuilder({ page }).include('main[data-area=admin]').analyze();
      expect(results.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({
        path: info.outputPath('verification-settings-feedback.png'),
        fullPage: true,
      });
      denyRead = true;
      await button('reload').click();
      await expect(mode).toBeDisabled();
      await expect(mode).toBeChecked();
      await button('otpReload').click();
      await expect(ttl).toBeDisabled();
      await expect(ttl).toHaveValue('120');
      denyRead = false;
      await button('reload').click();
      await expect(mode).toBeEnabled();
      await button('otpReload').click();
      await expect(ttl).toBeEnabled();
      await button('save').click();
      await expect(status('saved')).toHaveText(text('saved'));
      await expect(ttl).toHaveValue('120');
      await button('activate').click();
      await confirm();
      await expect(status('activated')).toHaveText(text('activated'));
      await expect(ttl).toHaveValue('120');
      await button('otpSave').click();
      await confirm();
      await expect(status('otpSaved')).toHaveText(text('otpSaved'));
      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: text('otpSaved') })
      ).toHaveCount(1);
      expect(draftWrites).toEqual(
        Array(2).fill({ mode: 'MANUAL', expectedVersion: 0, action: 'draft' })
      );
      expect(activations).toEqual([{ mode: 'MANUAL', expectedVersion: 1, action: 'activate' }]);
      expect(otpWrites).toEqual(Array(2).fill({ ttlSeconds: 120, expectedVersion: 0 }));
    });
  }

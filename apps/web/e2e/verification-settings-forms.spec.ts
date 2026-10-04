import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { cookieResponse } from './cookie-response';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
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
      await expect(page.locator('#admin-content')).not.toContainText('private-server-value');
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
      const results = await new AxeBuilder({ page }).include('#admin-content').analyze();
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
      await expect(page.getByText(text('saved'), { exact: true })).toBeVisible();
      await expect(ttl).toHaveValue('120');
      await button('activate').click();
      await confirm();
      await expect(page.getByText(text('activated'), { exact: true })).toBeVisible();
      await expect(ttl).toHaveValue('120');
      await button('otpSave').click();
      await confirm();
      await expect(page.getByText(text('otpSaved'), { exact: true })).toBeVisible();
      expect(draftWrites).toEqual(
        Array(2).fill({ mode: 'MANUAL', expectedVersion: 0, action: 'draft' })
      );
      expect(activations).toEqual([{ mode: 'MANUAL', expectedVersion: 1, action: 'activate' }]);
      expect(otpWrites).toEqual(Array(2).fill({ ttlSeconds: 120, expectedVersion: 0 }));
    });
  }

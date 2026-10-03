import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';
import { t } from '@barghsa/i18n/admin-ui';
import { notificationFormText } from '@barghsa/i18n/notification-forms';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`notification template and minute window feedback, captured retry (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
      baseURL,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      await page
        .context()
        .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'notification-forms-test' }]);
      const text = (key: string) => t(`admin.notifications.${key}`, locale);
      let saved = notificationTemplate(),
        config = { timezone: 'UTC', startHour: 9, endHour: 21 },
        verified = false,
        invalid = true;
      const writes: unknown[] = [];
      await page.route('**/api/admin/notifications/templates', (route) =>
        route.fulfill({ json: [saved] })
      );
      await page.route(`**/api/admin/notifications/templates/${saved.id}`, (route) => {
        const body = route.request().postDataJSON();
        writes.push(body);
        if (!verified)
          return route.fulfill({
            status: 403,
            json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } },
          });
        if (invalid)
          return route.fulfill({
            status: 400,
            json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['bodyTemplate'] } },
          });
        saved = { ...saved, ...body };
        return route.fulfill({ json: saved });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      const windowWrites: unknown[] = [];
      await page.route('**/api/admin/config/delivery-window', (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: config });
        const body = route.request().postDataJSON();
        windowWrites.push(body);
        config = { timezone: body.timezone, startHour: body.start_hour, endHour: body.end_hour };
        return route.fulfill({ json: config });
      });
      await page.goto('/admin/notifications');
      await page.getByRole('button', { name: text('edit'), exact: true }).click();
      const form = page
        .locator('form')
        .filter({ has: page.locator('#notification-template-eventKey') });
      const body = page.locator('#notification-template-bodyTemplate');
      await body.fill('Hello {{unknown}}');
      await form.locator('button[type=submit]').click();
      await expect(body).toBeFocused();
      await expect(body).toHaveAttribute('aria-invalid', 'true');
      expect(writes).toHaveLength(0);
      await body.fill('Local body');
      await form.locator('button[type=submit]').click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('input[type=password]').fill('synthetic-password');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await expect(body).toBeFocused();
      await expect(body).toHaveValue('Local body');
      expect(writes[0]).toEqual(writes[1]);
      invalid = false;
      await form.locator('button[type=submit]').click();
      await expect(form).toHaveCount(0);
      expect(saved.bodyTemplate).toBe('Local body');
      const windowForm = page
        .locator('form')
        .filter({ has: page.locator('#delivery-window-start') });
      await expect(page.locator('#delivery-window-start')).toHaveAttribute('dir', 'ltr');
      await page.locator('#delivery-window-start').fill('10:15');
      await page.locator('#delivery-window-end').fill('12:15');
      await windowForm.locator('button[type=submit]').click();
      await expect(page.locator('#delivery-window-end')).toBeFocused();
      expect(windowWrites).toHaveLength(0);
      await page.locator('#delivery-window-end').fill('14:15');
      await windowForm.locator('button[type=submit]').click();
      await expect(windowForm).toContainText(text('window.saved'));
      expect(windowWrites).toEqual([{ timezone: 'UTC', start_hour: 10.25, end_hour: 14.25 }]);
      await page.getByRole('button', { name: text('edit'), exact: true }).click();
      expect(
        (
          await new AxeBuilder({ page })
            .include('form')
            .exclude('iframe')
            .withTags(['wcag2a', 'wcag2aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && dark && info.project.name === 'mobile-safari') {
        await page.setViewportSize({ width: 390, height: 1600 });
        await form.screenshot({ path: '/tmp/barghsa-notification-template-fa-dark.png' });
        await windowForm.screenshot({ path: '/tmp/barghsa-notification-window-fa-dark.png' });
      }
    });
    test(`delivery window keeps drafts through failed, changed and uncertain reads (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }) => {
      await setupCatalogueForms(page, locale, dark);
      let config = { timezone: 'UTC', startHour: 9, endHour: 21 },
        readStatus = 200,
        mismatch = false;
      const writes: unknown[] = [];
      await page.route('**/api/admin/notifications/templates', (route) =>
        route.fulfill({ json: [notificationTemplate()] })
      );
      await page.route('**/api/admin/config/delivery-window', (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ status: readStatus, json: config });
        const body = route.request().postDataJSON();
        writes.push(body);
        return route.fulfill({
          json: mismatch ? { ...config, startHour: 11 } : { ...config, startHour: body.start_hour },
        });
      });
      await page.goto('/admin/notifications');
      const start = page.locator('#delivery-window-start');
      await expect(start).toHaveValue('09:00');
      await start.fill('10:00');
      const refresh = page.getByRole('button', {
        name: notificationFormText('refresh', locale),
        exact: true,
      });
      readStatus = 500;
      await refresh.click();
      await expect(start).toHaveValue('10:00');
      const form = page.locator('form').filter({ has: start });
      await expect(form.locator('button[type=submit]')).toBeDisabled();
      readStatus = 200;
      await refresh.click();
      await expect(form.locator('button[type=submit]')).toBeEnabled();
      await expect(start).toHaveValue('10:00');
      config = { ...config, endHour: 22 };
      await refresh.click();
      await expect(start).toBeDisabled();
      await expect(start).toHaveValue('10:00');
      const reset = page.getByRole('button', {
        name: notificationFormText('reset', locale),
        exact: true,
      });
      await reset.click();
      await expect(start).toHaveValue('09:00');
      mismatch = true;
      await start.fill('10:00');
      await form.locator('button[type=submit]').click();
      await expect(reset).toBeDisabled();
      await expect(form).not.toContainText(t('admin.notifications.window.saved', locale));
      expect(writes).toHaveLength(1);
      config = { ...config, startHour: 11 };
      await refresh.click();
      await expect(reset).toBeEnabled();
      await expect(start).toHaveValue('10:00');
      await reset.click();
      await expect(start).toHaveValue('11:00');
      readStatus = 403;
      await refresh.click();
      await expect(form).toHaveCount(0);
      await expect(
        page.getByText(notificationFormText('denied', locale), { exact: true })
      ).toBeVisible();
    });
  }

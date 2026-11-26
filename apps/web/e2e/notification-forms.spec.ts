import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';
import { t } from '@barghsa/i18n/admin-ui';
import { notificationFormText } from '@barghsa/i18n/notification-forms';
import { loginFormText } from '@barghsa/i18n/login-forms';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });

for (const locale of ['en', 'fa'] as const) {
  test(`delivery settings session expiry withdraws a private notification draft (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, false);
    const draft = notificationTemplate();
    let templateStatus = 200;
    await page.route(`**/api/admin/notifications/templates/${draft.id}`, (route) =>
      route.fulfill({ status: templateStatus, json: draft })
    );
    let status = 200;
    await page.route('**/api/admin/config/delivery-window', (route) =>
      route.fulfill({ status, json: { timezone: 'UTC', startHour: 9, endHour: 21 } })
    );
    await page.goto('/admin/notifications/settings');
    const start = page.locator('#delivery-window-start');
    await expect(start).toHaveValue('09:00');
    const refresh = page.getByRole('button', {
      name: notificationFormText('refresh', locale),
      exact: true,
    });
    status = 403;
    await refresh.click();
    await expect(start).toHaveCount(0);
    status = 200;
    await refresh.click();
    await expect(start).toHaveValue('09:00');
    status = 401;
    await refresh.click();
    await expect(start).toHaveCount(0);
    const sessionEnded = page
      .getByRole('main')
      .getByRole('alert')
      .filter({ hasText: loginFormText('sessionEnded', locale) });
    await expect(sessionEnded).toBeVisible();
    await expect(
      sessionEnded.getByRole('link', { name: loginFormText('restart', locale) })
    ).toHaveAttribute('href', '/login');
    await page.goto(`/admin/notifications/${draft.id}/edit`);
    const body = page.locator('#notification-template-bodyTemplate');
    await body.fill('Local private draft');
    templateStatus = 401;
    await page
      .getByRole('button', { name: t('admin.notifications.refresh', locale), exact: true })
      .click();
    await expect(body).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText('Local private draft');
  });
}

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
        if (route.request().method() === 'GET') return route.fulfill({ json: saved });
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
      await page.getByRole('link', { name: text('edit'), exact: true }).click();
      const form = page
        .locator('form')
        .filter({ has: page.locator('#notification-template-eventKey') });
      await expect(form.locator('#notification-template-eventKey')).toHaveText(saved.eventKey);
      const body = page.locator('#notification-template-bodyTemplate');
      await expect(body).toHaveAttribute('aria-required', 'true');
      await expect(body).toHaveAccessibleDescription(text('bodyHint'));
      await expect(form.locator('#test-destination')).toHaveAccessibleDescription(
        notificationFormText('testEmailHint', locale)
      );
      await body.fill('Hello {{unknown}}');
      await form.locator('button[type=submit]').click();
      await expect(body).toBeFocused();
      await expect(body).toHaveAttribute('aria-invalid', 'true');
      await expect(body).toHaveAccessibleDescription(/\S/);
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
      const exact = `/admin/notifications/${saved.id}`;
      await expect(page).toHaveURL(exact);
      await expect(
        page.getByRole('heading', { level: 1, name: saved.subject || saved.eventKey, exact: true })
      ).toBeVisible();
      await expect(page.getByRole('main').getByText(saved.eventKey, { exact: true })).toBeVisible();
      await page.goto('/admin/notifications/settings');
      const windowForm = page
        .locator('form')
        .filter({ has: page.locator('#delivery-window-start') });
      const zone = page.locator('#delivery-window-timezone');
      await zone.fill('unknown timezone');
      await expect(page.getByRole('option')).toHaveCount(0);
      await zone.press('Escape');
      await expect(zone).toHaveValue('UTC');
      await zone.fill(locale === 'fa' ? 'Istan' : 'استانب');
      await expect(page.getByRole('option', { name: /Europe\/Istanbul/ })).toBeVisible();
      await expect(page.getByRole('option')).toHaveCount(1);
      await zone.press('Enter');
      await expect(zone).toHaveValue('Europe/Istanbul');

      const start = page.locator('#delivery-window-start');
      const end = page.locator('#delivery-window-end');
      await expect(start).toHaveAttribute('dir', 'ltr');
      await start.fill(locale === 'fa' ? '۱۰۱۵' : '10:15');
      await expect(start).toHaveValue('10:15');
      await end.fill(locale === 'fa' ? '۱۲:۱۵' : '12:15');
      await windowForm.locator('button[type=submit]').click();
      await expect(end).toBeFocused();
      expect(windowWrites).toHaveLength(0);
      await end.fill(locale === 'fa' ? '۱۴:۱۵' : '14:15');
      await windowForm.locator('button[type=submit]').click();
      await expect(windowForm).toContainText(text('window.saved'));
      expect(windowWrites).toEqual([
        { timezone: 'Europe/Istanbul', start_hour: 10.25, end_hour: 14.25 },
      ]);
      const capture = locale === 'fa' && dark && info.project.name === 'mobile-safari';
      if (capture)
        await windowForm.screenshot({ path: '/tmp/barghsa-notification-window-fa-dark.png' });
      await page.goto(exact + '/edit');
      await expect(form).toBeVisible();
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
      if (capture) {
        await page.setViewportSize({ width: 390, height: 1600 });
        await form.screenshot({ path: '/tmp/barghsa-notification-template-fa-dark.png' });
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
      await page.goto('/admin/notifications/settings');
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

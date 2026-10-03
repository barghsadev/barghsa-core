import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { tServiceSettings as t } from '@barghsa/i18n/service-settings';
import AxeBuilder from '@axe-core/playwright';

test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`escalation validation, recovery and verified save (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }) => {
      await setupCatalogueForms(page, locale, dark);
      const text = (key: string) => t(`admin.escalation.${key}`, locale);
      let emailEnabled = false;
      let hours = 24,
        readFailure = false,
        denied = false,
        invalidField = true,
        wrongReceipt = false,
        verified = false;
      const policy = () => ({
        ticket: {
          level2: { delayHours: hours, channels: emailEnabled ? ['in_app', 'email'] : ['in_app'] },
          level3: { delayHours: null, channels: ['in_app'] },
        },
        verification_case: null,
      });
      const writes: unknown[] = [];
      await page.route('**/api/admin/config/service-response-targets', (route) =>
        route.fulfill({ status: 403, json: {} })
      );
      await page.route('**/api/admin/config/escalation-policy', (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ status: denied ? 403 : readFailure ? 503 : 200, json: policy() });
        const body = route.request().postDataJSON();
        writes.push(body);
        if (!verified)
          return route.fulfill({
            status: 403,
            json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } },
          });
        if (invalidField)
          return route.fulfill({
            status: 400,
            json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['ticketLevel2Hours'] } },
          });
        if (wrongReceipt) return route.fulfill({ json: policy() });
        hours = body.ticket.level2.delayHours;
        emailEnabled = body.ticket.level2.channels.includes('email');
        return route.fulfill({ json: body });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto('/admin/service-targets');
      const form = page.locator('form').filter({ has: page.locator('#escalation-ticketLevel2') });
      const input = page.locator('#escalation-ticketLevel2');
      const save = form.getByRole('button', { name: text('save'), exact: true });
      const refresh = page.getByRole('button', { name: text('refresh'), exact: true });
      const email = form.getByRole('checkbox', {
        name: `${text('email')} — ${t('admin.teams.ticket', locale)} — ${text('level2')}`,
        exact: true,
      });
      await expect(input).toHaveValue('24');
      // The separately denied target permission leaves escalation usable.
      await expect(page.locator('#target-ticket')).toHaveCount(0);
      await input.fill('1e3');
      await save.click();
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(writes).toEqual([]);
      const raw = locale === 'fa' ? ' ۷۲ ' : ' ٧٢ ';
      await input.fill(raw);
      await email.check();
      await save.click();
      let dialog = page.getByRole('dialog'),
        confirm = dialog.locator('button[type=submit]');
      await confirm.click();
      await dialog.locator('input[type=password]').fill('synthetic-password');
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(raw);
      invalidField = false;
      await save.click();
      dialog = page.getByRole('dialog');
      confirm = dialog.locator('button[type=submit]');
      await expect(dialog).toContainText(text('email'));
      readFailure = true;
      await dialog.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(confirm).toBeDisabled();
      await expect(input).toHaveValue(raw);
      readFailure = false;
      await dialog.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(confirm).toBeEnabled();
      hours = 48;
      await dialog.getByRole('button', { name: text('refresh'), exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(input).toHaveValue(raw);
      await expect(save).toBeDisabled();
      await expect(refresh).toBeFocused();
      await expect(page.getByRole('alert').filter({ hasText: text('stale') })).toBeVisible();
      await form.getByRole('button', { name: text('reset'), exact: true }).click();
      await expect(input).toHaveValue('48');
      await input.fill(raw);
      await email.check();
      await save.click();
      wrongReceipt = true;
      dialog = page.getByRole('dialog');
      confirm = dialog.locator('button[type=submit]');
      await confirm.click();
      await expect(dialog).toContainText(text('unverified'));
      await expect(confirm).toBeDisabled();
      await dialog
        .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
        .click();
      wrongReceipt = false;
      await refresh.click();
      await save.click();
      dialog = page.getByRole('dialog');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await expect(input).toHaveValue('72');
      await expect(form.getByRole('button', { name: text('save'), exact: true })).toBeDisabled();
      expect(writes.at(-1)).toEqual({
        ticket: {
          level2: { delayHours: 72, channels: ['in_app', 'email'] },
          level3: { delayHours: null, channels: ['in_app'] },
        },
        verification_case: null,
      });
      expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && dark) {
        await page.setViewportSize({ width: 390, height: 2800 });
        await form.screenshot({ path: '/tmp/barghsa-service-escalation-form-fa-dark.png' });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await page.screenshot({
        path: `/tmp/barghsa-service-escalation-${locale}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      denied = true;
      await refresh.click();
      await expect(input).toHaveCount(0);
      denied = false;
      await refresh.click();
      await expect(input).toHaveValue('72');
    });
  }

test('only one service-settings confirmation owns the page', async ({ page }) => {
  await setupCatalogueForms(page, 'en', false);
  await page.route('**/api/admin/config/service-response-targets', (route) =>
    route.fulfill({ json: { ticket: 24, verification_case: null } })
  );
  await page.route('**/api/admin/config/escalation-policy', (route) =>
    route.fulfill({
      json: {
        ticket: {
          level2: { delayHours: 24, channels: ['in_app'] },
          level3: { delayHours: null, channels: ['in_app'] },
        },
        verification_case: null,
      },
    })
  );
  await page.route('**/api/admin/config/audit*', (route) =>
    route.fulfill({ json: { entries: [], nextCursor: null } })
  );
  await page.goto('/admin/service-targets');
  const target = page.locator('#target-ticket'),
    escalation = page.locator('#escalation-ticketLevel2');
  await target.fill('72');
  const form = page.locator('form').filter({ has: target });
  await form.getByRole('button', { name: 'Save response targets', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(escalation).toBeDisabled();
  await page
    .locator('#escalation-ticketLevel2')
    .evaluate((node) =>
      node.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toContainText('Save response targets');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(escalation).toBeEnabled();
  await expect(target).toHaveValue('72');
});

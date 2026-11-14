import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { tServiceSettings as t } from '@barghsa/i18n/service-settings';
import { retentionText } from '@barghsa/i18n/operational-retention';
import { defaultOperationalRetention } from '@barghsa/shared/admin';
import AxeBuilder from '@axe-core/playwright';
import { fullNavigation } from './navigation-fixture';

test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`escalation validation, recovery and verified save (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
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
        ticket: null,
        verification_case: null,
        consultation: {
          level2: { delayHours: hours, channels: emailEnabled ? ['in_app', 'email'] : ['in_app'] },
          level3: { delayHours: null, channels: ['in_app'] },
        },
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
            json: {
              error: { code: 'VALIDATION:INPUT:INVALID', fields: ['consultationLevel2Hours'] },
            },
          });
        if (wrongReceipt) return route.fulfill({ json: policy() });
        hours = body.consultation.level2.delayHours;
        emailEnabled = body.consultation.level2.channels.includes('email');
        return route.fulfill({ json: body });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto('/admin/service-targets');
      const form = page
        .locator('form')
        .filter({ has: page.locator('#escalation-consultationLevel2') });
      const input = page.locator('#escalation-consultationLevel2');
      const save = form.getByRole('button', { name: text('save'), exact: true });
      const refresh = page.getByRole('button', { name: text('refresh'), exact: true });
      const email = form.getByRole('checkbox', {
        name: `${text('email')} — ${t('admin.teams.consultation', locale)} — ${text('level2')}`,
        exact: true,
      });
      await expect(input).toHaveValue('24');
      await expect(page.locator('#escalation-consultationLevel2-help')).toContainText(
        t('admin.consultation.responseHelp', locale)
      );
      await expect(page.locator('#escalation-consultationLevel3')).toBeDisabled();
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
        ticket: null,
        verification_case: null,
        consultation: {
          level2: { delayHours: 72, channels: ['in_app', 'email'] },
          level3: { delayHours: null, channels: ['in_app'] },
        },
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
      if (
        (locale === 'en' && !dark && info.project.name === 'chromium') ||
        (locale === 'fa' && dark && info.project.name === 'mobile-safari')
      ) {
        await page.setViewportSize({ width: 390, height: 3400 });
        await form.screenshot({
          path: info.outputPath(
            `consultation-escalation-${locale}-${dark ? 'dark' : 'light'}-${info.project.name}.png`
          ),
        });
        await page.setViewportSize({ width: 390, height: 844 });
      }
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
    route.fulfill({ json: { ticket: 24, verification_case: null, consultation: null } })
  );
  await page.route('**/api/admin/config/escalation-policy', (route) =>
    route.fulfill({
      json: {
        ticket: {
          level2: { delayHours: 24, channels: ['in_app'] },
          level3: { delayHours: null, channels: ['in_app'] },
        },
        verification_case: null,
        consultation: null,
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

test('a recovery draft stays separate from the live service target', async ({ page }) => {
  await setupCatalogueForms(page, 'en', false);
  const settings = (ticket: number) => ({ ticket, verification_case: null, consultation: null });
  const sourceId = '0199f2eb-de42-78d9-8ba7-1afedd591be1';
  const draftId = '0199f2eb-de42-78d9-8ba7-1afedd591be2';
  const revision = { id: sourceId, version: 1, config: settings(24) };
  const draft = {
    id: draftId,
    sourceId,
    sourceVersion: 1,
    baseVersion: 2,
    config: revision.config,
  };
  const path = '**/api/admin/config/service-response-targets';
  let active = settings(48);
  let staged = false;
  let activated = false;
  await page.route(path, (route) => route.fulfill({ json: active }));
  await page.route(`${path}/rollback-history`, (route) =>
    route.fulfill({
      json: {
        baseVersion: activated ? 3 : 2,
        items: [revision],
        nextBeforeVersion: null,
        draft: staged && !activated ? draft : null,
      },
    })
  );
  await page.route(`${path}/rollback-draft`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ sourceId, expectedVersion: 2 });
    staged = true;
    return route.fulfill({ status: 201, json: draft });
  });
  await page.route(`${path}/rollback-activate`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ draftId, expectedVersion: 2 });
    activated = true;
    active = draft.config;
    return route.fulfill({ json: { version: 3, draftId, config: active } });
  });
  await page.goto('/admin/service-targets');
  const target = page.locator('#target-ticket');
  await expect(target).toHaveValue('48');
  const section = page.getByRole('group', { name: t('admin.targets.formTitle', 'en') });
  await section.getByRole('button', { name: 'Restore previous settings' }).click();
  await section.getByRole('button', { name: 'Review version 1' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('24 Hours');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toHaveCount(0);
  await expect(target).toHaveValue('48');
  await section.getByRole('button', { name: 'Activate recovery draft' }).click();
  await dialog.locator('button[type=submit]').click();
  await expect(target).toHaveValue('24');
  await expect(section.getByRole('button', { name: 'Activate recovery draft' })).toHaveCount(0);
});

for (const locale of ['en', 'fa'] as const) {
  test(`monitoring retention restores an earlier policy after staff verification (${locale})`, async ({
    page,
  }, info) => {
    await setupCatalogueForms(page, locale, false);
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'monitoring-editor',
          isStaff: true,
          operatingContext: 'staff',
          canSwitchContext: true,
          requiresTosAcceptance: false,
          navigation: fullNavigation('staff'),
        },
      })
    );
    const path = '**/api/admin/config/operational-retention';
    const sourceId = '0199f2eb-de42-78d9-8ba7-1afedd591be1';
    const draftId = '0199f2eb-de42-78d9-8ba7-1afedd591be2';
    const previous = { ...defaultOperationalRetention, searchableLogsDays: 45 };
    const revision = { id: sourceId, version: 1, config: previous };
    const draft = { id: draftId, sourceId, sourceVersion: 1, baseVersion: 2, config: previous };
    let active = { version: 2, policy: defaultOperationalRetention, canEdit: true };
    let staged = false;
    let verified = false;
    const stepUpRequired = { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } };
    await page.route(path, (route) => route.fulfill({ json: active }));
    await page.route(`${path}/rollback-history`, (route) =>
      route.fulfill({
        json: {
          baseVersion: active.version,
          items: [revision],
          nextBeforeVersion: null,
          draft: staged && active.version === 2 ? draft : null,
        },
      })
    );
    await page.route(`${path}/rollback-draft`, (route) => {
      expect(route.request().postDataJSON()).toEqual({ sourceId, expectedVersion: 2 });
      staged = true;
      return route.fulfill({ status: 201, json: draft });
    });
    await page.route(`${path}/rollback-activate`, (route) => {
      expect(route.request().postDataJSON()).toEqual({ draftId, expectedVersion: 2 });
      if (!verified) return route.fulfill({ status: 403, json: stepUpRequired });
      active = { ...active, version: 3, policy: previous };
      return route.fulfill({ json: { version: 3, draftId, config: previous } });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = true;
      return route.fulfill({ json: { verified: true } });
    });
    await page.goto('/admin/operational-retention');
    const input = page.getByLabel(retentionText('searchableLogsDays', locale), { exact: true });
    const toggle = page.getByRole('button', {
      name: retentionText('recoveryTitle', locale),
      exact: true,
    });
    await expect(input).toHaveValue('30');
    await toggle.focus();
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const region = page.getByRole('region', { name: retentionText('recoveryTitle', locale) });
    await region
      .getByRole('button', {
        name: retentionText('recoveryStage', locale).replace(
          '{version}',
          locale === 'fa' ? '۱' : '1'
        ),
      })
      .click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.locator('button[type=submit]');
    await expect(dialog).toContainText(locale === 'fa' ? '۴۵' : '45');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(input).toHaveValue('30');
    const activate = region.getByRole('button', {
      name: retentionText('recoveryActivate', locale),
    });
    await expect(activate).toBeEnabled();
    const accessibility = await new AxeBuilder({ page }).include('#retention-recovery').analyze();
    expect(accessibility.violations).toEqual([]);
    await region.screenshot({ path: info.outputPath(`retention-recovery-${locale}.png`) });
    await activate.click();
    await expect(dialog).toContainText(retentionText('recoveryActivateConfirm', locale));
    await confirm.click();
    await expect(input).toHaveValue('30');
    await dialog.locator('input[type=password]').fill('synthetic-password');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(input).toHaveValue('45');
    await expect(activate).toHaveCount(0);
    await expect(page.getByRole('link', { name: retentionText('export', locale) })).toHaveAttribute(
      'href',
      '/api/admin/config/operational-retention/export'
    );
  });
}

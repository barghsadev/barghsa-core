import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';
import { DEFAULT_SERVICE_WORKFLOWS, type ServiceWorkflowView } from '@barghsa/shared/admin';
import { tServiceSettings } from '@barghsa/i18n/service-settings';
import { t } from '@barghsa/i18n/admin-ui';
import { loginFormText } from '@barghsa/i18n/login-forms';

for (const locale of ['en', 'fa'] as const) {
  test(`staff reviews and activates a previous workflow version (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: locale === 'fa' ? 390 : 1440, height: 900 });
    await setupCatalogueForms(page, locale, false);
    const copy = (key: string) => tServiceSettings(`workflow.${key}`, locale);
    const path = '/api/admin/config/service-workflows';
    const sourceId = '10000000-0000-4000-8000-000000000001';
    const prior = structuredClone(DEFAULT_SERVICE_WORKFLOWS);
    prior.ticket_urgent = { hours: 8, notification: 'breach', email: false, escalation: null };
    let view: ServiceWorkflowView = {
      policy: DEFAULT_SERVICE_WORKFLOWS,
      version: 2,
      roles: [],
      teams: [],
    };
    const requests: unknown[] = [];
    let stepUps = 0;
    await page.route(`**${path}`, (route) => {
      expect(route.request().method()).toBe('GET');
      return route.fulfill({ json: view });
    });
    await page.route(`**${path}/history?*`, (route) =>
      route.fulfill({
        json: { items: [{ id: sourceId, version: 1, value: prior }], nextBeforeVersion: null },
      })
    );
    await page.route('**/api/auth/step-up', (route) => {
      stepUps++;
      return route.fulfill({ json: { verified: true } });
    });
    await page.route(`**${path}/restore`, (route) => {
      expect(route.request().method()).toBe('POST');
      requests.push(route.request().postDataJSON());
      view = { ...view, policy: prior, version: 3 };
      return route.fulfill({ json: view });
    });
    await page.goto('/admin/service-targets');
    const section = page.getByRole('region', { name: copy('title'), exact: true });
    await section.getByRole('button', { name: copy('history'), exact: true }).press('Enter');
    const restore = section.getByRole('button', {
      name: copy('restoreVersion').replace('{version}', '1'),
      exact: true,
    });
    await restore.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(copy('ticket_urgent'));
    expect(requests).toEqual([]);
    await dialog.locator('#team-step-up-password').fill('test-only');
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(section.locator('#workflow-hours-ticket_urgent')).toHaveValue('8');
    expect(stepUps).toBe(1);
    expect(requests).toEqual([{ sourceId, expectedVersion: 2 }]);
  });
}

for (const locale of ['en', 'fa'] as const) {
  test(`service workflow follows both grants and clears on session expiry (${locale})`, async ({
    page,
  }) => {
    await setupCatalogueForms(page, locale, locale === 'fa');
    const copy = (key: string) => tServiceSettings(key, locale);
    const reads = { targets: 0, escalation: 0, workflows: 0 };
    let denied: 'targets' | 'escalation' | null = null;
    let expired = false;
    await page.route('**/api/admin/config/service-workflows', (route) => {
      expect(route.request().method()).toBe('GET');
      reads.workflows++;
      if (expired || denied) return route.fulfill({ status: expired ? 401 : 403, json: {} });
      return route.fulfill({
        json: {
          policy: DEFAULT_SERVICE_WORKFLOWS,
          version: 0,
          roles: [{ id: 'reviewer', name: 'Reviewer' }],
          teams: [{ id: '10000000-0000-4000-8000-000000000001', name: 'Operations' }],
        },
      });
    });
    await page.route('**/api/admin/config/service-response-targets', (route) => {
      expect(route.request().method()).toBe('GET');
      reads.targets++;
      if (expired || denied === 'targets')
        return route.fulfill({ status: expired ? 401 : 403, json: {} });
      return route.fulfill({ json: { ticket: 24, verification_case: null, consultation: 48 } });
    });
    await page.route('**/api/admin/config/escalation-policy', (route) => {
      expect(route.request().method()).toBe('GET');
      reads.escalation++;
      if (denied === 'escalation') return route.fulfill({ status: 403, json: {} });
      return route.fulfill({
        json: {
          ticket: {
            level2: { delayHours: 36, channels: ['in_app'] },
            level3: { delayHours: null, channels: ['in_app'] },
          },
          verification_case: null,
          consultation: null,
        },
      });
    });
    await page.goto('/admin/service-targets');
    const main = page.getByRole('main');
    const workflow = main.getByRole('region', { name: copy('workflow.title'), exact: true });
    const enabled = workflow.getByRole('checkbox', {
      name: copy('workflow.enabled'),
      exact: true,
    });
    const editor = (kind: 'targets' | 'escalation') =>
      main.getByRole('group', { name: copy(`admin.${kind}.formTitle`), exact: true });
    const refresh = (kind: 'targets' | 'escalation') =>
      editor(kind).getByRole('button', { name: copy(`admin.${kind}.refresh`), exact: true });
    const workflowRefresh = workflow.getByRole('button', {
      name: copy('workflow.refresh'),
      exact: true,
    });
    const targets = editor('targets').locator('#target-ticket');
    const escalation = editor('escalation').locator('#escalation-ticketLevel2');
    await expect(enabled).toBeEnabled();
    await expect(targets).toHaveValue('24');
    await expect(escalation).toHaveValue('36');
    await escalation.fill('72');
    denied = 'targets';
    await refresh('targets').press('Enter');
    await expect(editor('targets').getByRole('alert')).toContainText(
      copy('admin.targets.forbidden')
    );
    await expect(targets).toHaveCount(0);
    await expect(enabled).toHaveCount(0);
    await expect(escalation).toHaveValue('72');
    expect(reads).toEqual({ targets: 2, escalation: 1, workflows: 1 });
    await workflowRefresh.press('Enter');
    await expect(workflow.getByRole('alert')).toHaveText(copy('workflow.forbidden'));
    await expect(enabled).toHaveCount(0);
    expect(reads.workflows).toBe(2);
    denied = null;
    await refresh('targets').press('Enter');
    await expect(targets).toHaveValue('24');
    await workflowRefresh.press('Enter');
    await expect(enabled).toBeEnabled();
    await expect(escalation).toHaveValue('72');
    await targets.fill('60');
    denied = 'escalation';
    await refresh('escalation').press('Enter');
    await expect(editor('escalation').getByRole('alert')).toContainText(
      copy('admin.escalation.forbidden')
    );
    await expect(escalation).toHaveCount(0);
    await expect(enabled).toHaveCount(0);
    await expect(targets).toHaveValue('60');
    expect(reads).toEqual({ targets: 3, escalation: 2, workflows: 3 });
    expired = true;
    if (locale === 'fa') await workflowRefresh.press('Enter');
    else await refresh('targets').press('Enter');
    await expect(
      main.getByRole('alert').filter({ hasText: loginFormText('sessionEnded', locale) })
    ).toBeVisible();
    await expect(
      main.getByRole('link', { name: loginFormText('restart', locale) })
    ).toHaveAttribute('href', '/login');
    await expect(editor('targets')).toHaveCount(0);
    await expect(editor('escalation')).toHaveCount(0);
    await expect(workflow).toHaveCount(0);
  });
}

for (const width of [390, 1440])
  for (const locale of ['fa', 'en'] as const)
    for (const dark of [false, true])
      test(`workflow targets preserve routing, confirm exact settings and recover receipts (${width}, ${locale}, ${dark})`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 1000 });
        await setupCatalogueForms(page, locale, dark);
        await page.route('**/api/auth/user', (route) =>
          route.fulfill({
            json: {
              userId: 'workflow-browser-editor',
              isStaff: true,
              operatingContext: 'staff',
              canSwitchContext: true,
              requiresTosAcceptance: false,
              navigation: fullNavigation('staff'),
            },
          })
        );
        const text = (key: string) => tServiceSettings(`workflow.${key}`, locale);
        let view: ServiceWorkflowView = {
          policy: structuredClone(DEFAULT_SERVICE_WORKFLOWS),
          version: 0,
          roles: [{ id: 'reviewer', name: 'Reviewer' }],
          teams: [{ id: '10000000-0000-4000-8000-000000000001', name: 'Operations' }],
        };
        let mismatch = false,
          denied = false;
        const writes: unknown[] = [];
        await page.route('**/api/admin/config/service-workflows', (route) => {
          if (route.request().method() === 'GET')
            return route.fulfill({ status: denied ? 403 : 200, json: denied ? {} : view });
          const body = route.request().postDataJSON();
          writes.push(body);
          if (mismatch) return route.fulfill({ json: { ...view, version: 999 } });
          view = { ...view, policy: body.policy, version: body.expectedVersion + 1 };
          return route.fulfill({ json: view });
        });
        await page.route('**/api/auth/step-up', (route) =>
          route.fulfill({ json: { verified: true } })
        );
        await page.goto('/admin/service-targets');
        const section = page.getByRole('region', {
          name: text('title'),
          exact: true,
          includeHidden: true,
        });
        const save = section.getByRole('button', { name: text('save'), exact: true });
        await section.getByRole('checkbox', { name: text('enabled'), exact: true }).check();
        const hours = section.locator('#workflow-hours-ticket_urgent');
        await expect(hours).toHaveAttribute('aria-required', 'true');
        await hours.fill('1e3');
        await save.click();
        await expect(hours).toBeFocused();
        await expect(hours).toHaveAccessibleDescription(text('invalid'));
        expect(writes).toHaveLength(0);
        await hours.fill('۲');
        await section.locator('#workflow-hours-ticket_urgent-unit').selectOption('days');
        await section.getByRole('checkbox', { name: text('rule'), exact: true }).check();
        await section.locator('#workflow-condition').selectOption('ticket_priority');
        await section.locator('#workflow-from').selectOption('role');
        await expect(section.locator('#workflow-from-reference')).toHaveAttribute(
          'aria-required',
          'true'
        );
        await save.click();
        await expect(section.locator('#workflow-from-reference')).toBeFocused();
        await expect(section.locator('#workflow-from-reference')).toHaveAccessibleDescription(
          text('invalid')
        );
        await section.locator('#workflow-from-reference').selectOption('reviewer');
        await section.locator('#workflow-to').selectOption('team');
        await expect(section.locator('#workflow-to-reference')).toHaveAttribute(
          'aria-required',
          'true'
        );
        await section.locator('#workflow-to-reference').selectOption(view.teams[0]!.id);
        await section.locator('#workflow-timeout-ticket_urgent').fill('۳');
        await section.locator('#workflow-timeout-ticket_urgent-unit').selectOption('hours');
        await save.click();
        const dialog = page.getByRole('dialog'),
          confirm = dialog.getByRole('button', { name: t('team.confirm', locale), exact: true });
        await expect(hours).toBeDisabled();
        await dialog.locator('#team-step-up-password').fill('test-only');
        await confirm.click();
        await expect(dialog).toHaveCount(0);
        expect(view.policy.ticket_urgent).toEqual({
          hours: 48,
          notification: 'breach',
          email: false,
          escalation: {
            condition: 'ticket_priority',
            from: { kind: 'role', id: 'reviewer' },
            to: { kind: 'team', id: view.teams[0]!.id },
            afterHours: 3,
            email: false,
          },
        });
        expect(view.policy.ticket_low).toBeNull();
        expect(view.version).toBe(1);
        await expect(section.getByRole('status')).toHaveText(text('saved'));
        expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        await section.locator('#workflow-condition').focus();
        await page.keyboard.press('Tab');
        await expect(section.locator('#workflow-from')).toBeFocused();
        if (width === 390) {
          await section.locator('#workflow-from').scrollIntoViewIfNeeded();
          await page.screenshot({
            path: info.outputPath(`workflows-${locale}-${dark ? 'dark' : 'light'}.png`),
          });
        }
        await hours.fill('3');
        mismatch = true;
        await save.click();
        await dialog.locator('#team-step-up-password').fill('test-only');
        await confirm.click();
        await expect(confirm).toBeDisabled();
        await expect(section).toContainText(text('unverified'));
        await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
        await expect(save).toBeDisabled();
        await section.getByRole('button', { name: text('reset'), exact: true }).click();
        await expect(hours).toHaveValue('2');
        expect(writes).toHaveLength(2);
        denied = true;
        await section.getByRole('button', { name: text('refresh'), exact: true }).click();
        await expect(hours).toHaveCount(0);
        await expect(section).toContainText(text('forbidden'));
      });

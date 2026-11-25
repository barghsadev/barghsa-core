import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';
import { DEFAULT_SERVICE_WORKFLOWS, type ServiceWorkflowView } from '@barghsa/shared/admin';
import { tServiceSettings } from '@barghsa/i18n/service-settings';
import { t } from '@barghsa/i18n/admin-ui';
import { loginFormText } from '@barghsa/i18n/login-forms';
import { feedbackText } from '@barghsa/i18n/feedback';

const workflows = '/admin/service-targets/workflows';
const urgent = `${workflows}/ticket_urgent`;

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
    let mismatch = true;
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
      if (mismatch) return route.fulfill({ json: { ...view, version: 999 } });
      view = { ...view, policy: prior, version: 3 };
      return route.fulfill({ json: view });
    });
    await page.goto(workflows);
    const section = page.getByRole('region', { name: copy('title'), exact: true });
    await expect(section.locator('form')).toHaveCount(0);
    await expect(section.locator(`a[href^="${workflows}/"]`)).toHaveCount(12);
    await section.getByRole('button', { name: copy('history'), exact: true }).press('Enter');
    const restore = section.getByRole('button', {
      name: copy('restoreVersion').replace('{version}', '1'),
      exact: true,
    });
    await restore.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(copy('ticket_urgent'));
    expect(requests).toEqual([]);
    const confirm = dialog.getByRole('button', { name: t('team.confirm', locale), exact: true });
    const password = dialog.locator('#team-step-up-password');
    await password.fill('test-only');
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: t('team.cancel', locale), exact: true }).click();
    await expect(section).toContainText(copy('unverified'));
    await expect(restore).toBeDisabled();
    await section.getByRole('button', { name: copy('reset'), exact: true }).click();
    mismatch = false;
    await restore.click();
    await password.fill('test-only');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await section.locator(`a[href="${urgent}"]`).click();
    await expect(page).toHaveURL(urgent);
    await expect(section.locator('#workflow-hours-ticket_urgent')).toHaveValue('8');
    expect(stepUps).toBe(2);
    expect(requests).toEqual([
      { sourceId, expectedVersion: 2 },
      { sourceId, expectedVersion: 2 },
    ]);
    await page.goto(`${workflows}/unknown-workflow`);
    await expect(
      page.getByRole('heading', { name: feedbackText('notFound', locale), exact: true })
    ).toBeVisible();
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
    const enabled = workflow.getByRole('checkbox', { name: copy('workflow.enabled'), exact: true });
    const editor = (kind: 'targets' | 'escalation') =>
      main.getByRole('group', { name: copy(`admin.${kind}.formTitle`), exact: true });
    const workflowRefresh = workflow.getByRole('button', {
      name: copy('workflow.refresh'),
      exact: true,
    });
    const targets = editor('targets').locator('#target-ticket');
    const escalation = editor('escalation').locator('#escalation-ticketLevel2');
    await main.locator('a[href="/admin/service-targets/workflows"]').click();
    await workflow.locator(`a[href="${urgent}"]`).click();
    await expect(enabled).toBeEnabled();
    expect(reads.targets).toBe(0);
    expect(reads.escalation).toBe(0);
    const workflowReads = reads.workflows;
    expect(workflowReads).toBeGreaterThan(0);
    denied = 'targets';
    await workflowRefresh.press('Enter');
    await expect(workflow.getByRole('alert')).toHaveText(copy('workflow.forbidden'));
    await expect(enabled).toHaveCount(0);
    await page.goto('/admin/service-targets/response-times');
    await expect(editor('targets').getByRole('alert')).toContainText(
      copy('admin.targets.forbidden')
    );
    await expect(targets).toHaveCount(0);
    await page.goto('/admin/service-targets/escalation');
    await expect(escalation).toHaveValue('36');
    expect(reads).toEqual({ targets: 1, escalation: 1, workflows: workflowReads + 1 });
    denied = 'escalation';
    await editor('escalation')
      .getByRole('button', { name: copy('admin.escalation.refresh'), exact: true })
      .press('Enter');
    await expect(editor('escalation').getByRole('alert')).toContainText(
      copy('admin.escalation.forbidden')
    );
    await page.goto('/admin/service-targets/response-times');
    await expect(targets).toHaveValue('24');
    denied = null;
    await page.goto(urgent);
    await expect(enabled).toBeEnabled();
    expired = true;
    await workflowRefresh.press('Enter');
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
        await page.goto(urgent);
        const section = page.getByRole('region', {
          name: text('title'),
          exact: true,
          includeHidden: true,
        });
        const save = section.getByRole('button', { name: text('reviewChanges'), exact: true });
        await expect(section.locator('#workflow-select')).toHaveCount(0);
        await expect(
          section.getByRole('link', { name: text('backToWorkflows'), exact: true })
        ).toHaveAttribute('href', workflows);
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

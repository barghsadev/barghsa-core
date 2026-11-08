import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';
import { DEFAULT_SERVICE_WORKFLOWS, type ServiceWorkflowView } from '@barghsa/shared/admin';
import { tServiceSettings } from '@barghsa/i18n/service-settings';
import { t } from '@barghsa/i18n/admin-ui';
for (const width of [390, 1440])
  for (const locale of ['fa', 'en'] as const)
    for (const dark of [false, true])
      test(`workflow targets preserve routing, confirm exact settings and recover receipts (${width}, ${locale}, ${dark})`, async ({
        page,
      }) => {
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
            path: `/Users/majid/.local/state/barghsa-manual-batches/release-0.5-service-workflows/captures/workflows-${locale}-${dark ? 'dark' : 'light'}.png`,
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

import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import {
  assignmentAgent as agent,
  otherAssignmentAgent as other,
  assignmentSlots,
} from '../src/test/assignment-settings-fixtures';

test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const)
    for (const domain of ['slots', 'targets'] as const) {
      test(`${domain} recovery retains draft and password (${locale}, ${theme})`, async ({
        page,
      }, info) => {
        await crmShell(page, locale);
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'Assignments',
              appTitleFa: 'تخصیص‌ها',
              supportEmail: 'support@example.test',
              supportPhone: '+982112345678',
              supportMobile: '+989121234567',
              backgroundColor: '#f6f7f4',
              darkBackgroundColor: '#15201c',
              fontFamily: 'vazirmatn',
              borderRadiusRem: 0.75,
              spacingScale: 1,
              numberStyle: 'locale',
              slogan: '',
              primaryColor: '#2563eb',
              secondaryColor: '#64748b',
              accentColor: '#f59e0b',
              logoUrl: null,
              faviconUrl: null,
              darkMode: theme === 'dark',
            },
          })
        );
        let failed = false,
          changed = false,
          denied = false,
          targetSaved = false,
          targetVerified = false,
          agentFailed = false,
          agentReads = 0,
          reads = 0;
        await page.route('**/api/admin/agents', (route) => {
          agentReads++;
          return route.fulfill({ status: agentFailed ? 503 : 200, json: [agent, other] });
        });
        const endpoint =
          domain === 'slots'
            ? '/api/admin/agent-slots'
            : '/api/admin/config/service-response-targets';
        await page.route(`**${endpoint}`, (route) => {
          if (route.request().method() !== 'GET') {
            if (domain === 'targets' && targetVerified) {
              targetSaved = true;
              return route.fulfill({ json: route.request().postDataJSON() });
            }
            return route.fulfill({ status: 403, json: { requiresStepUp: true } });
          }
          reads++;
          return route.fulfill({
            status: denied ? 403 : failed ? 503 : 200,
            json:
              domain === 'slots'
                ? assignmentSlots().map((row) =>
                    row.slotKey === 'individual_chatbot' && changed
                      ? { ...row, updatedAt: '2026-10-01T01:00:00Z' }
                      : row
                  )
                : {
                    ticket: 24,
                    verification_case: null,
                    consultation: targetSaved ? 72 : changed ? 48 : 24,
                  },
          });
        });
        await page.route('**/api/admin/agent-slots/*/agent', (route) =>
          route.fulfill({ status: 403, json: { requiresStepUp: true } })
        );
        await page.route('**/api/auth/step-up', (route) => {
          targetVerified = true;
          return route.fulfill({ json: { verified: true } });
        });
        await page.goto(domain === 'slots' ? '/admin/agent-slots' : '/admin/service-targets');
        await expect(page.locator('html')).toHaveClass(
          theme === 'dark' ? /dark/ : /^(?!.*dark).*$/
        );
        const text = (key: string) => t(`admin.${domain}.${key}`, locale);
        const input = page.locator(
          domain === 'slots' ? '#slot-individual_chatbot' : '#target-consultation'
        );
        if (domain === 'slots') await input.selectOption(agent.id);
        else await input.fill('72');
        const form = page.locator('form').filter({ has: input });
        await form.locator('button[type=submit]').click();
        const dialog = page.getByRole('dialog'),
          confirm = dialog.locator('button[type=submit]');
        await confirm.click();
        await dialog.locator('input[type=password]').fill('synthetic-password');
        const refresh = text('refresh');
        failed = true;
        await dialog.getByRole('button', { name: refresh, exact: true }).click();
        await expect(confirm).toBeDisabled();
        await expect(input).toHaveValue(domain === 'slots' ? agent.id : '72');
        await expect(dialog.locator('input[type=password]')).toHaveValue('synthetic-password');
        failed = false;
        await dialog.getByRole('button', { name: refresh, exact: true }).click();
        await expect(confirm).toBeEnabled();
        if (domain === 'slots') {
          const count = reads;
          agentFailed = true;
          await dialog.getByRole('button', { name: text('agentsRetry'), exact: true }).click();
          await expect(confirm).toBeDisabled();
          agentFailed = false;
          await dialog.getByRole('button', { name: text('agentsRetry'), exact: true }).click();
          await expect(confirm).toBeEnabled();
          expect(reads).toBe(count);
          expect(agentReads).toBe(3);
        }
        // Check the pending review at mobile width, including its keyboard-accessible controls.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        // The modal content excludes Base UI's external VoiceOver focus sentinels.
        expect(
          (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
        ).toEqual([]);
        changed = true;
        await dialog.getByRole('button', { name: refresh, exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('alert').filter({ hasText: text('stale') })).toBeVisible();
        await expect(input).toHaveValue(domain === 'slots' ? agent.id : '72');
        await expect(form.locator('button[type=submit]')).toBeDisabled();
        await expect(page.getByRole('button', { name: refresh, exact: true })).toBeFocused();
        for (const node of await form.locator('input, select, button').all()) {
          const box = await node.boundingBox();
          if (box) {
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(391);
          }
        }
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.screenshot({
          path: `/tmp/barghsa-assignment-${domain}-${locale}-${theme}.png`,
          fullPage: true,
        });
        await form
          .getByRole('button', { name: text('reset'), exact: domain === 'targets' })
          .click();
        await expect(input).toHaveValue(domain === 'slots' ? '' : '48');
        if (domain === 'targets') {
          await input.fill('72');
          await form.locator('button[type=submit]').click();
          await confirm.click();
          await dialog.locator('input[type=password]').fill('synthetic-password');
          await confirm.click();
          await expect(dialog).toHaveCount(0);
          await expect(input).toHaveValue('72');
          await expect(form.locator('button[type=submit]')).toBeDisabled();
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
          if (
            (locale === 'en' && theme === 'light' && info.project.name === 'chromium') ||
            (locale === 'fa' && theme === 'dark' && info.project.name === 'mobile-safari')
          ) {
            await page.setViewportSize({ width: 390, height: 2800 });
            await form.screenshot({
              path: info.outputPath(
                `consultation-targets-${locale}-${theme}-${info.project.name}.png`
              ),
            });
            await page.setViewportSize({ width: 390, height: 844 });
          }
        }
        denied = true;
        await page.getByRole('button', { name: refresh, exact: true }).click();
        await expect(input).toHaveCount(0);
        denied = false;
        await page.getByRole('button', { name: refresh, exact: true }).click();
        await expect(input).toHaveValue(domain === 'slots' ? '' : '72');
      });
    }

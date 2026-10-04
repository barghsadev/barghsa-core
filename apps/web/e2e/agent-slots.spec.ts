import { setupCatalogueForms } from './catalogue-form-fixture';
import { cookieResponse } from './cookie-response';
import { assignmentAgent, assignmentSlots } from '../src/test/assignment-settings-fixtures';
import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  test(`slot assignment retries after password verification (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await setupCatalogueForms(page, locale as 'en' | 'fa', false);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    const agent = assignmentAgent;
    await page.route('**/api/admin/agents', (route) => route.fulfill({ json: [agent] }));
    await page.route('**/api/admin/agent-slots', (route) =>
      route.fulfill(
        denied
          ? { status: 403, json: {} }
          : failed
            ? { status: 503, json: {} }
            : {
                json: assignmentSlots(),
              }
      )
    );
    await page.route('**/api/admin/agent-slots/*/agent', (route) => {
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      return route.fulfill({
        json: {
          ...assignmentSlots()[0],
          agent,
          alsoUsedIn: ['staff_chatbot'],
          updatedAt: '2026-10-01T01:00:00Z',
        },
      });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return verified
        ? cookieResponse(route, {
            json: { verified: true },
            headers: { 'Set-Cookie': 'barghsa_csrf=slot-fresh; Path=/; SameSite=Lax' },
          })
        : route.fulfill({ status: 401, json: {} });
    });
    await page.goto('/admin/agent-slots');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page
      .getByLabel(fa ? 'عامل · گفت‌وگوی شخص حقیقی' : 'Agent · Individual chatbot', { exact: true })
      .selectOption(agent.id);
    await expect(
      page
        .getByText(
          fa
            ? 'این عامل غیرفعال است. تخصیص آن باعث فعال شدن نمی‌شود.'
            : 'This agent is disabled. Assigning it does not enable it.'
        )
        .first()
    ).toBeVisible();
    await expect(
      page.getByText(fa ? 'تخصیص‌یافته به: گفت‌وگوی کارکنان' : 'Also assigned to: Staff chatbot', {
        exact: true,
      })
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: fa ? 'ذخیره تخصیص گفت‌وگوی شخص حقیقی' : 'Save assignment Individual chatbot',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await dialog.locator('input[type="password"]').fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.locator('input[type="password"]').fill('correct');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual([{ agentId: agent.id }, { agentId: agent.id }]);
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(page.locator('select[id^=slot-]')).toHaveCount(0);
  });

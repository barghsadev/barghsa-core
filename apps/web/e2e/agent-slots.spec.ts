import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  test(`slot assignment retries after password verification (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    const agent = {
      id: '01900000-0000-7000-8000-000000000001',
      title: 'Local support',
      enabled: false,
    };
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/admin/agents', (route) => route.fulfill({ json: [agent] }));
    await page.route('**/api/admin/agent-slots', (route) =>
      route.fulfill(
        denied
          ? { status: 403, json: {} }
          : failed
            ? { status: 503, json: {} }
            : {
                json: [
                  { slotKey: 'individual_chatbot', agent: null, alsoUsedIn: [] },
                  { slotKey: 'staff_chatbot', agent, alsoUsedIn: [] },
                ],
              }
      )
    );
    await page.route('**/api/admin/agent-slots/*/agent', (route) => {
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      return route.fulfill({ json: {} });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
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
    await expect(page.locator('select')).toHaveCount(0);
  });

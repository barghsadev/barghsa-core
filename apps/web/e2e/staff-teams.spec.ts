import { test, expect } from './coverage-fixture';
const id = '11111111-1111-4111-8111-111111111111';
for (const locale of ['en', 'fa'])
  test(`staff team and routing changes survive confirmation and failure (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    const text =
      locale === 'fa'
        ? {
            name: 'نام تیم',
            search: 'جستجوی کارکنان',
            save: 'ذخیره تیم',
            confirm: 'تأیید',
            password: 'رمز عبور خود را تأیید کنید',
            edit: 'ویرایش تیم',
            remove: 'حذف تیم',
            rules: 'ذخیره قوانین تخصیص',
            team: 'تیم مسئول',
            strategy: 'روش انتخاب عضو',
          }
        : {
            name: 'Team name',
            search: 'Search staff',
            save: 'Save team',
            confirm: 'Confirm',
            password: 'Confirm your password',
            edit: 'Edit team',
            remove: 'Delete team',
            rules: 'Save assignment rules',
            team: 'Assigned team',
            strategy: 'Member selection',
          };
    let teams: Array<{ id: string; name: string; memberUserIds: string[]; isActive: boolean }> = [],
      verified = false,
      fail = false;
    let rules = {
      ticket: { teamId: null as string | null, strategy: 'round_robin' },
      verification_case: { teamId: null as string | null, strategy: 'round_robin' },
    };
    const bodies: unknown[] = [];
    await page.route('**/api/admin/staff-teams/members?*', (route) =>
      route.fulfill({
        json: { items: [{ id: 'staff-a', name: 'Support Alice' }], selected: [], hasMore: false },
      })
    );
    await page.route('**/api/admin/staff-teams', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: teams });
      bodies.push(route.request().postDataJSON());
      if (!verified) return route.fulfill({ status: 403, json: { requiresStepUp: true } });
      teams = [{ id, ...route.request().postDataJSON(), isActive: true }];
      return route.fulfill({ status: 201, json: teams[0] });
    });
    await page.route(`**/api/admin/staff-teams/${id}`, (route) => {
      if (fail) return route.fulfill({ status: 500, json: {} });
      if (route.request().method() === 'DELETE') teams = [];
      else teams = [{ ...teams[0], ...route.request().postDataJSON() }];
      return route.fulfill({ json: { ok: true } });
    });
    await page.route('**/api/admin/config/assignment-rules', (route) => {
      if (route.request().method() === 'PUT') rules = route.request().postDataJSON();
      return route.fulfill({ json: rules });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = true;
      return route.fulfill({ json: { verified: true } });
    });
    await page.goto('/admin/staff-teams');
    await expect(page.locator('section').first()).toHaveAttribute(
      'dir',
      locale === 'fa' ? 'rtl' : 'ltr'
    );
    await page.getByLabel(text.name, { exact: true }).fill('Support');
    await page.getByLabel('Support Alice', { exact: true }).check();
    await page.getByRole('button', { name: text.save, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: text.confirm, exact: true }).click();
    await dialog.getByLabel(text.password).fill('Test-only-password');
    await dialog.getByRole('button', { name: text.confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(teams[0].memberUserIds).toEqual(['staff-a']);
    await page.getByRole('button', { name: text.edit, exact: true }).click();
    await page.getByLabel(text.name, { exact: true }).fill('Support revised');
    fail = true;
    await page.getByRole('button', { name: text.save, exact: true }).click();
    await dialog.getByRole('button', { name: text.confirm, exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(teams[0].name).toBe('Support');
    fail = false;
    await dialog.getByRole('button', { name: text.confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(teams[0].name).toBe('Support revised');
    await page.getByLabel(text.team, { exact: true }).first().selectOption(id);
    await page.getByLabel(text.strategy, { exact: true }).first().selectOption('load');
    await page.getByRole('button', { name: text.rules, exact: true }).click();
    await dialog.getByRole('button', { name: text.confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(rules.ticket).toEqual({ teamId: id, strategy: 'load' });
    await page.getByRole('button', { name: text.remove, exact: true }).click();
    await dialog.getByRole('button', { name: text.confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(teams).toEqual([]);
    await expect(page.getByLabel(text.team, { exact: true }).first()).toHaveValue(id);
  });

test('denied team settings show a retry without mutation controls', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 403, json: {} }));
  await page.goto('/admin/staff-teams');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
});

for (const locale of ['en', 'fa']) {
  test(`fallback priorities reorder, survive failed saves and clear on manual selection (${locale})`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    const third = '33333333-3333-4333-8333-333333333333';
    const teams = [first, second, third].map((teamId, index) => ({
      id: teamId,
      name: ['Alpha', 'Beta', 'Gamma'][index],
      memberUserIds: [],
      skillTags: [],
      isActive: true,
    }));
    let rules: {
      ticket: {
        teamId: string | null;
        strategy: string;
        fallbacks?: Array<{ teamId: string; strategy: string }>;
      };
      verification_case: { teamId: null; strategy: string };
    } = {
      ticket: { teamId: first, strategy: 'load' },
      verification_case: { teamId: null, strategy: 'round_robin' },
    };
    let fail = true;
    await page.route('**/api/admin/staff-teams', (route) => route.fulfill({ json: teams }));
    await page.route('**/api/admin/staff-teams/members?*', (route) =>
      route.fulfill({ json: { items: [], selected: [], hasMore: false } })
    );
    await page.route('**/api/admin/config/assignment-rules', (route) => {
      if (route.request().method() === 'PUT') {
        if (fail) return route.fulfill({ status: 503, json: {} });
        rules = route.request().postDataJSON();
      }
      return route.fulfill({ json: rules });
    });
    await page.goto('/admin/staff-teams');
    const add = page
      .getByRole('button', {
        name: locale === 'fa' ? 'افزودن تیم جایگزین' : 'Add fallback team',
        exact: true,
      })
      .first();
    await add.click();
    await expect(page.locator('#fallback-team-ticket-2')).toHaveValue(second);
    await page.locator('#fallback-strategy-ticket-2').selectOption('expertise');
    await add.click();
    const up = locale === 'fa' ? 'افزایش اولویت' : 'Move up';
    await page.getByRole('button', { name: `${up} 3`, exact: true }).click();
    await page.getByRole('button', { name: `${up} 2`, exact: true }).click();
    await expect(page.locator('#team-ticket')).toHaveValue(third);
    await page
      .getByRole('button', {
        name: `${locale === 'fa' ? 'کاهش اولویت' : 'Move down'} 1`,
        exact: true,
      })
      .click();
    await expect(page.locator('#team-ticket')).toHaveValue(first);
    await page
      .getByRole('button', {
        name: `${locale === 'fa' ? 'حذف اولویت' : 'Remove priority'} 2`,
        exact: true,
      })
      .click();
    await expect(page.locator('#fallback-team-ticket-2')).toHaveValue(second);
    await expect(page.locator('#fallback-strategy-ticket-2')).toHaveValue('expertise');
    for (const select of await page.locator('select').all())
      await expect(select).toHaveAccessibleName(/.+/);
    const save = page.getByRole('button', {
      name: locale === 'fa' ? 'ذخیره قوانین تخصیص' : 'Save assignment rules',
      exact: true,
    });
    await save.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Alpha');
    await expect(dialog).toContainText('Beta');
    await expect(dialog).not.toContainText('Gamma');
    const confirm = dialog.getByRole('button', {
      name: locale === 'fa' ? 'تأیید' : 'Confirm',
      exact: true,
    });
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(rules.ticket.fallbacks).toBeUndefined();
    fail = false;
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(rules.ticket).toEqual({
      teamId: first,
      strategy: 'load',
      fallbacks: [{ teamId: second, strategy: 'expertise' }],
    });
    await expect(
      page.getByText(locale === 'fa' ? 'تغییرات ذخیره شد.' : 'Changes saved.', { exact: true })
    ).toBeVisible();
    await page.locator('#fallback-strategy-ticket-2').selectOption('load');
    await expect(
      page.getByText(locale === 'fa' ? 'تغییرات ذخیره شد.' : 'Changes saved.', { exact: true })
    ).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#fallback-team-ticket-2')).toHaveValue(second);
    await page.locator('#team-ticket').selectOption('');
    await expect(page.locator('#fallback-team-ticket-2')).toHaveCount(0);
    await save.click();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(rules.ticket).toEqual({ teamId: null, strategy: 'load' });
  });
}

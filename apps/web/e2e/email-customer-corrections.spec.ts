import { crmShell } from './crm-shell-fixture';
import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { confirmationText } from '@barghsa/i18n/confirmation';

const row = {
  id: '10000000-0000-4000-8000-000000000001',
  address: 'recipient@example.test',
  profileId: null,
  createdAt: '2026-09-01T10:00:00Z',
  resolvedAt: null,
  resolutionNote: null,
};
for (const locale of ['en', 'fa'] as const) {
  const fa = locale === 'fa';
  const copy = {
    title: fa ? 'پیگیری اصلاح اطلاعات مشتری' : 'Customer contact corrections',
    refresh: fa ? 'تازه‌سازی پیگیری‌ها' : 'Refresh corrections',
    next: fa ? 'صفحه بعد پیگیری‌ها' : 'Next corrections',
    previous: fa ? 'صفحه قبل پیگیری‌ها' : 'Previous corrections',
    resolve: fa ? 'ثبت نتیجه پیگیری' : 'Record follow-up',
    note: fa ? 'نتیجه پیگیری' : 'Follow-up outcome',
    save: fa ? 'ثبت و بستن کار' : 'Save and complete',
    completed: fa ? 'کارهای انجام‌شده' : 'Completed tasks',
  };
  test(`correction queue guards access, validates pages and recovers (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await crmShell(page, locale);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'UTC' } })
    );
    let canView = false,
      malformed = true;
    await page.route('**/api/admin/failed-notifications/access', (route) =>
      route.fulfill({ json: { canView, canRetry: false } })
    );
    await page.route('**/api/admin/failed-notifications?*', (route) => route.fulfill({ json: [] }));
    const requests: number[] = [];
    await page.route('**/api/admin/notifications/customer-corrections?*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      const offset = Number(query.get('offset'));
      requests.push(offset);
      if (query.get('completed') === 'true') return route.fulfill({ json: [] });
      const rows = offset
        ? [{ ...row, address: 'second-page@example.test' }]
        : Array.from({ length: 26 }, (_, i) => ({
            ...row,
            id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
            address: `recipient${i}@example.test`,
          }));
      return route.fulfill({ json: malformed ? [{ ...row, id: 'wrong' }] : rows });
    });
    await page.goto('/admin/failed-notifications');
    await page.locator('summary').filter({ hasText: copy.title }).click();
    const panel = page.getByRole('region', { name: copy.title });
    await expect(panel.getByRole('alert')).toBeVisible();
    expect(requests).toEqual([]);
    canView = true;
    await panel.getByRole('button', { name: copy.refresh }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    malformed = false;
    await panel.getByRole('button', { name: copy.refresh }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(25);
    await expect(panel.getByRole('button', { name: copy.resolve })).toHaveCount(0);
    await panel.getByRole('button', { name: copy.next }).click();
    await expect(panel.getByText('second-page@example.test')).toBeVisible();
    expect(requests).toContain(25);
    await panel.getByRole('button', { name: copy.previous }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(25);
    await expect(panel).toHaveAttribute('dir', fa ? 'rtl' : 'ltr');
    expect(
      (await new AxeBuilder({ page }).include(`[aria-label="${copy.title}"]`).analyze()).violations
    ).toEqual([]);
    await panel.getByLabel(copy.completed).check();
    await expect(panel.getByRole('listitem')).toHaveCount(0);
  });
  test(`correction completion retains notes through step-up and rejects a wrong acknowledgment (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    await page.clock.install();
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'UTC' } })
    );
    await page.route('**/api/admin/failed-notifications/access', (route) =>
      route.fulfill({ json: { canView: true, canRetry: true } })
    );
    await page.route('**/api/admin/failed-notifications?*', (route) => route.fulfill({ json: [] }));
    let saved = false,
      calls = 0,
      openRows = [row];
    const note = fa ? 'اطلاعات تماس بررسی شد' : 'Contact details reviewed';
    const acknowledgment = { ...row, resolvedAt: '2026-09-13T10:00:00Z', resolutionNote: note };
    await page.route('**/api/admin/notifications/customer-corrections?*', (route) => {
      const completed = new URL(route.request().url()).searchParams.get('completed') === 'true';
      return route.fulfill({
        json: completed ? (saved ? [acknowledgment] : []) : saved ? [] : openRows,
      });
    });
    await page.route(
      `**/api/admin/notifications/customer-corrections/${row.id}/resolve`,
      (route) => {
        expect(route.request().postDataJSON()).toEqual({ note });
        expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
        calls++;
        if (calls === 1) return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        if (calls === 2)
          return route.fulfill({
            json: { ...acknowledgment, id: '10000000-0000-4000-8000-000000000002' },
          });
        if (calls === 3) return;
        saved = true;
        return route.fulfill({ json: acknowledgment });
      }
    );
    let stepUps = 0;
    await page.route('**/api/auth/step-up', (route) => {
      stepUps++;
      expect(route.request().postDataJSON()).toEqual({ password: 'fixture-password' });
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      return route.fulfill({ json: { verified: true } });
    });
    await page.route('**/api/admin/notifications/templates', (route) =>
      route.fulfill({ json: [] })
    );
    await page.goto(fa ? '/admin/notifications' : '/admin/failed-notifications');
    await page
      .context()
      .addCookies([
        { url: new URL(page.url()).origin, name: 'barghsa_csrf', value: 'fixture-csrf' },
      ]);
    await page.locator('summary').filter({ hasText: copy.title }).click();
    const panel = page.getByRole('region', { name: copy.title });
    const refresh = panel.getByRole('button', { name: copy.refresh });
    const save = panel.getByRole('button', { name: copy.save });
    await panel.getByRole('button', { name: copy.resolve, exact: true }).click();
    const outcome = panel.getByLabel(copy.note, { exact: true });
    await expect(outcome).toHaveAttribute('aria-required', 'true');
    await outcome.fill(`  ${note}  `);
    await save.click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await dialog.locator('input[type="password"]').fill('fixture-password');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('alert')).toHaveText(confirmationText('unconfirmed', locale));
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await expect(outcome).toHaveValue(note);
    await expect(save).toBeDisabled();
    await expect(refresh).toBeFocused();
    expect(calls).toBe(2);
    await refresh.click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog.locator('input[type="password"]')).toHaveCount(0);
    await confirm.click();
    await expect.poll(() => calls).toBe(3);
    await page.clock.fastForward(15_001);
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('alert')).toHaveText(confirmationText('unconfirmed', locale));
    await expect(outcome).toHaveValue(note);
    await expect(outcome).toHaveJSProperty('readOnly', true);
    await expect(save).toBeDisabled();

    openRows = [{ ...row, address: 'changed@example.test' }];
    await refresh.click();
    await expect(panel.getByRole('listitem')).toHaveText(/changed@example.test/);
    await expect(save).toBeDisabled();
    expect(calls).toBe(3);
    openRows = [row];
    await refresh.click();
    await expect(save).toBeEnabled();
    await expect(outcome).toHaveValue(note);
    await save.click();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('listitem')).toHaveCount(0);
    const savedNotice = fa
      ? 'نتیجه پیگیری ثبت شد. ارسال ایمیل همچنان مسدود است.'
      : 'Follow-up recorded. Email remains suppressed.';
    await expect(panel.getByRole('status').filter({ hasText: savedNotice })).toHaveText(
      savedNotice
    );
    await panel.getByLabel(copy.completed).check();
    await expect(panel.getByText(note, { exact: true })).toBeVisible();
    expect(calls).toBe(4);
    expect(stepUps).toBe(1);
  });
}

test('a committed correction with a lost receipt stays locked while staff check its history', async ({
  page,
}) => {
  await crmShell(page, 'en');
  await page.clock.install();
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'UTC' } })
  );
  let canView = true,
    committed = false,
    writes = 0;
  const note = 'Checked the customer contact record';
  await page.route('**/api/admin/failed-notifications/access', (route) =>
    route.fulfill({ json: { canView, canRetry: canView } })
  );
  await page.route('**/api/admin/failed-notifications?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/admin/notifications/customer-corrections?*', (route) => {
    const completed = new URL(route.request().url()).searchParams.get('completed') === 'true';
    return route.fulfill({
      json: completed
        ? committed
          ? [{ ...row, resolvedAt: '2026-09-13T10:00:00Z', resolutionNote: note }]
          : []
        : committed
          ? []
          : [row],
    });
  });
  await page.route(`**/api/admin/notifications/customer-corrections/${row.id}/resolve`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ note });
    writes++;
    committed = true;
  });
  await page.goto('/admin/failed-notifications');
  await page.locator('summary').filter({ hasText: 'Customer contact corrections' }).click();
  const panel = page.getByRole('region', { name: 'Customer contact corrections' });
  const refresh = panel.getByRole('button', { name: 'Refresh corrections' });
  const save = panel.getByRole('button', { name: 'Save and complete' });
  const outcome = panel.getByLabel('Follow-up outcome');
  await panel.getByRole('button', { name: 'Record follow-up' }).click();
  await outcome.fill(note);
  await save.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await page.clock.fastForward(15_001);
  await expect(dialog).toHaveCount(0);
  await refresh.click();
  await expect(panel.getByRole('listitem')).toHaveCount(0);
  await expect(save).toBeDisabled();
  await expect(outcome).toHaveValue(note);
  await panel.getByLabel('Completed tasks').check();
  await expect(panel.getByRole('listitem').getByText(note, { exact: true })).toBeVisible();
  await expect(panel.getByText('Follow-up recorded. Email remains suppressed.')).toHaveCount(0);
  expect(writes).toBe(1);

  canView = false;
  await refresh.click();
  await expect(panel.getByRole('alert')).toHaveText('You do not have permission for this action.');
  await expect(outcome).toHaveCount(0);
  await expect(panel.getByRole('listitem')).toHaveCount(0);
  canView = true;
  await refresh.click();
  await expect(panel.getByRole('listitem').getByText(note, { exact: true })).toBeVisible();
  await expect(outcome).toHaveCount(0);
  expect(writes).toBe(1);
});

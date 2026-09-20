import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';

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
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
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
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
    }, locale);
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
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'UTC' } })
    );
    await page.route('**/api/admin/failed-notifications/access', (route) =>
      route.fulfill({ json: { canView: true, canRetry: true } })
    );
    await page.route('**/api/admin/failed-notifications?*', (route) => route.fulfill({ json: [] }));
    let saved = false,
      calls = 0;
    const note = fa ? 'اطلاعات تماس بررسی شد' : 'Contact details reviewed';
    const acknowledgment = { ...row, resolvedAt: '2026-09-13T10:00:00Z', resolutionNote: note };
    await page.route('**/api/admin/notifications/customer-corrections?*', (route) => {
      const completed = new URL(route.request().url()).searchParams.get('completed') === 'true';
      return route.fulfill({
        json: completed ? (saved ? [acknowledgment] : []) : saved ? [] : [row],
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
        saved = true;
        return route.fulfill({ json: acknowledgment });
      }
    );
    await page.route('**/api/auth/step-up', (route) => route.fulfill({ json: { verified: true } }));
    await page.goto(fa ? '/admin/notifications' : '/admin/failed-notifications');
    await page.evaluate((lang) => {
      document.documentElement.lang = lang;
      document.cookie = 'barghsa_csrf=fixture-csrf; Path=/';
    }, locale);
    await page.locator('summary').filter({ hasText: copy.title }).click();
    const panel = page.getByRole('region', { name: copy.title });
    await panel.getByRole('button', { name: copy.resolve, exact: true }).click();
    await panel.getByLabel(copy.note, { exact: true }).fill(`  ${note}  `);
    await panel.getByRole('button', { name: copy.save }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await dialog.locator('input[type="password"]').fill('fixture-password');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    // The modal hides the background from the accessibility tree, but must not remove the task.
    await expect(
      page
        .getByRole('region', { name: copy.title, includeHidden: true })
        .getByRole('listitem', { includeHidden: true })
    ).toHaveCount(1);
    // Step-up clears its password after each submission, including an unconfirmed result.
    await dialog.locator('input[type="password"]').fill('fixture-password');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('listitem')).toHaveCount(0);
    await expect(panel.getByRole('status')).toContainText(
      fa ? 'همچنان مسدود' : 'remains suppressed'
    );
    await panel.getByLabel(copy.completed).check();
    await expect(panel.getByText(note, { exact: true })).toBeVisible();
    expect(calls).toBe(3);
  });
}

import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';

const eventId = '01900000-0000-7000-8000-000000000001';
const path = '/admin/authorization-audit';
const event = {
  id: eventId,
  event: 'authorization_denied',
  actorId: 'staff-operator',
  createdAt: '2026-09-30T12:00:00.000001Z',
  version: null,
  detailsAvailable: true,
  changes: Object.entries({
    resource: '/api/admin/providers',
    action: 'POST',
    reason: 'AUTHZ:FORBIDDEN',
    correlationId: 'review-trace',
  }).map(([field, value]) => ({
    field,
    previous: { recorded: false, value: null },
    current: { recorded: true, value },
  })),
};

for (const locale of ['en', 'fa'] as const) {
  test(`authorization denials keep shareable filters and exact event ownership (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    const word = (key: string) => t(`admin.audit.authorization.${key}`, locale);
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'operator-admin',
          isStaff: true,
          operatingContext: 'staff',
          requiresTosAcceptance: false,
          navigation: {
            version: 1,
            area: 'staff',
            profileId: null,
            profileType: null,
            paths: [path],
          },
        },
      })
    );
    const reads: URLSearchParams[] = [];
    let denied = false;
    let foreign = false;
    await page.route('**/api/admin/config/audit?*', (route) => {
      const params = new URL(route.request().url()).searchParams;
      reads.push(params);
      const item = foreign ? { ...event, id: '01900000-0000-7000-8000-000000000002' } : event;
      return route.fulfill(
        denied
          ? { status: 403, json: {} }
          : { json: { scope: 'authorization', items: [item], nextCursor: null } }
      );
    });

    await page.goto(path);
    const link = page.getByRole('link', { name: 'POST', exact: true });
    await expect(link).toBeVisible();
    const filterLabel = appText('historyFilters.label', locale);
    const openFilters = () => page.getByRole('button', { name: filterLabel, exact: true }).click();
    const drawer = page.getByRole('dialog', { name: filterLabel, exact: true });
    const actor = drawer.getByRole('textbox', { name: word('filter.actor'), exact: true });
    const action = drawer.getByRole('textbox', { name: word('filter.action'), exact: true });
    const from = drawer.getByRole('combobox', { name: word('filter.from'), exact: true });
    const through = drawer.getByRole('combobox', { name: word('filter.through'), exact: true });
    const calendar = page.locator('[data-slot="calendar"]');
    const apply = drawer.getByRole('button', { name: appText('historyFilters.apply', locale) });
    const cancel = drawer.getByRole('button', { name: appText('historyFilters.cancel', locale) });
    await openFilters();
    await expect(actor).toBeVisible();
    // Initialize the calendar's Date subclasses before Playwright replaces Date.
    await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
    await actor.fill('discard this draft');
    await cancel.click();
    await openFilters();
    await expect(actor).toHaveValue('');
    await expect.poll(() => drawer.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
    expect(
      (await new AxeBuilder({ page }).include('[data-slot="sheet-content"]').analyze()).violations
    ).toEqual([]);
    await actor.fill(`  ${event.actorId}  `);
    await action.fill('POST');
    await from.click();
    await calendar.locator('.rdp-today button').click();
    await through.click();
    await calendar.locator('td:has(+ .rdp-today) button').click();
    await apply.click();
    await expect(through).toHaveAccessibleDescription(word('filter.error.through'));
    await expect(through).toBeFocused();
    expect(reads).toHaveLength(1);
    await through.click();
    await calendar.locator('.rdp-today button').click();
    await apply.click();
    await expect.poll(() => reads.at(-1)?.get('through')).toBe('2026-09-30');
    expect(reads).toHaveLength(2);
    expect(reads.at(-1)?.get('from')).toBe('2026-09-30');
    expect(reads.at(-1)?.get('actor')).toBe(event.actorId);
    expect(reads.at(-1)?.get('action')).toBe('POST');
    await link.click();
    await expect(page).toHaveURL((url) => url.pathname === `${path}/${eventId}`);
    const proof = page.getByText('review-trace', { exact: true });
    await expect(proof).toBeVisible();
    expect(Object.fromEntries(reads.at(-1)!)).toEqual({ scope: 'authorization', eventId });
    await page.reload();
    await expect(proof).toBeVisible();
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await page
      .getByRole('main')
      .getByRole('link', { name: word('title'), exact: true })
      .click();
    await openFilters();
    await expect(actor).toHaveValue(event.actorId);
    await expect(action).toHaveValue('POST');
    await cancel.click();
    await page
      .getByRole('main')
      .getByRole('button', {
        name: appText('historyFilters.remove', locale).replace(
          '{filter}',
          `${word('filter.action')}: POST`
        ),
        exact: true,
      })
      .click();
    await expect
      .poll(() => Object.fromEntries(reads.at(-1)!))
      .toEqual({
        scope: 'authorization',
        actor: event.actorId,
        from: '2026-09-30',
        through: '2026-09-30',
      });
    await page
      .getByRole('main')
      .getByRole('button', { name: appText('historyFilters.clearAll', locale), exact: true })
      .click();
    await expect.poll(() => Object.fromEntries(reads.at(-1)!)).toEqual({ scope: 'authorization' });
    await expect(
      page.getByRole('list', { name: appText('historyFilters.selected', locale) })
    ).toHaveCount(0);
    foreign = true;
    await page.goto(`${path}/${eventId}`);
    await expect(page.getByRole('alert')).toContainText(word('error'));
    await expect(proof).toHaveCount(0);
    foreign = false;
    await page.getByRole('button', { name: word('retry') }).click();
    await expect(proof).toBeVisible();
    denied = true;
    await page.getByRole('button', { name: word('refresh') }).click();
    await expect(page.getByRole('alert')).toContainText(word('denied'));
    await expect(proof).toHaveCount(0);
  });
}

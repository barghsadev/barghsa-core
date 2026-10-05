import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';
import { t } from '@barghsa/i18n/admin-ui';

const screenshotRoot = process.env['BARGHSA_SCREENSHOT_DIR'] ?? '/tmp';
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`exact event filters restore URLs, retain unapplied work and retire obsolete confirmations (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await crmShell(page, locale);
      await mockOppositeNumerals(page, locale, dark);
      const label = (key: string) => t(`admin.notifications.${key}`, locale);
      const first = 'invoice.issued',
        second = 'catalogue.custom';
      const archive = {
        ...notificationTemplate(),
        id: 'first-archived',
        eventKey: first,
        subject: 'Saved invoice version',
        status: 'archived',
        version: 1,
        publishedAt: '2026-10-02T00:00:00Z',
        createdBy: 'staff-sample',
      };
      const rows = [
        archive,
        { ...archive, id: 'first-draft', status: 'draft', publishedAt: null, version: 2 },
        { ...archive, id: 'second-archived', eventKey: second, subject: 'Saved custom version' },
        {
          ...archive,
          id: 'second-draft',
          eventKey: second,
          subject: 'Custom draft',
          status: 'draft',
          publishedAt: null,
          version: 2,
        },
        { ...archive, id: 'similar-event', eventKey: second + '_extra' },
      ];
      let reads = 0,
        writes = 0,
        stepUps = 0,
        wrongScope = false,
        denied = false;
      const queries: URLSearchParams[] = [];
      await page.route(
        (url) => url.pathname === '/api/admin/notifications/templates',
        (route) => {
          expect(route.request().method()).toBe('GET');
          reads++;
          const params = new URL(route.request().url()).searchParams;
          queries.push(params);
          const selected = rows.filter((row) =>
            ['eventKey', 'locale', 'channel', 'status'].every(
              (key) => !params.get(key) || row[key as keyof typeof row] === params.get(key)
            )
          );
          return route.fulfill({
            status: denied ? 403 : 200,
            json: denied ? {} : wrongScope ? [archive] : selected,
          });
        }
      );
      await page.route('**/api/admin/notifications/templates/second-draft', (route) => {
        expect(route.request().method()).toBe('PUT');
        writes++;
        return route.fulfill({ status: 403, json: { requiresStepUp: true } });
      });
      await page.route('**/api/auth/step-up', (route) => {
        stepUps++;
        return route.fulfill({ json: { ok: true } });
      });
      await page.goto(
        `/admin/notifications?eventKey=${first}&locale=en&channel=email&status=archived&failed_channel=sms`
      );
      const root = page
        .locator('[data-slot=list-page]')
        .filter({ has: page.locator('#notification-event-filter') });
      const event = page.locator('#notification-event-filter');
      const apply = root.getByRole('button', { name: label('applyEventFilter'), exact: true });
      const status = root.getByRole('combobox', { name: label('allStatus'), exact: true });
      const refresh = root.getByRole('button', { name: label('refresh'), exact: true });
      const records = root.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2,h3)'
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(records).toHaveCount(1);
      await expect(event).toHaveValue(first);
      await expect(event).toHaveAccessibleName(label('filterEvent'));
      await expect(status).toHaveValue('archived');
      expect(Object.fromEntries(queries.at(-1)!)).toEqual({
        eventKey: first,
        locale: 'en',
        channel: 'email',
        status: 'archived',
      });
      await expect(records.getByRole('button', { name: label('edit'), exact: true })).toHaveCount(
        0
      );
      expect(
        (await new AxeBuilder({ page }).include('[data-slot=list-page]').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && info.project.name === 'mobile-safari') {
        await page.setViewportSize({ width: 390, height: 1800 });
        await root.screenshot({
          path: `${screenshotRoot}/event-filter-${dark ? 'dark' : 'light'}-fa.png`,
        });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await records.getByRole('button', { name: label('newVersion'), exact: true }).click();
      const body = page.locator('#notification-template-bodyTemplate');
      await body.fill('Private unapplied draft');
      await event.fill('invalid event');
      await apply.click();
      await expect(event).toBeFocused();
      await expect(event).toHaveAttribute('aria-invalid', 'true');
      await expect(body).toHaveValue('Private unapplied draft');
      expect(reads).toBe(1);
      expect(writes).toBe(0);
      await event.fill(`  ${second}  `);
      await expect(body).toHaveValue('Private unapplied draft');
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(event).toHaveValue(`  ${second}  `);
      expect(reads).toBe(1);
      await event.press('Enter');
      await expect.poll(() => new URL(page.url()).searchParams.get('eventKey')).toBe(second);
      await expect(body).toHaveCount(0);
      await expect(records).toHaveCount(1);
      await expect(records).toContainText('Saved custom version');
      await expect(event).toHaveValue(second);
      expect(new URL(page.url()).searchParams.get('failed_channel')).toBe('sms');
      expect(queries.at(-1)!.get('status')).toBe('archived');
      await page.evaluate(() => history.back());
      await expect(event).toHaveValue(first);
      await expect(records).toContainText('Saved invoice version');
      await expect(body).toHaveCount(0);
      await page.evaluate(() => history.forward());
      await expect(event).toHaveValue(second);
      await page.reload({ waitUntil: 'commit' });
      await expect(event).toHaveValue(second);
      await expect(status).toHaveValue('archived');
      await expect(records).toContainText('Saved custom version');
      const archivedCatalogueURL = page.url();
      await status.selectOption('draft');
      await records.getByRole('button', { name: label('edit'), exact: true }).click();
      await body.fill('Frozen previous scope');
      await page.locator('form').filter({ has: body }).locator('button[type=submit]').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCount(1);
      await dialog.locator('input[type=password]').fill('synthetic-password');
      expect(writes).toBe(1);
      // WebKit's email preview frames also contribute entries to joint session history.
      await expect
        .poll(async () => {
          if (page.url() !== archivedCatalogueURL) await page.evaluate(() => history.back());
          return page.url();
        })
        .toBe(archivedCatalogueURL);
      await expect(dialog).toHaveCount(0);
      await expect(status).toHaveValue('archived');
      await expect(body).toHaveCount(0);
      expect(stepUps).toBe(0);
      expect(writes).toBe(1);
      await status.selectOption('');
      await expect(records).toHaveCount(2);
      wrongScope = true;
      await refresh.click();
      await expect(root.getByRole('alert').filter({ hasText: label('error.load') })).toBeVisible();
      await expect(records).toHaveCount(2);
      await expect(records.filter({ hasText: 'Saved invoice version' })).toHaveCount(0);
      wrongScope = false;
      await refresh.click();
      await expect(root.getByRole('alert')).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await event.fill('');
      await apply.click();
      await expect.poll(() => new URL(page.url()).searchParams.has('eventKey')).toBe(false);
      await expect(records).toHaveCount(5);
      expect(new URL(page.url()).searchParams.get('locale')).toBe('en');
      expect(new URL(page.url()).searchParams.get('channel')).toBe('email');
      expect(new URL(page.url()).searchParams.get('failed_channel')).toBe('sms');
      expect(
        (await new AxeBuilder({ page }).include('[data-slot=list-page]').analyze()).violations
      ).toEqual([]);
      denied = true;
      await refresh.click();
      await expect(root.getByRole('alert').filter({ hasText: label('denied') })).toBeVisible();
      await expect(
        root.locator('table,ol[role=list],#notification-template-bodyTemplate')
      ).toHaveCount(0);
      expect(writes).toBe(1);
      expect(stepUps).toBe(0);
    });
  }

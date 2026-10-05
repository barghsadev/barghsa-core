import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';
import { formatBrowserDate } from './browser-date';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';

const screenshotRoot = process.env['BARGHSA_SCREENSHOT_DIR'] ?? '/tmp';
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`notification versions preserve metadata, one editor and captured decisions across breakpoints (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await crmShell(page, locale);
      await mockOppositeNumerals(page, locale, dark);
      const label = (key: string) => t(`admin.notifications.${key}`, locale);
      const draft = {
        ...notificationTemplate(),
        id: 'draft',
        eventKey: 'profile_verified',
        createdAt: '2026-09-20T20:45:00.000Z',
        version: 3,
        subject:
          'A complete subject with information that remains readable in the saved version catalogue',
      };
      const published = {
        ...draft,
        id: 'published',
        version: 2,
        status: 'active',
        isActive: true,
        createdBy: 'staff-sample',
        publishedAt: '2026-09-24T20:45:00.000Z',
      };
      const archived = {
        ...published,
        id: 'archived',
        version: 1,
        status: 'archived',
        isActive: false,
      };
      let rows = [draft, published, archived];
      let status = 200,
        reads = 0,
        verified = false;
      const writes: unknown[] = [];
      await page.route(
        (url) => url.pathname === '/api/admin/notifications/templates',
        (route) => {
          expect(route.request().method()).toBe('GET');
          reads++;
          return route.fulfill({ status, json: status === 200 ? rows : {} });
        }
      );
      await page.route('**/api/admin/notifications/templates/draft', (route) => {
        expect(route.request().method()).toBe('PUT');
        const body = route.request().postDataJSON();
        writes.push(body);
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        const saved = { ...draft, ...body, updatedAt: '2026-10-05T00:00:00Z' };
        rows = [saved, published, archived];
        return route.fulfill({ json: saved });
      });
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().postDataJSON()).toEqual({ password: 'synthetic-password' });
        verified = true;
        return route.fulfill({ json: { ok: true } });
      });
      await page.goto('/admin/notifications');
      await page.setViewportSize({ width: 900, height: 900 });
      const table = page.getByRole('table', { name: label('catalogue'), exact: true });
      await expect(table.locator('tbody tr:has(th[scope=row])')).toHaveCount(3);
      await expect(table.getByRole('columnheader')).toHaveCount(8);
      await expect(table.locator('thead')).toHaveCSS('position', 'sticky');
      const viewport = page.getByRole('region', { name: label('catalogue'), exact: true });
      await viewport.focus();
      await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect(viewport).toBeFocused();
      await expect
        .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
        .toBeGreaterThan(0);
      const activeRow = table.locator('tbody tr').nth(1);
      await expect(activeRow.getByRole('rowheader')).toContainText(locale === 'fa' ? '2' : '۲');
      await expect(activeRow).toContainText(published.subject);
      await expect(activeRow).toContainText('staff-sample');
      await expect(activeRow.locator('time').nth(1)).toHaveAttribute(
        'datetime',
        published.publishedAt
      );
      await expect(activeRow.locator('time').nth(1)).toHaveText(
        await formatBrowserDate(
          page,
          locale,
          { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' },
          published.publishedAt
        )
      );
      await expect(activeRow.getByRole('button', { name: label('edit'), exact: true })).toHaveCount(
        0
      );
      await activeRow.getByRole('button', { name: label('view'), exact: true }).click();
      const body = page.locator('#notification-template-bodyTemplate');
      const subject = page.locator('#notification-template-subject');
      const editor = page.locator('form').filter({ has: body });
      await expect(body).toHaveAttribute('readonly', '');
      await expect(editor.locator('button[type=submit]')).toBeDisabled();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(editor).toHaveCount(1);
      await expect(body).toHaveValue(published.bodyTemplate);
      expect(reads).toBe(1);
      expect(writes).toEqual([]);
      await editor.getByRole('button', { name: label('cancel'), exact: true }).click();
      const cards = page.getByRole('list', { name: label('catalogue'), exact: true });
      await expect(cards.locator(':scope > li')).toHaveCount(3);
      await expect(table).not.toBeVisible();
      const archivedCard = cards.locator(':scope > li').nth(2);
      await expect(archivedCard).toContainText(label('archived'));
      await expect(archivedCard).toContainText(published.subject);
      await expect(archivedCard.locator('time').first()).toHaveAttribute(
        'datetime',
        new Date(draft.createdAt).toISOString()
      );
      await expect(archivedCard.locator('time').nth(1)).toHaveText(
        await formatBrowserDate(
          page,
          locale,
          { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' },
          published.publishedAt
        )
      );
      expect(
        (await new AxeBuilder({ page }).include('[data-slot=list-page]').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && info.project.name === 'mobile-safari')
        await archivedCard.screenshot({
          path: `${screenshotRoot}/notification-${dark ? 'dark' : 'light'}-card-fa.png`,
        });
      await archivedCard.getByRole('button', { name: label('newVersion'), exact: true }).click();
      await expect(body).not.toHaveAttribute('readonly', '');
      await expect(body).toHaveValue(archived.bodyTemplate);
      await expect(page.locator('#notification-template-eventKey')).toHaveCount(1);
      expect(writes).toEqual([]);
      await editor.getByRole('button', { name: label('cancel'), exact: true }).click();
      await cards
        .locator(':scope > li')
        .first()
        .getByRole('button', { name: label('edit'), exact: true })
        .click();
      await subject.fill('  Local saved subject  ');
      await body.fill('  Local saved body  ');
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(subject).toHaveValue('  Local saved subject  ');
      await expect(body).toHaveValue('  Local saved body  ');
      await page.setViewportSize({ width: 390, height: 844 });
      expect(reads).toBe(1);
      const refresh = page.getByRole('button', { name: label('refresh'), exact: true });
      status = 503;
      await refresh.click();
      await expect(editor.locator('button[type=submit]')).toBeDisabled();
      await expect(body).toHaveValue('  Local saved body  ');
      await expect(cards.locator(':scope > li')).toHaveCount(3);
      status = 200;
      await refresh.click();
      await expect(editor.locator('button[type=submit]')).toBeEnabled();
      await editor.locator('button[type=submit]').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCount(1);
      await dialog.locator('input[type=password]').fill('synthetic-password');
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(dialog).toHaveCount(1);
      await expect(dialog.locator('input[type=password]')).toHaveValue('synthetic-password');
      expect(writes).toHaveLength(1);
      await dialog
        .getByRole('button', { name: appText('team.cancel', locale), exact: true })
        .click();
      await expect(refresh).toBeFocused();
      await expect(body).toHaveValue('  Local saved body  ');
      await editor.locator('button[type=submit]').click();
      await dialog.locator('input[type=password]').fill('synthetic-password');
      await page.setViewportSize({ width: 390, height: 844 });
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await expect(editor).toHaveCount(0);
      expect(writes).toHaveLength(3);
      expect(writes[0]).toEqual(writes[1]);
      expect(writes[1]).toEqual(writes[2]);
      await expect(cards.locator(':scope > li').first()).toContainText('Local saved subject');
      expect(
        (await new AxeBuilder({ page }).include('[data-slot=list-page]').analyze()).violations
      ).toEqual([]);
      status = 403;
      await refresh.click();
      await expect(page.getByRole('alert').filter({ hasText: label('denied') })).toBeVisible();
      await expect(page.locator('table,ol[role=list],#notification-template-eventKey')).toHaveCount(
        0
      );
      expect(writes).toHaveLength(3);
    });
  }

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { tConsultation } from '@barghsa/i18n/consultation';
import {
  consultationContextRows,
  consultationContextDetail,
  consultationContextTones,
  privateConsultationOwnerId,
} from '../src/test/consultation-assignment-fixtures';

test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const)
    test(`consultation assignment context and history (${locale}, ${theme})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, theme === 'dark');
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Pacific/Kiritimati' } })
      );
      const copy = (key: string) => tConsultation(key, locale);
      const requests = consultationContextRows();
      const selectedId = requests[0]!.id;
      let verified = false,
        denied = false,
        selectedDetailReceipts = 0;
      let detailReceiptsAtAssignment: number | null = null;
      const writes: unknown[] = [];
      await page.route('**/api/admin/consultations/teams', (route) =>
        route.fulfill({ json: { teams: [{ name: 'Operations Team' }] } })
      );
      await page.route('**/api/admin/consultations/requests?*', (route) =>
        route.fulfill({ status: denied ? 403 : 200, json: { requests, nextAfter: null } })
      );
      await page.route('**/api/admin/consultations/requests/*', async (route) => {
        const request = requests.find((item) =>
          new URL(route.request().url()).pathname.endsWith(`/requests/${item.id}`)
        );
        await route.fulfill({
          status: request ? 200 : 404,
          json: request ? consultationContextDetail(request) : {},
        });
        if (request?.id === selectedId && route.request().method() === 'GET')
          selectedDetailReceipts += 1;
      });
      await page.route(`**/api/admin/consultations/requests/${selectedId}/assign`, (route) => {
        const body = route.request().postDataJSON();
        writes.push(body);
        expect(body).toEqual({ assignTo: 'team', team: 'Operations Team' });
        if (!verified) return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        detailReceiptsAtAssignment = selectedDetailReceipts;
        requests[0] = {
          ...requests[0]!,
          staff_owner_id: null,
          staff_owner_name: null,
          staff_team: 'Operations Team',
          status: 'under_review',
        };
        return route.fulfill({ json: { status: 'under_review' } });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto('/admin/consultations');
      const queue = page.getByRole('region', { name: copy('staffTitle'), exact: true });
      const detail = page.getByRole('region', { name: copy('details'), exact: true });
      const rows = queue.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2,h3)'
      );
      await expect(rows).toHaveCount(10);
      expect(
        await rows
          .locator('[data-slot=badge]')
          .evaluateAll((badges) => badges.map((badge) => badge.getAttribute('data-variant')))
      ).toEqual(consultationContextTones);
      await expect(rows.nth(0)).toContainText('Reviewer <script>');
      await expect(rows.nth(1)).toContainText(copy('assignedStaff'));
      await expect(rows.nth(2)).toContainText(copy('assignedStaff'));
      await expect(rows.nth(3)).toContainText(copy('awaitingOwner'));
      await expect(rows.nth(3)).toContainText('Energy Team');
      await expect(rows.nth(4)).toContainText(copy('unassigned'));
      await expect(rows.nth(5)).toContainText(copy('unassigned'));
      await expect(rows.nth(9)).toContainText(copy('status_unknown'));
      await rows.nth(1).getByRole('button').click();
      await expect(
        detail.getByRole('heading', {
          name: requests[1]!.product_snapshot.title[locale],
          exact: true,
        })
      ).toBeVisible();
      await expect(detail.locator('[data-slot=consultation-assignment]')).toContainText(
        copy('assignedStaff')
      );
      await rows.nth(3).getByRole('button').click();
      await expect(
        detail.getByRole('heading', {
          name: requests[3]!.product_snapshot.title[locale],
          exact: true,
        })
      ).toBeVisible();
      await expect(detail.locator('[data-slot=consultation-assignment]')).toContainText(
        copy('awaitingOwner')
      );
      await rows.nth(0).getByRole('button').click();
      await expect(
        detail.getByRole('heading', {
          name: requests[0]!.product_snapshot.title[locale],
          exact: true,
        })
      ).toBeVisible();
      await expect(detail.locator('[data-slot=consultation-assignment]')).toContainText(
        'Reviewer <script>'
      );
      const timeline = detail.locator('[data-slot=status-timeline]');
      await expect(timeline.locator('li')).toHaveCount(10);
      expect(
        await timeline
          .locator('[data-tone]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tone')))
      ).toEqual(consultationContextTones);
      await expect(timeline).toContainText(copy('actor_customer'));
      await expect(timeline).toContainText(copy('actor_staff'));
      await expect(timeline).toContainText(copy('actor_unknown'));
      await expect(timeline).toContainText('Reviewer <script>');
      await expect(timeline).toContainText('<img src=x onerror=alert(1)>');
      await expect(timeline.locator('time').first()).toHaveAttribute(
        'datetime',
        '2026-09-23T10:00:00.000Z'
      );
      if (locale === 'en')
        await expect(timeline.locator('time').first()).toContainText('Sep 24, 2026');
      for (const privateValue of [
        privateConsultationOwnerId,
        'Unbound private name',
        'private_future_status',
        'private_actor_type',
        'Private future actor',
      ]) {
        await expect(queue).not.toContainText(privateValue);
        await expect(detail).not.toContainText(privateValue);
        await expect(timeline).not.toContainText(privateValue);
      }
      await expect(detail.locator('script, img')).toHaveCount(0);
      await detail.getByLabel(copy('team'), { exact: true }).selectOption('Operations Team');
      await detail.getByRole('button', { name: copy('assignTeam'), exact: true }).click();
      const dialog = page.getByRole('dialog', { name: copy('assignTeam'), exact: true });
      await dialog.locator('button[type=submit]').click();
      await dialog.locator('input[type=password]').fill('synthetic-password');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      expect(detailReceiptsAtAssignment).not.toBeNull();
      await expect.poll(() => selectedDetailReceipts).toBeGreaterThan(detailReceiptsAtAssignment!);
      await expect(detail.locator('[data-slot=consultation-assignment]')).toContainText(
        'Operations Team'
      );
      await expect(detail.locator('[data-slot=consultation-assignment]')).toContainText(
        copy('awaitingOwner')
      );
      await expect(detail.locator('[data-slot=consultation-assignment]')).not.toContainText(
        'Reviewer <script>'
      );
      await expect(rows.nth(0).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
      await expect(rows.nth(0)).toContainText('Operations Team');
      expect(writes).toEqual(Array(2).fill({ assignTo: 'team', team: 'Operations Team' }));
      expect(
        (
          await new AxeBuilder({ page })
            .include(`section[aria-label="${copy('staffTitle')}"]`)
            .include(`section[aria-label="${copy('details')}"]`)
            .analyze()
        ).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      for (const node of await queue.locator('button').all()) {
        const bounds = await node.boundingBox();
        if (bounds) {
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
        }
      }
      if (
        (locale === 'en' && theme === 'light' && info.project.name === 'chromium') ||
        (locale === 'fa' && theme === 'dark' && info.project.name === 'mobile-safari')
      )
        await page.screenshot({
          path: info.outputPath(
            `consultation-assignment-${locale}-${theme}-${info.project.name}.png`
          ),
          fullPage: true,
        });
      denied = true;
      await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
      await expect(rows).toHaveCount(0);
      await expect(queue.getByRole('alert')).toContainText(copy('queueForbidden'));
      await expect(detail.locator('[data-slot=consultation-assignment]')).toHaveCount(0);
      await expect(detail.locator('[data-slot=status-timeline]')).toHaveCount(0);
      expect(writes).toHaveLength(2);
    });

import { fullNavigation } from './navigation-fixture';
import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { tMaintenance } from '@barghsa/i18n/maintenance';

for (const locale of ['en', 'fa'] as const) {
  test(`staff dashboard isolates retries and reserves responsive widget space (${locale})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'staff',
          isStaff: true,
          navigation: fullNavigation('staff'),
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/maintenance', (route) =>
      route.fulfill({ json: { capabilities: [] } })
    );
    await page.route('**/api/admin/wallet/chargebacks/unresolved-warning', (route) =>
      route.fulfill({ json: { count: 0, unmatchedCount: 0, reversalFailedCount: 0, items: [] } })
    );
    let releaseVerification!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    await page.route('**/api/crm/dashboard/pending-verification', async (route) => {
      await held;
      return route.fulfill({ json: { enabled: true, count: 0, profiles: [] } });
    });
    const reads: Record<string, number> = {};
    let fail = true;
    let failuresStatus = 200;
    await page.route('**/api/admin/dashboard/widgets/**', (route) => {
      const widget = new URL(route.request().url()).pathname.split('/').at(-1)!;
      reads[widget] = (reads[widget] ?? 0) + 1;
      if (widget === 'work' && fail) return route.fulfill({ status: 503, json: {} });
      if (widget === 'failures' && failuresStatus !== 200)
        return route.fulfill({ status: failuresStatus, json: {} });
      return route.fulfill({
        json:
          widget === 'queue'
            ? {
                pendingTickets: 3,
                electricityOrders: 1,
                savingOrders: 2,
                unassignedConsultations: 1,
              }
            : widget === 'work'
              ? { consultations: 2, solarRequests: 1, documentReviews: 4, refundObligations: 0 }
              : { failedJobs: 2, deadLetterNotifications: 1, failedRefundObligations: null },
      });
    });
    await page.clock.install();
    try {
      await page.goto('/app');
      const work = page.getByRole('region', {
        name: t('dashboard.admin.work.title', locale),
        exact: true,
      });
      const queue = page.getByRole('region', {
        name: t('dashboard.admin.work.queueTitle', locale),
        exact: true,
      });
      const failures = page.getByRole('region', {
        name: t('dashboard.admin.failures.title', locale),
        exact: true,
      });
      const verification = page.getByRole('region', {
        name: t('dashboard.admin.pendingVerification.label', locale),
        exact: true,
      });
      await expect(work.getByRole('alert')).toBeVisible();
      await expect(queue.locator('a[href="/admin/tickets?status=active"]')).toBeVisible();
      await expect(failures.locator('a[href="/admin/failed-jobs"]')).toBeVisible();
      await expect(verification.getByRole('status')).toBeVisible();
      const geometry = (element: Element) => {
        const box = element.getBoundingClientRect();
        const grid = element.parentElement!.getBoundingClientRect();
        return { x: box.x - grid.x, y: box.y - grid.y, width: box.width, height: box.height };
      };
      const before = await work.evaluate(geometry);
      const verificationBefore = await verification.evaluate(geometry);
      const previous = { ...reads };
      fail = false;
      await work.getByRole('button', { name: dashboardText('widget.retry', locale) }).click();
      await expect(work.locator('a[href="/admin/documents"]')).toBeVisible();
      expect(reads.work).toBe(previous.work! + 1);
      expect(reads.queue).toBe(previous.queue);
      expect(reads.failures).toBe(previous.failures);
      releaseVerification();
      await expect(
        verification.getByText(dashboardText('verification.empty', locale))
      ).toBeVisible();
      const after = await work.evaluate(geometry);
      const verificationAfter = await verification.evaluate(geometry);
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(after[key]).toBeCloseTo(before[key], 2);
        expect(verificationAfter[key]).toBeCloseTo(verificationBefore[key], 2);
      }
      await expect(page.getByText(dashboardText('chargebacks.empty', locale))).toBeVisible();
      await expect(page.getByText(tMaintenance('noActive', locale))).toBeVisible();
      for (const [width, columns] of [
        [390, 1],
        [900, 2],
        [1440, 3],
      ] as const) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await work.evaluate(
            (card) => getComputedStyle(card.parentElement!).gridTemplateColumns.split(' ').length
          )
        ).toBe(columns);
        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
          )
          .toBe(true);
      }
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#admin-content').evaluate((main) => {
        main.scrollTop = 0;
      });
      await page.screenshot({
        path: `/tmp/barghsa-staff-widgets-${locale}-${testInfo.project.name}.png`,
        fullPage: true,
      });
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
      failuresStatus = 403;
      const oldReads = reads.failures!;
      await page.clock.runFor(30_000);
      await expect.poll(() => reads.failures).toBeGreaterThan(oldReads);
      await expect(failures).toHaveCount(0);
      await expect(queue.locator('a[href="/admin/tickets?status=active"]')).toBeVisible();
    } finally {
      releaseVerification();
    }
  });
}

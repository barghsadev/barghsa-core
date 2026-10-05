import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { verifyClippedContrast } from './clipped-contrast';
import { failedJob, deadLetter } from '../src/test/operational-queue-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function shell(page: Page, locale: 'en' | 'fa', darkMode: boolean) {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Operations',
        appTitleFa: 'عملیات',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
      },
    })
  );
}
async function inspect(page: Page, name: string, locale: string, project: string, dialog = false) {
  const popup = page.getByRole('dialog');
  if (dialog) {
    await popup.evaluate(async (node) => {
      await Promise.all(
        node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))
      );
    });
  }
  const scan = await new AxeBuilder({ page })
    .include(dialog ? '[role="dialog"]' : 'main')
    .analyze();
  expect(scan.violations).toEqual([]);
  if (dialog) {
    // Wrapped description/alert text can appear partially obscured to Axe.
    // Verify every reported text node against its opaque dialog background and
    // hit-test its visible lines rather than assuming one affected node.
    for (const item of scan.incomplete.filter((item) => item.id === 'color-contrast')) {
      for (const reported of item.nodes) {
        expect(reported.html).toMatch(/data-slot="dialog-description"|role="alert"/);
        const measured = await popup.locator(reported.target[0] as string).evaluate((node) => {
          const popup = node.closest('[role="dialog"]')!;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d')!;
          const color = (value: string) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = value;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
          };
          const fg = color(getComputedStyle(node).color),
            bg = color(getComputedStyle(popup).backgroundColor);
          const luminance = (rgb: number[]) =>
            rgb.slice(0, 3).reduce((sum, value, index) => {
              const s = value / 255;
              return (
                sum +
                [0.2126, 0.7152, 0.0722][index]! *
                  (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)
              );
            }, 0);
          const f = luminance(fg),
            b = luminance(bg);
          const range = document.createRange();
          range.selectNodeContents(node);
          const unobscured = Array.from(range.getClientRects()).every((rect) =>
            node.contains(
              document.elementFromPoint(
                rect.x + Math.min(10, rect.width / 2),
                rect.y + rect.height / 2
              )
            )
          );
          let opaque = true;
          for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement)
            if (getComputedStyle(ancestor).opacity !== '1') opaque = false;
          return {
            ratio: (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05),
            fg,
            bg,
            unobscured,
            opaque,
          };
        });
        expect(measured.fg[3]).toBe(255);
        expect(measured.bg[3]).toBe(255);
        expect(measured.opaque).toBe(true);
        expect(measured.unobscured).toBe(true);
        expect(measured.ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
  } else {
    await verifyClippedContrast(page, scan);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-operations-${name}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
const queues = [
  {
    kind: 'jobs',
    endpoint: '/api/admin/failed-jobs',
    url: '/admin/failed-jobs',
    prefix: 'admin.jobs.',
    row: failedJob,
  },
  {
    kind: 'notifications',
    endpoint: '/api/admin/failed-notifications',
    url: '/admin/failed-notifications',
    prefix: 'admin.notifications.deadLetter.',
    row: deadLetter,
  },
] as const;
for (const [locale, dark] of [
  ['en', false],
  ['fa', false],
  ['en', true],
  ['fa', true],
] as const) {
  const common = (key: string) => t(`admin.jobs.${key}`, locale);
  for (const queue of queues) {
    const word = (key: string) => t(`${queue.prefix}${key}`, locale);
    test(`${queue.kind} confirmation retains password through independent recovery (${locale}, dark=${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      let fail = false,
        accessFail = false,
        changed = false,
        reads = 0,
        accessReads = 0;
      await page.route(`**${queue.endpoint}/access`, (route) => {
        accessReads++;
        return route.fulfill({
          status: accessFail ? 503 : 200,
          json: { canView: true, canRetry: true },
        });
      });
      await page.route(`**${queue.endpoint}?*`, (route) => {
        reads++;
        return route.fulfill({
          status: fail ? 503 : 200,
          json: [{ ...queue.row, attempts: changed ? 4 : 5 }],
        });
      });
      await page.route(`**${queue.endpoint}/*/retry`, (route) =>
        route.fulfill({ status: 403, json: { requiresStepUp: true } })
      );
      await page.goto(queue.url);
      const row = page
        .locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
        .first();
      await row
        .getByRole('button', {
          name: queue.kind === 'jobs' ? word('retry') : `${word('retry')} invoice.created`,
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog');
      const confirm = dialog.getByRole('button', {
        name: appText('team.confirm', locale),
        exact: true,
      });
      await confirm.click();
      const password = dialog.locator('input[type=password]');
      await password.fill('pending-password');
      fail = true;
      await dialog.getByRole('button', { name: common('queueRetry'), exact: true }).click();
      await expect(confirm).toBeDisabled();
      await expect(password).toHaveValue('pending-password');
      await expect(row).toHaveCount(1);
      await inspect(
        page,
        `${queue.kind}-review-${dark ? 'dark' : 'light'}`,
        locale,
        info.project.name,
        true
      );
      const priorAccess = accessReads;
      fail = false;
      await dialog.getByRole('button', { name: common('queueRetry'), exact: true }).click();
      await expect(confirm).toBeEnabled();
      expect(accessReads).toBe(priorAccess);
      const priorReads = reads;
      accessFail = true;
      await dialog.getByRole('button', { name: common('accessRetry'), exact: true }).click();
      await expect(confirm).toBeDisabled();
      accessFail = false;
      await dialog.getByRole('button', { name: common('accessRetry'), exact: true }).click();
      await expect(confirm).toBeEnabled();
      expect(reads).toBe(priorReads);
      await expect(password).toHaveValue('pending-password');
      changed = true;
      await dialog.getByRole('button', { name: common('queueRetry'), exact: true }).click();
      await expect(dialog).toHaveCount(0);
    });
    test(`${queue.kind} failed page preserves rows and exact retry before access denial (${locale}, dark=${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      let fail = true,
        denied = false;
      const queries: string[] = [];
      const rows = Array.from({ length: 26 }, (_, index) => ({
        ...queue.row,
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      }));
      await page.route(`**${queue.endpoint}/access`, (route) =>
        route.fulfill({ json: { canView: true, canRetry: true } })
      );
      await page.route(`**${queue.endpoint}?*`, (route) => {
        const url = route.request().url();
        queries.push(url);
        const second = new URL(url).searchParams.get('offset') === '25';
        return route.fulfill({
          status: denied ? 403 : second && fail ? 503 : 200,
          json: second ? [{ ...queue.row, id: '10000000-0000-4000-8000-000000000027' }] : rows,
        });
      });
      await page.goto(queue.url);
      await expect(
        page.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(25);
      await page.setViewportSize({ width: 900, height: 844 });
      const viewport = page.getByRole('region', { name: word('table'), exact: true });
      await viewport.focus();
      await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect
        .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
        .toBeGreaterThan(0);
      await page.setViewportSize({ width: 390, height: 844 });
      if (queue.kind === 'jobs')
        await page
          .locator(
            'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
          )
          .first()
          .getByRole('checkbox')
          .check();
      await page
        .locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
        .first()
        .locator('summary')
        .click();
      await page.getByRole('button', { name: common('next'), exact: true }).click();
      await expect(page.locator('main').getByRole('alert')).toBeVisible();
      await expect(
        page.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(25);
      await expect(
        page
          .locator(
            'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
          )
          .first()
          .locator('details')
      ).toHaveAttribute('open', '');
      if (queue.kind === 'jobs')
        await expect(
          page
            .locator(
              'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
            )
            .first()
            .getByRole('checkbox')
        ).toBeChecked();
      const failed = queries.at(-1);
      expect(new URL(failed!).searchParams.get('offset')).toBe('25');
      await inspect(
        page,
        `${queue.kind}-page-${dark ? 'dark' : 'light'}`,
        locale,
        info.project.name
      );
      fail = false;
      await page.getByRole('button', { name: common('reload'), exact: true }).click();
      await expect(
        page.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(1);
      expect(queries.at(-1)).toBe(failed);
      denied = true;
      await page.getByRole('button', { name: common('refresh'), exact: true }).click();
      await expect(
        page.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
      ).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText(
        word(queue.kind === 'jobs' ? 'forbidden' : 'accessDenied')
      );
    });
  }
  test(`delivery history remains independent and closes on catalogue denial (${locale}, dark=${dark})`, async ({
    page,
  }, info) => {
    await shell(page, locale, dark);
    let fail = false,
      denied = false,
      historyReads = 0;
    await page.route('**/api/admin/failed-notifications/access', (route) =>
      route.fulfill({ status: denied ? 403 : 200, json: { canView: true, canRetry: true } })
    );
    await page.route('**/api/admin/failed-notifications?*', (route) =>
      route.fulfill({ status: fail ? 503 : 200, json: [deadLetter] })
    );
    await page.route('**/api/admin/notifications/delivery-logs?*', (route) => {
      historyReads++;
      return route.fulfill({ json: [] });
    });
    await page.goto('/admin/failed-notifications');
    await page
      .locator('summary:visible')
      .filter({ hasText: t('admin.notifications.deadLetter.details', locale) })
      .click();
    await page
      .getByRole('button', { name: t('admin.notifications.history.title', locale), exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(t('admin.notifications.history.empty', locale));
    await inspect(page, `history-${dark ? 'dark' : 'light'}`, locale, info.project.name, true);
    // Parent refresh is behind a modal; dispatching the existing control models
    // an external catalogue refresh without attempting to click through it.
    fail = true;
    await page
      .getByRole('button', { name: common('refresh'), exact: true, includeHidden: true })
      .evaluate((node) => (node as HTMLButtonElement).click());
    await expect(page.locator('main [role=alert]')).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(historyReads).toBe(1);
    denied = true;
    await page
      .getByRole('button', { name: common('refresh'), exact: true, includeHidden: true })
      .evaluate((node) => (node as HTMLButtonElement).click());
    await expect(dialog).toHaveCount(0);
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(0);
  });
}

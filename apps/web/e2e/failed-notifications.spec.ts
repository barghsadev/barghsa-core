import { checkRoutePresentation } from './route-presentation';
import { measureControlContrast } from './control-contrast';
import { t } from '@barghsa/i18n/admin-ui';
import { tWorkspace } from '@barghsa/i18n/workspace-admin';
import { crmShell } from './crm-shell-fixture';
import { formatBrowserDate } from './browser-date';
import { test, expect } from './coverage-fixture';
import { ErrorCodes } from '@barghsa/shared/errors';

test.use({ viewport: { width: 390, height: 844 } });

for (const locale of ['en', 'fa'])
  test(`notification triage handles permissions, paging and step-up failures (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    const rows = Array.from({ length: 26 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      outboxId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      jobId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      eventKey: `test.event.${index}`,
      channel: 'email',
      severity: 'error',
      status: 'open',
      cause: 'Test provider failure',
      attempts: 5,
      maxAttempts: 5,
      createdAt: '2026-09-01T01:00:00Z',
      recipientKey: 'ab...yz',
      data: { token: '***' },
      resolvedById: null,
      resolvedAt: null,
      errorCategory: 'transient',
    }));
    let canView = true,
      canRetry = false,
      failLoad = true,
      verified = false,
      failSave = true;
    const attempts: string[] = [],
      queries: URLSearchParams[] = [];
    await crmShell(page, locale);
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
    );
    await page.route('**/api/admin/failed-notifications/access', (route) =>
      route.fulfill({ json: { canView, canRetry } })
    );
    await page.route('**/api/admin/failed-notifications?*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      queries.push(query);
      return route.fulfill(
        failLoad ? { status: 503, json: {} } : { json: query.get('offset') === '25' ? [] : rows }
      );
    });
    await page.route('**/api/admin/failed-notifications/*/retry', (route) => {
      attempts.push(route.request().url());
      if (!verified)
        return route.fulfill({
          status: 403,
          json: { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
        });
      if (failSave) return route.fulfill({ status: 503, json: {} });
      canRetry = false;
      return route.fulfill({ json: { ...rows[0], status: 'retried' } });
    });
    await page.route('**/api/admin/failed-notifications/*', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const id = new URL(route.request().url()).pathname.split('/').at(-1);
      const selected = rows.find((row) => row.id === id);
      return selected ? route.fulfill({ json: selected }) : route.fallback();
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct-password';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/failed-notifications');
    await expect(page.getByRole('alert')).toBeVisible();
    failLoad = false;
    await page.getByRole('button', { name: fa ? 'تلاش مجدد' : 'Try again', exact: true }).click();
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(25);
    await checkRoutePresentation(page, test.info(), locale);
    const currentPage = page
      .getByRole('navigation', {
        name: tWorkspace('admin.notifications.deadLetter.pagination', locale),
        exact: true,
      })
      .locator('[aria-current="page"]');
    const pageLabel = (value: number) =>
      t('admin.jobs.page', locale).replace('{page}', new Intl.NumberFormat(locale).format(value));
    await expect(currentPage).toHaveText(pageLabel(1));
    const corrections = page.getByText(
      tWorkspace('admin.notifications.corrections.title', locale),
      {
        exact: true,
      }
    );
    const initialScheme = await page.evaluate(() =>
      matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    );
    const contrast = [];
    try {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expect
          .poll(() => page.locator('html').evaluate((root) => root.classList.contains('dark')))
          .toBe(colorScheme === 'dark');
        for (const [control, target] of [
          ['current page', currentPage],
          ['corrections disclosure', corrections],
        ] as const) {
          await target.scrollIntoViewIfNeeded();
          await expect(target).toBeInViewport({ ratio: 1 });
          const visibleText = await target.evaluate((node) => {
            for (let layer: Element | null = node; layer; layer = layer.parentElement) {
              const style = getComputedStyle(layer);
              if (style.opacity !== '1' || style.backgroundImage !== 'none') return false;
            }
            const range = document.createRange();
            range.selectNodeContents(node);
            const rects = Array.from(range.getClientRects());
            return (
              rects.length > 0 &&
              rects.every((rect) =>
                node.contains(
                  document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
                )
              )
            );
          });
          expect(visibleText, `${control} has unobscured text on a solid surface`).toBe(true);
          const ratio = await measureControlContrast(target, 'text');
          expect(ratio, `${control} in the ${colorScheme} theme`).toBeGreaterThanOrEqual(4.5);
          contrast.push({ colorScheme, control, ratio });
        }
      }
    } finally {
      await page.emulateMedia({ colorScheme: initialScheme });
    }
    await test.info().attach('notification-triage-text-contrast', {
      body: JSON.stringify({ locale, contrast }),
      contentType: 'application/json',
    });
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      const controls = page.locator('main').locator('select, summary').filter({ visible: true });
      const sizes = await controls.evaluateAll((elements) =>
        elements.map((element) => {
          const { width, height } = element.getBoundingClientRect();
          return { width, height };
        })
      );
      expect(sizes.length).toBeGreaterThanOrEqual(5);
      for (const { width, height } of sizes) {
        expect(width).toBeGreaterThanOrEqual(44);
        expect(height).toBeGreaterThanOrEqual(44);
      }
    }
    await expect(
      page
        .locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
        )
        .first()
    ).toContainText(
      await formatBrowserDate(
        page,
        locale,
        {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'medium',
          timeStyle: 'short',
        },
        rows[0]!.createdAt
      )
    );
    await expect(
      page.locator('table:visible tbody button:visible, ol[role=list]:visible > li button:visible')
    ).toHaveCount(0);
    await page.getByRole('button', { name: fa ? 'بعدی' : 'Next', exact: true }).click();
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(0);
    await expect.poll(() => queries.at(-1)?.get('offset')).toBe('25');
    await expect(currentPage).toHaveText(pageLabel(2));
    await page.getByRole('button', { name: fa ? 'قبلی' : 'Previous', exact: true }).click();
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(25);
    await expect(currentPage).toHaveText(pageLabel(1));
    await page.getByLabel(fa ? 'کانال' : 'Channel', { exact: true }).selectOption('sms');
    await expect.poll(() => queries.at(-1)?.get('channel')).toBe('sms');
    await page.getByLabel(fa ? 'شدت' : 'Severity', { exact: true }).selectOption('critical');
    await expect.poll(() => queries.at(-1)?.get('severity')).toBe('critical');
    canRetry = true;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page
      .getByRole('button', { name: `${fa ? 'تلاش مجدد' : 'Retry'} test.event.0`, exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await expect(dialog).toContainText('ab...yz');
    await confirm.click();
    const password = dialog.locator('input[type="password"]');
    await password.fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await password.fill('correct-password');
    await confirm.click();
    await expect(dialog).toContainText(t('admin.operationalReview.title', locale));
    await expect(confirm).toHaveCount(0);
    await dialog
      .getByRole('button', { name: t('admin.operationalReview.reviewed', locale), exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const retry = page.getByRole('button', {
      name: `${t('admin.notifications.deadLetter.retry', locale)} test.event.0`,
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await retry.click();
    failSave = false;
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true })
    ).toBeFocused();
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts).size).toBe(1);
    await expect(
      page.locator('table:visible tbody button:visible, ol[role=list]:visible > li button:visible')
    ).toHaveCount(0);
    await expect(
      page
        .locator('main[data-area=admin]')
        .getByRole('status')
        .filter({ hasText: fa ? 'تحویل هنوز' : 'Delivery is not yet confirmed' })
    ).toContainText(fa ? 'تحویل هنوز' : 'Delivery is not yet confirmed');
    canView = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(fa ? 'دسترسی غیرمجاز' : 'Access denied');
    await expect(
      page.locator(
        'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2, h3)'
      )
    ).toHaveCount(0);
  });

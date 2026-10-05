import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { failedJob, deadLetter } from '../src/test/operational-queue-fixtures';
import { t } from '@barghsa/i18n/admin-ui';
import AxeBuilder from '@axe-core/playwright';

async function setup(page: Page, locale: 'en' | 'fa', family: 'jobs' | 'notifications') {
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
        darkMode: locale === 'fa',
      },
    })
  );
  const endpoint = `/api/admin/failed-${family}`;
  let rows = [family === 'jobs' ? failedJob : deadLetter];
  let readStatus = 200,
    wrongIdentity = false,
    listFails = false;
  const reads: string[] = [];
  const queries: string[] = [];
  await page.route(`**${endpoint}**`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/access'))
      return route.fulfill({ json: { canView: true, canRetry: true } });
    if (url.pathname !== endpoint) {
      reads.push(url.pathname);
      const row = rows.find((row) => url.pathname.endsWith(`/${row.id}`));
      return route.fulfill({
        status: row ? readStatus : 404,
        json:
          row && readStatus === 200
            ? wrongIdentity
              ? { ...row, id: '90000000-0000-4000-8000-000000000001' }
              : row
            : {},
      });
    }
    queries.push(url.search);
    return route.fulfill({
      status: listFails ? 503 : 200,
      json: rows.filter(
        (row) => !url.searchParams.get('status') || row.status === url.searchParams.get('status')
      ),
    });
  });
  const word = (key: string) =>
    t(`admin.${family === 'jobs' ? 'jobs' : 'notifications.deadLetter'}.${key}`, locale);
  const reviewWord = (key: string) => t(`admin.operationalReview.${key}`, locale);
  const dialog = () => page.getByRole('dialog');
  const confirm = () =>
    dialog().getByRole('button', { name: t('team.confirm', locale), exact: true });
  const review = () => dialog().getByRole('button', { name: reviewWord('reviewed'), exact: true });
  const reread = () => dialog().getByRole('button', { name: reviewWord('retry'), exact: true });
  const retry = () =>
    page
      .locator('tbody tr')
      .first()
      .getByRole('button', { name: word('retry') });
  await page.goto(`/admin/failed-${family}`);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  return {
    endpoint,
    reads,
    queries,
    word,
    reviewWord,
    dialog,
    confirm,
    review,
    reread,
    retry,
    rows: () => rows,
    save: (value: typeof rows) => {
      rows = value;
    },
    read: (status: number, wrong = false) => {
      readStatus = status;
      wrongIdentity = wrong;
    },
    listFail: (value: boolean) => {
      listFails = value;
    },
  };
}
async function inspect(page: Page, locale: string, project: string, name: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCSS('opacity', '1');
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual(
    []
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 2000 });
    await dialog.scrollIntoViewIfNeeded();
    await dialog.evaluate(async (node) => {
      node.scrollTop = 0;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    });
    await expect.poll(async () => (await dialog.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
    await dialog.screenshot({
      path: `/Users/majid/.local/state/barghsa-manual-batches/operational-command-review/${name}-fa.png`,
    });
  }
}
for (const locale of ['en', 'fa'] as const) {
  test(`job retry reviews exact status after an uncertain save without replay (${locale})`, async ({
    page,
  }) => {
    const s = await setup(page, locale, 'jobs');
    let writes = 0;
    await page.route(`**${s.endpoint}/*/retry`, (route) => {
      writes++;
      s.save([{ ...failedJob, status: 'retrying', attempts: 1 }]);
      return route.fulfill({ status: 503, json: {} });
    });
    s.read(503);
    await s.retry().click();
    await s.confirm().click();
    await expect(s.dialog()).toContainText(s.reviewWord('title'));
    await expect(s.dialog().getByRole('button', { name: t('team.confirm', locale) })).toHaveCount(
      0
    );
    await expect(s.dialog().getByRole('alert')).toContainText(s.reviewWord('error'));
    await expect(s.review()).toBeDisabled();
    expect(s.reads).toEqual([`${s.endpoint}/${failedJob.id}`]);
    expect(writes).toBe(1);
    s.read(200);
    await s.reread().click();
    await expect(s.dialog()).toContainText(s.word('status.retrying'));
    await expect(s.review()).toBeEnabled();
    expect(writes).toBe(1);
    await s.review().click();
    await expect(s.dialog()).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(0);
    expect(writes).toBe(1);
  });
  test(`bulk jobs verify every target and require a fresh queue before another review (${locale})`, async ({
    page,
  }, info) => {
    const s = await setup(page, locale, 'jobs');
    const second = {
      ...failedJob,
      id: '10000000-0000-4000-8000-000000000002',
      jobType: 'contract_activation',
    };
    s.save([failedJob, second]);
    await page.getByRole('button', { name: s.word('refresh'), exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await page.getByRole('checkbox').nth(0).check();
    await page.getByRole('checkbox').nth(1).check();
    const bodies: unknown[] = [];
    await page.route(`**${s.endpoint}/retry-bulk`, (route) => {
      bodies.push(route.request().postDataJSON());
      s.save([{ ...failedJob, status: 'retrying', attempts: 1 }, second]);
      return route.fulfill({
        json: [
          { ...failedJob, status: 'retrying' },
          { ...failedJob, status: 'retrying' },
        ],
      });
    });
    await page.getByRole('button', { name: s.word('bulk') }).click();
    await s.confirm().click();
    await expect(s.dialog()).toContainText(s.reviewWord('title'));
    await expect(s.dialog().getByRole('listitem')).toHaveCount(2);
    await expect(s.dialog()).toContainText(s.word('status.retrying'));
    await expect(s.dialog()).toContainText(s.word('status.failed'));
    expect([...s.reads].sort()).toEqual(
      [`${s.endpoint}/${failedJob.id}`, `${s.endpoint}/${second.id}`].sort()
    );
    expect(bodies).toEqual([{ ids: [failedJob.id, second.id] }]);
    await inspect(page, locale, info.project.name, 'jobs-review');
    s.listFail(true);
    await s.review().click();
    await expect(page.getByRole('alert')).toContainText(s.word('error'));
    await expect(page.getByRole('checkbox').first()).toBeDisabled();
    await expect(s.retry()).toBeDisabled();
    expect(bodies).toHaveLength(1);
    s.listFail(false);
    await page.getByRole('button', { name: s.word('refresh'), exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(s.retry()).toBeEnabled();
    await s.retry().click();
    await expect(s.dialog()).toContainText(t('admin.jobs.type.contract_activation', locale));
    expect(bodies).toHaveLength(1);
  });
  test(`notification retry verifies masked identity after a lost response (${locale})`, async ({
    page,
  }, info) => {
    const s = await setup(page, locale, 'notifications');
    let writes = 0;
    await page.route(`**${s.endpoint}/*/retry`, (route) => {
      writes++;
      s.save([{ ...deadLetter, status: 'retried' }]);
      return route.abort('connectionreset');
    });
    s.read(200, true);
    await s.retry().click();
    await s.confirm().click();
    await expect(s.dialog().getByRole('alert')).toContainText(s.reviewWord('error'));
    await expect(s.review()).toBeDisabled();
    expect(writes).toBe(1);
    s.read(200);
    await s.reread().click();
    await expect(s.dialog()).toContainText(s.word('statusRetried'));
    await expect(s.dialog()).toContainText('ab...yz');
    await expect(s.review()).toBeEnabled();
    expect(s.reads).toEqual([`${s.endpoint}/${deadLetter.id}`, `${s.endpoint}/${deadLetter.id}`]);
    await inspect(page, locale, info.project.name, 'notifications-review');
    await s.review().click();
    await expect(s.dialog()).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(0);
    expect(writes).toBe(1);
  });
  for (const family of ['jobs', 'notifications'] as const)
    test(`${family} exact-read denial removes private captured work (${locale})`, async ({
      page,
    }) => {
      const s = await setup(page, locale, family);
      let writes = 0;
      s.read(403);
      await page.route(`**${s.endpoint}/*/retry`, (route) => {
        writes++;
        return route.fulfill({ status: 503, json: {} });
      });
      await s.retry().click();
      await s.confirm().click();
      await expect(s.dialog()).toHaveCount(0);
      await expect(page.locator('tbody tr')).toHaveCount(0);
      await expect(page.getByRole('alert')).toBeVisible();
      expect(writes).toBe(1);
      expect(s.reads).toEqual([`${s.endpoint}/${s.rows()[0]!.id}`]);
    });
}

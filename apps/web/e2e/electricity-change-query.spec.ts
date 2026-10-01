import { test, expect, type Page } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { crmShell } from './crm-shell-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import {
  changeContractId,
  changeCursor,
  increaseRow,
  increaseReview,
  priceState,
  priceRow,
} from '../src/test/electricity-change-fixtures';

test.use({ viewport: { width: 390, height: 844 } });
const params = (page: Page) => new URL(page.url()).searchParams;
async function shell(page: Page, locale: 'en' | 'fa') {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (r) =>
    r.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برق‌آسا',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        logoUrl: null,
        faviconUrl: null,
        darkMode: locale === 'fa',
      },
    })
  );
}
async function accessible(page: Page, locale: 'en' | 'fa') {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(locale === 'fa');
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
for (const locale of ['en', 'fa'] as const) {
  test(`increase URLs restore status and exact cursor without private work (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    const copy = (key: string) => t(`admin.electricityIncreases.${key}`, locale);
    let fail = true,
      deny = false;
    const reads: string[] = [],
      writes: string[] = [];
    await page.route(
      (url) => url.pathname === '/api/staff/electricity/increase-requests',
      (r) => {
        const url = new URL(r.request().url());
        reads.push(url.search);
        if (deny) return r.fulfill({ status: 403, json: {} });
        if (fail && url.searchParams.has('before')) return r.fulfill({ status: 503, json: {} });
        return r.fulfill({
          json: {
            requests: [{ ...increaseRow, status: url.searchParams.get('status') }],
            nextBefore: url.searchParams.has('before') ? null : changeCursor,
          },
        });
      }
    );
    await page.route('**/increase-requests/*/approve/review', (r) =>
      r.fulfill({ json: increaseReview('approve') })
    );
    await page.route('**/increase-requests/*/approve', (r) => {
      writes.push(r.request().url());
      return r.fulfill({ json: {} });
    });
    await page.goto('/admin/electricity-increases');
    const list = page.getByRole('region', { name: copy('listTitle'), exact: true });
    const reason = page.locator('#increase-reason-' + increaseRow.requestId);
    await reason.fill('PRIVATE-CAPACITY');
    await list.getByRole('button', { name: copy('more'), exact: true }).click();
    await expect(list.getByRole('alert')).toBeVisible();
    expect(params(page).get('cursor')).toBe(changeCursor);
    await expect(reason).toHaveValue('PRIVATE-CAPACITY');
    const failed = reads.at(-1);
    fail = false;
    await list.getByRole('button', { name: copy('retry'), exact: true }).click();
    await expect(list.getByRole('alert')).toHaveCount(0);
    expect(reads.at(-1)).toBe(failed);
    expect(new URLSearchParams(failed).get('before')).toBe(changeCursor);
    await expect(reason).toHaveValue('PRIVATE-CAPACITY');
    await page.getByRole('button', { name: copy('approve'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect.poll(() => params(page).get('cursor')).toBeNull();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(reason).toHaveValue('');
    await page.goForward();
    await expect.poll(() => params(page).get('cursor')).toBe(changeCursor);
    await page.reload();
    await expect(reason).toHaveValue('');
    expect(new URLSearchParams(reads.at(-1)).get('before')).toBe(changeCursor);
    await page.getByRole('button', { name: copy('expiredTab'), exact: true }).click();
    await expect.poll(() => params(page).get('status')).toBe('expired');
    expect(params(page).get('cursor')).toBeNull();
    await expect(list.getByRole('button', { name: copy('approve'), exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(reason).toHaveValue('');
    expect(page.url()).not.toContain('PRIVATE-');
    expect(writes).toEqual([]);
    await accessible(page, locale);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await page.screenshot({
        path: '/tmp/barghsa-electricity-query-increase-fa.png',
        fullPage: true,
      });
    deny = true;
    await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
    await expect(list.getByRole('alert')).toContainText(copy('forbidden'));
    await expect(reason).toHaveCount(0);
  });
  test(`price URLs apply one contract and history discards obsolete drafts and confirmation (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    const copy = (key: string) => t(`admin.electricityPrice.${key}`, locale);
    const reads: string[] = [],
      writes: string[] = [];
    let fail = false;
    await page.route(
      (url) => /\/api\/staff\/electricity\/contracts\/[^/]+\/price-adjustments$/.test(url.pathname),
      (r) => {
        reads.push(r.request().url());
        const contractId = new URL(r.request().url()).pathname.split('/')[5];
        return fail
          ? r.fulfill({ status: 503, json: {} })
          : r.fulfill({
              json: {
                ...priceState,
                contractId,
                canPropose: false,
                adjustments: [
                  { ...priceRow, calculation: { ...priceRow.calculation, contractId } },
                ],
              },
            });
      }
    );
    await page.route('**/electricity/price-adjustments/*/finalize', (r) => {
      writes.push(r.request().url());
      return r.fulfill({ json: {} });
    });
    await page.goto(`/admin/electricity-price-adjustments?contractId=${changeContractId}`);
    const input = page.locator('#electricity-price-contract');
    const list = page.getByRole('region', { name: copy('listTitle'), exact: true });
    await expect(list).toContainText('Published tariff');
    const count = reads.length;
    await input.fill(changeCursor);
    expect(params(page).get('contractId')).toBe(changeContractId);
    expect(reads).toHaveLength(count);
    await page.getByRole('button', { name: copy('open'), exact: true }).click();
    await expect.poll(() => params(page).get('contractId')).toBe(changeCursor);
    await expect.poll(() => reads.at(-1)?.includes('/' + changeCursor + '/')).toBe(true);
    await list.getByRole('button', { name: copy('finalize'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(input).toHaveValue(changeContractId);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => reads.at(-1)?.includes('/' + changeContractId + '/')).toBe(true);
    await page.goForward();
    await expect(input).toHaveValue(changeCursor);
    await page.reload();
    await expect(input).toHaveValue(changeCursor);
    await expect(list).toContainText('Published tariff');
    fail = true;
    await list.getByRole('button', { name: copy('refresh'), exact: true }).click();
    await expect(list.getByRole('alert')).toBeVisible();
    const failed = reads.at(-1);
    fail = false;
    await list.getByRole('button', { name: copy('retry'), exact: true }).click();
    await expect(list.getByRole('alert')).toHaveCount(0);
    expect(reads.at(-1)).toBe(failed);
    expect(writes).toEqual([]);
    await accessible(page, locale);
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await page.screenshot({
        path: '/tmp/barghsa-electricity-query-price-fa.png',
        fullPage: true,
      });
    await page.goto(
      '/admin/electricity-price-adjustments?contractId=private-invalid&reason=SECRET'
    );
    await expect(page.getByRole('heading', { name: copy('title'), exact: true })).toBeVisible();
    await expect(input).toHaveValue('');
    await expect(list).toHaveCount(0);
  });
}

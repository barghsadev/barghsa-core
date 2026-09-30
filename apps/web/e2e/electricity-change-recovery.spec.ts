import { test, expect, type Page } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import {
  changeContractId,
  changeCursor,
  increaseRow,
  increaseReview,
  priceReview,
  priceState,
} from '../src/test/electricity-change-fixtures.js';

async function shell(page: Page, locale: 'en' | 'fa') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'staff',
        isStaff: true,
        operatingContext: 'staff',
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
}
for (const locale of ['en', 'fa'] as const) {
  test(`increase queue keeps reasons and exact cursors through recovery (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    const copy = (key: string) => t(`admin.electricityIncreases.${key}`, locale);
    let status = 503,
      hold = false;
    let held: Route | undefined;
    const queries: string[] = [];
    await page.route(
      (url) => url.pathname === '/api/staff/electricity/increase-requests',
      (route) => {
        queries.push(new URL(route.request().url()).search);
        if (hold) {
          held = route;
          return;
        }
        return status === 200
          ? route.fulfill({ json: { requests: [increaseRow], nextBefore: changeCursor } })
          : route.fulfill({ status, json: {} });
      }
    );
    await page.goto('/admin/electricity-increases');
    const main = page.getByRole('main');
    const list = main.getByRole('region', { name: copy('listTitle'), exact: true });
    const content = list.locator('[data-slot="list-content"]');
    await expect(content.getByRole('alert')).toBeVisible();
    status = 200;
    await content.getByRole('button', { name: copy('retry'), exact: true }).click();
    const reason = page.locator(`#increase-reason-${increaseRow.requestId}`);
    await reason.fill('Capacity explanation');
    await page.locator(`#increase-effective-${increaseRow.requestId}`).fill('2026-10-06T12:00');
    hold = true;
    await list.getByRole('button', { name: copy('more'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await expect(content).toHaveAttribute('aria-busy', 'true');
    await expect(reason).toHaveValue('Capacity explanation');
    await held!.fulfill({ status: 503, json: {} });
    hold = false;
    await expect(content.getByRole('alert')).toBeVisible();
    const failed = queries.at(-1)!;
    expect(new URLSearchParams(failed).get('before')).toBe(changeCursor);
    await content.getByRole('button', { name: copy('retry'), exact: true }).click();
    await expect(content.getByRole('alert')).toHaveCount(0);
    expect(queries.at(-1)).toBe(failed);
    await expect(reason).toHaveValue('Capacity explanation');
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await page.screenshot({
        path: '/tmp/barghsa-electricity-increase-fa-mobile-safari.png',
        fullPage: true,
      });
    status = 403;
    await main.getByRole('button', { name: copy('refresh'), exact: true }).click();
    await expect(content.getByRole('alert')).toContainText(copy('forbidden'));
    await expect(reason).toHaveCount(0);
    await expect(content.getByRole('button', { name: copy('retry'), exact: true })).toHaveCount(0);
  });
  test(`price adjustment recovery keeps draft and exact financial review before scope changes (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    const copy = (key: string) => t(`admin.electricityPrice.${key}`, locale);
    let status = 503,
      version = priceState.versionId;
    const publishBodies: Record<string, string>[] = [];
    await page.route(
      (url) => /\/api\/staff\/electricity\/contracts\/[^/]+\/price-adjustments$/.test(url.pathname),
      (route) => {
        if (route.request().method() === 'POST') {
          publishBodies.push(route.request().postDataJSON() as Record<string, string>);
          return route.fulfill({ status: 503, json: {} });
        }
        const contractId = new URL(route.request().url()).pathname.split('/')[5]!;
        return status === 200
          ? route.fulfill({ json: { ...priceState, contractId, versionId: version } })
          : route.fulfill({ status, json: {} });
      }
    );
    await page.route('**/price-adjustments/review', (route) =>
      route.fulfill({ json: priceReview(route.request().postDataJSON()) })
    );
    await page.goto(`/admin/electricity-price-adjustments?contractId=${changeContractId}`);
    const main = page.getByRole('main');
    const list = main.getByRole('region', { name: copy('listTitle'), exact: true });
    await expect(list.getByRole('alert')).toBeVisible();
    status = 200;
    await list.getByRole('button', { name: copy('retry'), exact: true }).click();
    await page.locator('#price-percent').fill('10');
    await page.locator('#price-effective').fill('2026-10-06T12:00');
    await page.locator('#price-reason').fill('Tariff draft');
    await page.locator('#price-basis').fill('Clause draft');
    status = 503;
    await list.getByRole('button', { name: copy('refresh'), exact: true }).click();
    await expect(list.getByRole('alert')).toBeVisible();
    await expect(page.locator('#price-reason')).toHaveValue('Tariff draft');
    status = 200;
    await list.getByRole('button', { name: copy('retry'), exact: true }).click();
    await expect(list.getByRole('alert')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await page.screenshot({
        path: '/tmp/barghsa-electricity-price-fa-mobile-safari.png',
        fullPage: true,
      });
    await list.getByRole('button', { name: copy('reviewProposal'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(copy('reviewTitle'));
    const confirm = dialog.getByRole('button', {
      name: locale === 'en' ? 'Confirm' : 'تأیید',
      exact: true,
    });
    await confirm.click();
    await expect.poll(() => publishBodies.length).toBe(1);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect.poll(() => publishBodies.length).toBe(2);
    expect(publishBodies[1]).toEqual(publishBodies[0]);
    expect(publishBodies[0]!.expectedReviewHash).toBe('b'.repeat(64));
    await dialog
      .getByRole('button', { name: locale === 'en' ? 'Cancel' : 'انصراف', exact: true })
      .click();
    version = 'changed-version';
    await list.getByRole('button', { name: copy('refresh'), exact: true }).click();
    await expect(page.locator('#price-reason')).toHaveValue('Tariff draft');
    await page.locator('#electricity-price-contract').fill('other-contract');
    await main.getByRole('button', { name: copy('open'), exact: true }).click();
    await expect(page.locator('#price-reason')).toHaveValue('');
    status = 401;
    await list.getByRole('button', { name: copy('refresh'), exact: true }).click();
    await expect(list.getByRole('alert')).toContainText(copy('forbidden'));
    await expect(page.locator('#price-reason')).toHaveCount(0);
  });
  test(`increase decision submits the reviewed hash and retains its key after a failed write (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const copy = (key: string) => t(`admin.electricityIncreases.${key}`, locale);
    const writes: Record<string, string>[] = [];
    await page.route('**/api/staff/electricity/increase-requests?*', (route) =>
      route.fulfill({ json: { requests: [increaseRow], nextBefore: null } })
    );
    await page.route(`**/increase-requests/${increaseRow.requestId}/approve/review`, (route) =>
      route.fulfill({ json: increaseReview('approve') })
    );
    await page.route(`**/increase-requests/${increaseRow.requestId}/approve`, (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, json: {} });
    });
    await page.goto('/admin/electricity-increases');
    await page.getByRole('button', { name: copy('approve'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(copy('reviewTitle'));
    const confirm = dialog.getByRole('button', {
      name: locale === 'en' ? 'Confirm' : 'تأیید',
      exact: true,
    });
    await confirm.click();
    await expect.poll(() => writes.length).toBe(1);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]!.expectedReviewHash).toBe('a'.repeat(64));
  });
}

import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { tOrderComments } from '@barghsa/i18n/order-comments';
import { tSaving } from '@barghsa/i18n/saving';
import { test, expect } from './coverage-fixture';
import { completeOtp } from './otp-step-up-fixture';
import {
  setupOrderCommentForms,
  electricityOrder,
  savingOrder,
  buyerId,
  staffId,
} from './order-comment-form-fixture';
async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-description.*-message/);
}
async function inspect(page: Page, region: Locator) {
  const focusedId = await page.evaluate(() => document.activeElement?.id);
  await region.getByTestId('order-comment-form').locator('button[type=submit]').hover();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(focusedId);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="order-comments"]').analyze()).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await region.locator('textarea,select,button').all()) {
    const box = await control.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
async function holdSchema(page: Page) {
  const manifest = JSON.parse(
    await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/' + manifest['src/lib/order-comment-form-schemas.ts'].file,
    async (route) => {
      await held;
      await route.continue();
    }
  );
  return release;
}
const key = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  const copy = (name: string) => t(`electricity.comments.${name}`, locale);
  const common = (name: string) => tOrderComments(name, locale);
  test(`customer comment forms preserve paging and exact electricity/saving receipts (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persist } = await setupOrderCommentForms(page, locale, false);
    const release = await holdSchema(page);
    await page.goto(`/electricity/orders/${electricityOrder}`);
    let section = page.getByTestId('order-comments');
    let form = section.getByTestId('order-comment-form');
    let body = page.locator('#electricity-comment-customer');
    let send = form.getByRole('button', { name: copy('sendComment'), exact: true });
    await expect(section.locator('ol>li')).toHaveCount(50);
    await expect(section.locator('ol>li').first()).toContainText('Chronological comment 2');
    await expect(section.locator('ol>li').last()).toContainText('Chronological comment 51');
    await expect(section).not.toContainText('PRIVATE_INTERNAL_NOTE');
    await expect(body).not.toHaveAttribute('aria-invalid', 'true');
    await send.click();
    await expect(send).toBeDisabled();
    await form.dispatchEvent('submit');
    expect(state.writes).toEqual([]);
    release();
    await focusedError(body);
    await body.fill('x'.repeat(10001));
    await send.click();
    await focusedError(body);
    expect(state.writes).toEqual([]);
    await body.fill('  Existing <script> reply  ');
    const older = section.getByRole('button', { name: copy('olderComments'), exact: true });
    state.readMode = 'held';
    await older.click();
    await expect.poll(() => !!state.readRoute).toBe(true);
    const failedPage = state.reads.at(-1)!;
    await state.readRoute!.fulfill({ status: 503, json: {} });
    await expect(section.getByRole('alert')).toBeVisible();
    await expect(section.locator('ol>li')).toHaveCount(50);
    await expect(body).toHaveValue('  Existing <script> reply  ');
    state.readMode = 'success';
    await section.getByTestId('order-comment-reload').click();
    await expect(section.locator('ol>li')).toHaveCount(52);
    await expect(section.locator('ol>li').first()).toContainText('Chronological comment 0');
    expect(state.reads.at(-1)).toEqual(failedPage);
    expect(state.reads.at(-1)!.before).toBe(state.threads.get(electricityOrder)![2]!.id);
    await expect(body).toHaveValue('  Existing <script> reply  ');
    await send.click();
    let dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await focusedError(body);
    await expect(body).toHaveValue('  Existing <script> reply  ');
    expect(state.writes[0]!.body).toEqual({
      body: 'Existing <script> reply',
      idempotencyKey: expect.stringMatching(key),
    });
    await expect(section).not.toContainText('PRIVATE_SERVER_COMMENT_TEXT');
    await inspect(page, section);
    await body
      .locator('..')
      .screenshot({ path: info.outputPath(`comment-customer-${locale}-${theme}.png`) });
    state.writeMode = 'held';
    await send.click();
    dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.writeRoute).toBe(true);
    const captured = state.writes.at(-1)!;
    const total = state.writes.length;
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.writes).toHaveLength(total);
    const receipt = persist(captured.body, electricityOrder, 'electricity');
    await state.writeRoute!.fulfill({ status: 503, json: {} });
    await expect(dialog).toHaveCount(0);
    const retry = section.getByTestId('order-comment-retry');
    await expect(retry).toHaveText(common('retryCaptured'));
    await expect(body).toHaveValue('  Existing <script> reply  ');
    await expect(section.getByTestId('order-comment-reload')).toBeDisabled();
    const reads = state.reads.length;
    await form.dispatchEvent('submit');
    await section.getByTestId('order-comment-reload').dispatchEvent('click');
    expect(state.reads).toHaveLength(reads);
    expect(state.writes).toHaveLength(total);
    expect(receipt.authorUserId).toBe(buyerId);
    state.writeMode = 'success';
    await retry.click();
    dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(body).toHaveValue('');
    expect(state.writes.slice(-2)).toEqual([captured, captured]);
    await expect(
      section.locator('ol>li').filter({ hasText: 'Existing <script> reply' })
    ).toHaveCount(2);
    await expect(section.locator('script')).toHaveCount(0);
    // Customer data must never contain internal electricity rows, even from a malformed server page.
    state.readMode = 'leak';
    await section.getByTestId('order-comment-reload').click();
    await expect(section.getByRole('alert')).toBeVisible();
    await expect(section).not.toContainText('PRIVATE_INTERNAL_NOTE');
    state.readMode = locale === 'en' ? 'denied' : 'missing';
    await section.getByTestId('order-comment-reload').click();
    await expect(section).toContainText(common(locale === 'en' ? 'forbidden' : 'missing'));
    await expect(section).not.toContainText('Existing <script> reply');
    await expect(section).not.toContainText('Chronological comment');
    // The shared saving branch accepts the same body/key contract without a visibility property.
    state.readMode = 'success';
    state.writeMode = 'success';
    await page.goto(`/savings/orders/${savingOrder}`);
    section = page.getByTestId('order-comments');
    form = section.getByTestId('order-comment-form');
    body = page.locator('#saving-comment-customer');
    await expect(form.locator('select')).toHaveCount(0);
    await body.fill('  Saving customer <script> message  ');
    send = form.getByRole('button', { name: tSaving('sendComment', locale), exact: true });
    await send.click();
    dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await expect(body).toHaveValue('');
    expect(state.writes.at(-1)!.path).toBe(`/api/saving/orders/${savingOrder}/comments`);
    expect(state.writes.at(-1)!.body).toEqual({
      body: 'Saving customer <script> message',
      idempotencyKey: expect.stringMatching(key),
    });
    await expect(section).toContainText('Saving customer <script> message');
    await inspect(page, section);
    await body
      .locator('..')
      .screenshot({ path: info.outputPath(`comment-saving-customer-${locale}-${theme}.png`) });
  });
  test(`staff comment forms preserve visibility, OTP and captured electricity/saving commands (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persist } = await setupOrderCommentForms(page, locale, true);
    const release = await holdSchema(page);
    await page.goto(`/admin/electricity-orders?orderId=${electricityOrder}`);
    let section = page.getByTestId('order-comments');
    let form = section.getByTestId('order-comment-form');
    let body = page.locator('#electricity-comment-staff');
    const visibility = page.locator('#electricity-comment-visibility');
    let send = form.getByRole('button', { name: copy('sendComment'), exact: true });
    await expect(section).toContainText('PRIVATE_INTERNAL_NOTE');
    await send.click();
    await expect(send).toBeDisabled();
    await form.dispatchEvent('submit');
    expect(state.writes).toEqual([]);
    release();
    await focusedError(body);
    await body.fill('  Private <script> reply  ');
    await send.click();
    await focusedError(visibility);
    await expect(body).toHaveValue('  Private <script> reply  ');
    expect(state.writes).toEqual([]);
    await visibility.selectOption('internal');
    state.writeMode = 'owned-visibility';
    await send.click();
    let dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await focusedError(visibility);
    await expect(body).toHaveValue('  Private <script> reply  ');
    await expect(visibility).toHaveValue('internal');
    expect(state.writes[0]!.body).toEqual({
      body: 'Private <script> reply',
      visibility: 'internal',
      idempotencyKey: expect.stringMatching(key),
    });
    await expect(section).not.toContainText('PRIVATE_SERVER_COMMENT_TEXT');
    await inspect(page, section);
    await form.screenshot({ path: info.outputPath(`comment-staff-${locale}-${theme}.png`) });
    state.writeMode = 'held';
    state.needsStepUp = true;
    await send.click();
    dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await completeOtp(dialog, locale);
    await expect.poll(() => !!state.writeRoute).toBe(true);
    expect(state.writes.slice(-2)[1]).toEqual(state.writes.slice(-2)[0]);
    const captured = state.writes.at(-1)!;
    const receipt = persist(captured.body, electricityOrder, 'electricity');
    expect(receipt.authorUserId).toBe(staffId);
    expect(receipt.visibility).toBe('internal');
    await state.writeRoute!.fulfill({ status: 200, json: { ...receipt, authorUserId: buyerId } });
    await expect(dialog).toHaveCount(0);
    await expect(section.getByTestId('order-comment-retry')).toBeEnabled();
    await expect(body).toHaveValue('  Private <script> reply  ');
    await expect(visibility).toHaveValue('internal');
    const count = state.writes.length;
    await form.dispatchEvent('submit');
    expect(state.writes).toHaveLength(count);
    state.writeMode = 'success';
    await section.getByTestId('order-comment-retry').click();
    dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(body).toHaveValue('');
    await expect(visibility).toHaveValue('');
    expect(state.writes.slice(-2)).toEqual([captured, captured]);
    await expect(section).toContainText('Private <script> reply');
    // An old selected-order read cannot deny or disclose thread data after selection changes.
    state.readMode = 'held';
    await section.getByTestId('order-comment-reload').click();
    await expect.poll(() => !!state.readRoute).toBe(true);
    const stale = state.readRoute!;
    state.readMode = 'success';
    await page.getByRole('button', { name: /Other Comment Buyer/ }).click();
    await expect(
      page.locator('#admin-content dd').filter({ hasText: /^Other Comment Buyer$/ })
    ).toBeVisible();
    await expect(body).toHaveValue('');
    await stale
      .fulfill({
        status: 403,
        json: {
          error: {
            code: 'AUTHZ:FORBIDDEN',
            message: 'OBSOLETE_PRIVATE_DENIAL',
            correlationId: '89000000-0000-4000-8000-000000000005',
          },
        },
      })
      .catch(() => {});
    await expect(section).toContainText('Chronological comment');
    await expect(section).not.toContainText('Private <script> reply');
    await expect(section).not.toContainText('OBSOLETE_PRIVATE_DENIAL');
    await expect(section.getByRole('alert')).toHaveCount(0);
    // Staff saving replies have no visibility field or invented internal-note policy.
    state.needsStepUp = false;
    state.writeMode = 'owned-body';
    await page.goto(`/admin/saving-orders?orderId=${savingOrder}`);
    section = page.getByTestId('order-comments');
    form = section.getByTestId('order-comment-form');
    body = page.locator('#saving-comment-staff');
    await expect(form.locator('select')).toHaveCount(0);
    await body.fill('  Saving expert reply  ');
    send = form.getByRole('button', { name: tSaving('sendComment', locale), exact: true });
    await send.click();
    dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await focusedError(body);
    await expect(body).toHaveValue('  Saving expert reply  ');
    state.writeMode = 'success';
    await send.click();
    dialog = page.getByRole('dialog');
    await dialog.locator('button[type=submit]').click();
    await expect(body).toHaveValue('');
    expect(state.writes.at(-1)!.path).toBe(`/api/staff/saving/orders/${savingOrder}/comments`);
    expect(state.writes.at(-1)!.body).toEqual({
      body: 'Saving expert reply',
      idempotencyKey: expect.stringMatching(key),
    });
    await expect(section).toContainText('Saving expert reply');
    await inspect(page, section);
    await body
      .locator('..')
      .screenshot({ path: info.outputPath(`comment-saving-staff-${locale}-${theme}.png`) });
  });
}

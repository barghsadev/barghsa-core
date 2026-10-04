import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { tConsultation } from '@barghsa/i18n/consultation';
import {
  setupConsultationForms,
  consultationProfile,
  consultationProduct,
  createdRequest,
  informationRequest,
  unpaidRequest,
} from './consultation-form-fixture';

const settings = [
  ['en', 'light'],
  ['fa', 'dark'],
] as const;
async function focusedError(field: Locator, errorOwner: Locator = field) {
  await expect(field).toBeFocused();
  await expect(errorOwner).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-message/);
}
async function inspectForm(page: Page, scope: Locator, selector: string) {
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const viewportWidth = page.viewportSize()!.width;
  for (const field of await scope.locator('input,textarea,select,button').all()) {
    const bounds = await field.boundingBox();
    if (bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewportWidth + 1);
    }
  }
}
async function closeSettledDialog(dialog: Locator, locale: 'en' | 'fa') {
  const cancel = dialog.getByRole('button', { name: t('team.cancel', locale), exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(dialog).toHaveCount(0);
}

for (const [locale, theme] of settings) {
  const copy = (key: string) => tConsultation(key, locale);
  test(`consultation intake validates lazily and retries the same captured submission (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state } = await setupConsultationForms(page, locale, theme === 'dark', true);
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    );
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      '**/' + manifest['src/lib/consultation-form-schemas.ts'].file,
      async (route) => {
        await delayed;
        await route.continue();
      }
    );
    await page.goto('/consultations');
    const group = page.getByRole('group', { name: copy('intakeForm'), exact: true });
    const form = group.locator('form');
    const product = page.locator(`#consultation-product-${consultationProduct}`);
    const productGroup = page.getByRole('radiogroup', { name: copy('available'), exact: true });
    const confirmation = page.locator('#consultation-confirmation');
    const submit = group.locator('button[type=submit]');
    await submit.click();
    await expect(submit).toBeDisabled();
    await form.dispatchEvent('submit');
    await form.dispatchEvent('submit');
    expect(state.intakeWrites).toEqual([]);
    release();
    await focusedError(product, productGroup);
    await product.check();
    await submit.click();
    await focusedError(confirmation);
    expect(state.intakeWrites).toEqual([]);
    await confirmation.check();
    await submit.click();
    await focusedError(product, productGroup);
    await expect(product).toBeChecked();
    await expect(confirmation).toBeChecked();
    expect(state.intakeWrites).toHaveLength(1);
    expect(state.intakeWrites[0]).toMatchObject({
      profileId: consultationProfile,
      productId: consultationProduct,
    });
    expect(state.intakeWrites[0]!.submissionKey).toMatch(/^[0-9a-f-]{36}$/);
    state.intakeMode = 'unsafe';
    await submit.click();
    await expect.poll(() => state.intakeWrites.length).toBe(2);
    await expect(group.getByText(copy('submitError'), { exact: true })).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(group).not.toContainText('submissionKey');
    await expect(group).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await expect(product).toBeChecked();
    await expect(confirmation).toBeChecked();
    await inspectForm(page, group, `[aria-label="${copy('intakeForm')}"]`);
    await group.screenshot({ path: info.outputPath(`consultation-intake-${locale}-${theme}.png`) });

    state.intakeMode = 'held';
    await submit.click();
    await expect.poll(() => !!state.intake).toBe(true);
    const captured = state.intakeWrites.at(-1)!;
    await expect(product).toBeDisabled();
    await expect(confirmation).toBeDisabled();
    const beforeDuplicate = state.intakeWrites.length;
    await form.dispatchEvent('submit');
    await form.dispatchEvent('submit');
    expect(state.intakeWrites).toHaveLength(beforeDuplicate);
    state.created = true;
    await state.intake!.fulfill({ status: 503, json: {} });
    await expect(group).toContainText(copy('intakeUnconfirmed'));
    await expect(submit).toBeEnabled();
    state.intakeMode = 'malformed';
    await submit.click();
    await expect.poll(() => state.intakeWrites.length).toBe(beforeDuplicate + 1);
    await expect(group).toContainText(copy('intakeUnconfirmed'));
    await expect(submit).toBeEnabled();
    await expect(page).toHaveURL(/\/consultations$/);
    expect(state.intakeWrites.at(-1)).toEqual(captured);
    state.intakeMode = 'success';
    await submit.click();
    await expect(page).toHaveURL(new RegExp(`/consultations/${createdRequest}$`));
    expect(state.intakeWrites.slice(beforeDuplicate - 1)).toEqual([captured, captured, captured]);
    await expect(page.getByText(copy('noFee'), { exact: true })).toBeVisible();

    await page.goto('/consultations');
    await expect(product).toBeVisible();
    await product.check();
    await confirmation.check();
    state.productsDenied = true;
    await group.getByRole('button', { name: copy('refreshProducts'), exact: true }).click();
    await expect(group).toContainText(copy('productsDenied'));
    await expect(product).toHaveCount(0);
    await expect(group).not.toContainText('Assess your supply.');
    await expect(group).not.toContainText('ارزیابی تأمین انرژی.');
    expect(state.intakeWrites).toHaveLength(beforeDuplicate + 2);
  });

  test(`consultation information preserves raw drafts and requires saved-history recovery (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, detail, persist } = await setupConsultationForms(
      page,
      locale,
      theme === 'dark',
      true
    );
    await page.goto(`/consultations/${informationRequest}`);
    const group = page.getByRole('group', { name: copy('information'), exact: true });
    const form = page.locator('#consultation-information-form');
    const information = page.locator('#consultation-information');
    const submit = group.getByRole('button', { name: copy('provideInfo'), exact: true });
    const reload = page.getByRole('button', { name: copy('informationReload'), exact: true });
    await information.fill('م'.repeat(2001));
    await submit.click();
    await focusedError(information);
    expect(state.replyWrites).toEqual([]);
    await information.fill('م'.repeat(2000));
    await submit.click();
    await focusedError(information);
    expect(state.replyWrites).toEqual([
      { id: informationRequest, path: 'provide-info', body: { reason: 'م'.repeat(2000) } },
    ]);
    await expect(information).toHaveValue('م'.repeat(2000));
    await information.fill('  Captured private information  ');
    state.replyMode = 'unsafe';
    await submit.click();
    await expect.poll(() => state.replyWrites.length).toBe(2);
    await expect(group.getByText(copy('actionError'), { exact: true })).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(group).not.toContainText('PRIVATE_REQUEST_ID');
    await expect(group).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await expect(information).toHaveValue('  Captured private information  ');
    await inspectForm(page, group, `[aria-label="${copy('information')}"]`);
    await group.screenshot({
      path: info.outputPath(`consultation-information-${locale}-${theme}.png`),
    });
    state.replyMode = 'held';
    await submit.click();
    await expect.poll(() => !!state.reply).toBe(true);
    await expect(information).toBeDisabled();
    const captured = {
      id: informationRequest,
      path: 'provide-info',
      body: { reason: 'Captured private information' },
    };
    expect(state.replyWrites.at(-1)).toEqual(captured);
    const beforeDuplicate = state.replyWrites.length;
    await form.dispatchEvent('submit');
    await form.dispatchEvent('submit');
    expect(state.replyWrites).toHaveLength(beforeDuplicate);
    await state.reply!.fulfill({ json: { requestId: unpaidRequest, status: 'under_review' } });
    await expect(page.getByText(copy('informationUnconfirmed'), { exact: true })).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(information).toHaveValue('  Captured private information  ');
    const beforeRecovery = state.detailReads.length;
    await reload.click();
    await expect.poll(() => state.detailReads.length).toBeGreaterThan(beforeRecovery);
    await expect(submit).toBeDisabled();
    expect(state.replyWrites).toHaveLength(beforeDuplicate);
    // An unrelated new history event cannot confirm this captured reply.
    persist(informationRequest, 'under_review', 'Different customer reply', 'customer');
    await reload.click();
    await expect(submit).toBeDisabled();
    await expect(information).toHaveValue('  Captured private information  ');
    persist(informationRequest, 'under_review', captured.body.reason, 'customer');
    await reload.click();
    await expect(information).toHaveCount(0);
    await expect(page.getByText(copy('infoSent'), { exact: true })).toBeVisible();
    expect(state.replyWrites).toHaveLength(beforeDuplicate);

    // The same component changing request must discard an old authorized read.
    state.detailMode = 'held';
    await reload.click();
    await expect.poll(() => !!state.detailRead).toBe(true);
    state.detailMode = 'success';
    persist(unpaidRequest, 'under_review', 'Review resumed', 'staff');
    persist(unpaidRequest, 'awaiting_customer_info', 'Information requested', 'staff');
    await page.goto(`/consultations/${unpaidRequest}`);
    await expect(information).toHaveValue('');
    await information.fill('PRIVATE_NEW_REQUEST_DRAFT');
    await state.detailRead!.fulfill({ json: detail(informationRequest) });
    await expect(information).toHaveValue('PRIVATE_NEW_REQUEST_DRAFT');
    await expect(page.locator('#dashboard-content')).not.toContainText(captured.body.reason);
    state.replyMode = 'success';
    await submit.click();
    await expect(information).toHaveCount(0);
    await expect(page.getByText(copy('infoSent'), { exact: true })).toBeVisible();
    expect(state.replyWrites.at(-1)).toEqual({
      id: unpaidRequest,
      path: 'provide-info',
      body: { reason: 'PRIVATE_NEW_REQUEST_DRAFT' },
    });
    persist(createdRequest, 'under_review', 'Review started', 'staff');
    persist(createdRequest, 'awaiting_customer_info', 'Information requested', 'staff');
    await page.goto(`/consultations/${createdRequest}`);
    await expect(information).toHaveValue('');
    await information.fill('PRIVATE_DENIED_REPLY_DRAFT');
    state.replyMode = 'denied';
    await submit.click();
    await expect(information).toHaveCount(0);
    await expect(page.locator('#dashboard-content')).not.toContainText(
      'PRIVATE_DENIED_REPLY_DRAFT'
    );
    await expect(page.locator('#dashboard-content')).not.toContainText(
      'PRIVATE_EXISTING_REQUEST_CONTEXT'
    );
    expect(state.replyWrites.at(-1)).toEqual({
      id: createdRequest,
      path: 'provide-info',
      body: { reason: 'PRIVATE_DENIED_REPLY_DRAFT' },
    });
  });

  test(`consultation staff reasons preserve intent limits and protected captured actions (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persist, detail } = await setupConsultationForms(page, locale, theme === 'dark');
    await page.goto('/admin/consultations');
    await page.getByRole('button', { name: /Information buyer/ }).click();
    const reason = page.locator('#consultation-reason');
    const form = page.getByRole('form', { name: copy('reasonFormTitle'), exact: true });
    const requestInfo = page.getByRole('button', { name: copy('requestInfo'), exact: true });
    const fee = page.getByLabel(copy('feeIrr'), { exact: true });
    const offerScope = page.getByRole('textbox', { name: copy('scope'), exact: true });
    const deliverables = page.getByRole('textbox', { name: copy('deliverables'), exact: true });
    await fee.fill('700000');
    await offerScope.fill('  Independent fee scope  ');
    await deliverables.fill('  Independent fee deliverables  ');
    await reason.fill('ر'.repeat(2001));
    await requestInfo.click();
    await focusedError(reason);
    expect(state.staffWrites).toEqual([]);
    await reason.fill('ر'.repeat(2000));
    await requestInfo.click();
    let dialog = page.getByRole('dialog', { name: copy('requestInfo'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await focusedError(reason);
    expect(state.staffWrites).toEqual([
      { id: informationRequest, path: 'request-info', body: { reason: 'ر'.repeat(2000) } },
    ]);
    await reason.fill('  Captured information request  ');
    state.staffMode = 'unsafe';
    await requestInfo.click();
    dialog = page.getByRole('dialog', { name: copy('requestInfo'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).not.toContainText('PRIVATE_REVIEW_HASH');
    await expect(dialog).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await closeSettledDialog(dialog, locale);
    await expect(reason).toHaveValue('  Captured information request  ');
    await expect(fee).toHaveValue('700000');
    await expect(offerScope).toHaveValue('  Independent fee scope  ');
    await expect(deliverables).toHaveValue('  Independent fee deliverables  ');
    await inspectForm(page, form, `[aria-label="${copy('reasonFormTitle')}"]`);
    await form.screenshot({
      path: info.outputPath(`consultation-staff-reason-${locale}-${theme}.png`),
    });
    state.staffMode = 'held';
    await requestInfo.click();
    dialog = page.getByRole('dialog', { name: copy('requestInfo'), exact: true });
    await expect(reason).toBeDisabled();
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.staffCommand).toBe(true);
    const captured = {
      id: informationRequest,
      path: 'request-info',
      body: { reason: 'Captured information request' },
    };
    const beforeDuplicate = state.staffWrites.length;
    const readsDuringCommand = state.detailReads.length;
    const refresh = page.getByRole('button', {
      name: copy('refresh'),
      exact: true,
      includeHidden: true,
    });
    await expect(refresh).toBeDisabled();
    await refresh.dispatchEvent('click');
    await page
      .getByRole('form', { name: copy('reasonFormTitle'), exact: true, includeHidden: true })
      .dispatchEvent('submit');
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.staffWrites).toHaveLength(beforeDuplicate);
    expect(state.detailReads).toHaveLength(readsDuringCommand);
    expect(state.staffWrites.at(-1)).toEqual(captured);
    await state.staffCommand!.fulfill({
      json: { requestId: unpaidRequest, status: 'awaiting_customer_info' },
    });
    await expect(
      dialog.getByRole('button', { name: t('team.cancel', locale), exact: true })
    ).toBeEnabled();
    await expect(dialog.locator('button[type=submit]')).toBeDisabled();
    await closeSettledDialog(dialog, locale);
    await expect(page.getByText(copy('actionUnconfirmed'), { exact: true })).toBeVisible();
    await expect(requestInfo).toBeDisabled();
    const recovery = page.getByRole('button', { name: copy('retry'), exact: true });
    await recovery.click();
    await expect(requestInfo).toBeDisabled();
    await expect(reason).toHaveValue('  Captured information request  ');
    await expect(fee).toHaveValue('700000');
    await expect(offerScope).toHaveValue('  Independent fee scope  ');
    await expect(deliverables).toHaveValue('  Independent fee deliverables  ');
    expect(state.staffWrites).toHaveLength(beforeDuplicate);
    persist(informationRequest, 'awaiting_customer_info', captured.body.reason, 'staff');
    await recovery.click();
    await expect(reason).toHaveValue('');
    await expect(page.locator('[data-slot=status-timeline]')).toContainText(captured.body.reason);
    persist(informationRequest, 'under_review', 'Customer information supplied', 'customer');
    await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
    await expect(fee).toHaveValue('700000');
    await expect(offerScope).toHaveValue('  Independent fee scope  ');
    await expect(deliverables).toHaveValue('  Independent fee deliverables  ');
    expect(state.staffWrites).toHaveLength(beforeDuplicate);

    await page.getByRole('button', { name: /Paid buyer/ }).click();
    await reason.fill('پ'.repeat(1001));
    const cancelRequest = page.getByRole('button', { name: copy('cancel'), exact: true });
    await cancelRequest.click();
    await focusedError(reason);
    expect(state.paidPreviews).toEqual([]);
    await reason.fill('پ'.repeat(1000));
    await cancelRequest.click();
    dialog = page.getByRole('dialog', { name: copy('cancel'), exact: true });
    await expect(dialog).toContainText(copy('paidResolutionReviewTitle'));
    expect(state.paidPreviews).toEqual([{ action: 'cancel', reason: 'پ'.repeat(1000) }]);
    await closeSettledDialog(dialog, locale);
    await expect(reason).toHaveValue('پ'.repeat(1000));

    await page.getByRole('button', { name: /Unpaid buyer/ }).click();
    await reason.fill('  Captured unpaid cancellation  ');
    state.staffMode = 'success';
    await cancelRequest.click();
    dialog = page.getByRole('dialog', { name: copy('cancel'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await dialog.locator('input[type=password]').fill('synthetic-password');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.stepUp).toBe(true);
    await expect(dialog.locator('button[type=submit]')).toBeDisabled();
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.verifications).toBe(1);
    const unpaidCapture = {
      id: unpaidRequest,
      path: 'cancel',
      body: { reason: 'Captured unpaid cancellation' },
    };
    expect(state.staffWrites.at(-1)).toEqual(unpaidCapture);
    state.verified = true;
    await state.stepUp!.fulfill({ json: { verified: true } });
    await expect(dialog).toHaveCount(0);
    expect(state.staffWrites.slice(-2)).toEqual([unpaidCapture, unpaidCapture]);
    await expect(reason).toHaveValue('');

    // A late detail read cannot replace the newly selected request's draft.
    state.detailMode = 'held';
    await page.getByRole('button', { name: /Information buyer/ }).click();
    await expect.poll(() => !!state.detailRead).toBe(true);
    state.detailMode = 'success';
    await page.getByRole('button', { name: /Paid buyer/ }).click();
    await reason.fill('PRIVATE_STAFF_NEW_SCOPE_DRAFT');
    await state.detailRead!.fulfill({ json: detail(informationRequest) });
    await expect(reason).toHaveValue('PRIVATE_STAFF_NEW_SCOPE_DRAFT');
    await expect(
      page.getByRole('region', { name: copy('details'), exact: true })
    ).not.toContainText(captured.body.reason);
    state.staffMode = 'denied';
    // Complete uses the same nonfinancial field and receipt while preserving paid-close intent.
    const complete = page.getByRole('button', { name: copy('complete'), exact: true });
    await complete.click();
    dialog = page.getByRole('dialog', { name: copy('complete'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(reason).toHaveCount(0);
    await expect(page.locator('#admin-content')).not.toContainText('PRIVATE_STAFF_NEW_SCOPE_DRAFT');
    await expect(page.locator('#admin-content')).not.toContainText(
      'PRIVATE_EXISTING_REQUEST_CONTEXT'
    );
  });
}

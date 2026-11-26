import { productionManifest } from './production-manifest';
import { approveRiskConfirmation } from './confirmation-fixture';
import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { checkpointBrowserCoverage, test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { tStaffConsultation } from '@barghsa/i18n/consultation-staff';
import { tConsultationBrief } from '@barghsa/i18n/consultation-intake';
import { checkRoutePresentation } from './route-presentation';
import { scanCriticalMain } from './critical-accessibility';
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
const alternateProduct = {
  id: '73000000-0000-4000-8000-000000000099',
  systemKey: null,
  title: { en: 'Installation consultation', fa: 'مشاوره نصب' },
  description: { en: 'Plan a new installation.', fa: 'برنامه‌ریزی برای نصب جدید.' },
};
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
  const copy = (key: string) => tStaffConsultation(key, locale);
  const briefCopy = (key: Parameters<typeof tConsultationBrief>[0]) =>
    tConsultationBrief(key, locale);
  test(
    `consultation product intake is accessible (${locale}, ${theme})`,
    { tag: '@a11y-critical' },
    async ({ page }) => {
      const { state } = await setupConsultationForms(page, locale, theme === 'dark', true);
      await page.goto('/consultations/new');
      await expect(
        page.getByRole('radiogroup', { name: copy('available'), exact: true })
      ).toBeVisible();
      const product = page.locator(`#consultation-product-${consultationProduct}`);
      await expect(product).toBeChecked();
      await expect(product).toHaveAccessibleDescription(briefCopy('singleService'));
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await scanCriticalMain(page);
      const brief = page.getByRole('textbox', { name: briefCopy('label') });
      await expect(brief).toHaveAccessibleDescription(briefCopy('help'));
      await expect(brief).toHaveAttribute('placeholder', briefCopy('example'));
      await page.getByRole('checkbox', { name: copy('confirm'), exact: true }).check();
      const submit = page
        .getByRole('group', { name: copy('intakeForm'), exact: true })
        .locator('button[type=submit]');
      await expect(submit).toBeEnabled();
      await expect(submit).toBeInViewport({ ratio: 1 });
      await scanCriticalMain(page);
      expect(state.intakeWrites).toEqual([]);
    }
  );

  test(`consultation catalogue changes preserve the unsent brief (${locale}, ${theme})`, async ({
    page,
  }) => {
    const { state } = await setupConsultationForms(page, locale, theme === 'dark', true);
    await page.goto('/consultations/new');
    const product = page.locator(`#consultation-product-${consultationProduct}`);
    const replacement = page.locator(`#consultation-product-${alternateProduct.id}`);
    const brief = page.getByRole('textbox', { name: briefCopy('label') });
    const confirm = page.getByRole('checkbox', { name: copy('confirm'), exact: true });
    const message = page.getByText(briefCopy('serviceRemoved'), { exact: true });
    await expect(product).toBeChecked();
    const description =
      locale === 'fa' ? 'کم کردن مصرف برق کارگاه' : 'Reduce workshop electricity use';
    await brief.fill(description);
    await confirm.check();
    state.products = [alternateProduct];
    await page.getByRole('button', { name: copy('refreshProducts'), exact: true }).click();
    await expect(product).toHaveCount(0);
    await expect(replacement).not.toBeChecked();
    await expect(message).toBeVisible();
    await expect(replacement).toHaveAccessibleDescription(
      `${copy('productHelp')} ${briefCopy('serviceRemoved')}`
    );
    await expect(brief).toHaveValue(description);
    await expect(confirm).not.toBeChecked();
    await replacement.check();
    await expect(message).toHaveCount(0);
    expect(state.intakeWrites).toEqual([]);
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(description);
  });

  test(`consultation intake validates lazily and retries the same captured submission (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state } = await setupConsultationForms(page, locale, theme === 'dark', true);
    state.products.push(alternateProduct);
    const manifest = await productionManifest();
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
    await page.goto('/consultations/new');
    const group = page.getByRole('group', { name: copy('intakeForm'), exact: true });
    const form = group.locator('form');
    const product = page.locator(`#consultation-product-${consultationProduct}`);
    const productGroup = page.getByRole('radiogroup', { name: copy('available'), exact: true });
    const confirmation = page.locator('#consultation-confirmation');
    const submit = group.locator('button[type=submit]');
    const description = group.getByRole('textbox', { name: briefCopy('label') });
    const brief =
      locale === 'fa'
        ? 'ظرفیت مناسب تولید برای سایت من چقدر است؟'
        : 'Can you advise on generation capacity for my site?';
    const errorToast = (message: string) =>
      page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: message }).last();
    await expect(productGroup).toHaveAttribute('aria-required', 'true');
    await expect(product).toHaveAccessibleDescription(copy('productHelp'));
    await expect(product).toHaveAttribute('aria-describedby', 'consultation-product-description');
    await expect(confirmation).toHaveAttribute('aria-required', 'true');
    await submit.click();
    await expect(submit).toBeDisabled();
    await form.dispatchEvent('submit');
    await form.dispatchEvent('submit');
    expect(state.intakeWrites).toEqual([]);
    release();
    await focusedError(product, productGroup);
    await expect(product).toHaveAccessibleDescription(
      `${copy('productHelp')} ${copy('productInvalid')}`
    );
    await product.check();
    await submit.click();
    await focusedError(confirmation);
    await expect(confirmation).toHaveAccessibleDescription(
      `${copy('confirmationHelp')} ${copy('confirmationInvalid')}`
    );
    expect(state.intakeWrites).toEqual([]);
    await confirmation.check();
    await submit.click();
    await focusedError(product, productGroup);
    await expect(errorToast(copy('submitError'))).toBeVisible();
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
    await expect(errorToast(copy('submitError'))).toBeVisible();
    await expect(page.locator('[data-sonner-toaster]')).not.toContainText(
      'PRIVATE_SERVER_VALIDATION_TEXT'
    );
    await expect(submit).toBeEnabled();
    await expect(group).not.toContainText('submissionKey');
    await expect(group).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await expect(product).toBeChecked();
    await expect(confirmation).toBeChecked();
    await inspectForm(page, group, `[aria-label="${copy('intakeForm')}"]`);
    await group.screenshot({ path: info.outputPath(`consultation-intake-${locale}-${theme}.png`) });

    state.intakeMode = 'held';
    await description.fill(brief);
    await submit.click();
    await expect.poll(() => !!state.intake).toBe(true);
    const captured = state.intakeWrites.at(-1)!;
    expect(captured.brief).toBe(brief);
    await expect(product).toBeDisabled();
    await expect(confirmation).toBeDisabled();
    await expect(description).toBeDisabled();
    const beforeDuplicate = state.intakeWrites.length;
    await form.dispatchEvent('submit');
    await form.dispatchEvent('submit');
    expect(state.intakeWrites).toHaveLength(beforeDuplicate);
    state.created = true;
    await state.intake!.fulfill({ status: 503, json: {} });
    await expect(group).toContainText(copy('intakeUnconfirmed'));
    await expect(errorToast(copy('intakeUnconfirmed'))).toBeVisible();
    await expect(errorToast(copy('submitError'))).toHaveCount(0);
    await expect(submit).toBeEnabled();
    state.intakeMode = 'malformed';
    await submit.click();
    await expect.poll(() => state.intakeWrites.length).toBe(beforeDuplicate + 1);
    await expect(group).toContainText(copy('intakeUnconfirmed'));
    await expect(submit).toBeEnabled();
    await expect(page).toHaveURL(/\/consultations\/new$/);
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    expect(state.intakeWrites.at(-1)).toEqual(captured);
    state.intakeMode = 'success';
    state.histories[createdRequest]![0]!.reason = brief;
    let receiptReads = 0;
    await page.route('**/api/consultations/requests/submissions/*?*', async (route) => {
      receiptReads++;
      const url = new URL(route.request().url());
      expect(route.request().method()).toBe('GET');
      expect(url.pathname.endsWith(captured.submissionKey)).toBe(true);
      expect(url.searchParams.get('profileId')).toBe(captured.profileId);
      expect(url.searchParams.get('productId')).toBe(captured.productId);
      expect(route.request().postData()).toBeNull();
      await route.fulfill({
        json: { receipt: { requestId: createdRequest, status: 'submitted' } },
      });
    });
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(brief);
    await page.reload();
    await expect(group).toContainText(briefCopy('checkHelp'));
    await expect(submit).toHaveAccessibleName(briefCopy('check'));
    await expect(description).toHaveCount(0);
    await expect(product).toBeDisabled();
    await expect(confirmation).toBeDisabled();
    await submit.click();
    await expect(page).toHaveURL(new RegExp(`/consultations/${createdRequest}$`));
    await expect(errorToast(copy('intakeUnconfirmed'))).toHaveCount(0);
    await expect(
      page.locator('[data-sonner-toast][data-type="success"]').filter({
        hasText: confirmationText('recorded', locale),
      })
    ).toBeVisible();
    expect(state.intakeWrites.slice(beforeDuplicate - 1)).toEqual([captured, captured]);
    expect(receiptReads).toBe(1);
    await expect(page.getByRole('region', { name: briefCopy('submittedBrief') })).toContainText(
      brief
    );
    await expect(page.getByText(copy('noFee'), { exact: true })).toBeVisible();

    await page.goto('/consultations/new');
    await expect(product).toBeVisible();
    await product.check();
    await confirmation.check();
    state.productsDenied = true;
    await group.getByRole('button', { name: copy('refreshProducts'), exact: true }).click();
    await expect(group).toContainText(copy('productsDenied'));
    await expect(product).toHaveCount(0);
    await expect(group).not.toContainText('Assess your supply.');
    await expect(group).not.toContainText('ارزیابی تأمین انرژی.');
    expect(state.intakeWrites).toHaveLength(beforeDuplicate + 1);
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
    await expect(form).toHaveCount(0);
    const entry = page.getByRole('link', { name: copy('replyTitle'), exact: true });
    await expect(entry).toHaveAttribute('href', `/consultations/${informationRequest}/reply`);
    await entry.click();
    await expect(page).toHaveURL(`/consultations/${informationRequest}/reply`);
    const information = page.locator('#consultation-information');
    const submit = group.getByRole('button', { name: copy('provideInfo'), exact: true });
    const reload = page.getByRole('button', { name: copy('informationReload'), exact: true });
    const back = page.getByRole('link', { name: copy('replyBack'), exact: true });
    await expect(
      group.getByRole('heading', { name: copy('informationRequested'), exact: true })
    ).toBeVisible();
    await expect(group).toContainText('PRIVATE_EXISTING_REQUEST_CONTEXT');
    await expect(information).toHaveAttribute('aria-required', 'true');
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
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ ...viewport, width: 320 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await expect(information).toBeVisible();
    await expect(submit).toBeVisible();
    await page.setViewportSize(viewport);
    await checkRoutePresentation(page, info, locale);
    await expect(information).toHaveValue('  Captured private information  ');
    await group.screenshot({
      path: info.outputPath(`consultation-information-${locale}-${theme}.png`),
    });
    state.replyMode = 'held';
    await submit.click();
    await expect.poll(() => !!state.reply).toBe(true);
    await expect(information).toBeDisabled();
    await expect(back).toHaveAttribute('aria-disabled', 'true');
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
    await expect(back).toBeEnabled();
    expect(state.replyWrites).toHaveLength(beforeDuplicate);

    // The same component changing request must discard an old authorized read.
    state.detailMode = 'held';
    await reload.click();
    await expect.poll(() => !!state.detailRead).toBe(true);
    state.detailMode = 'success';
    persist(unpaidRequest, 'under_review', 'Review resumed', 'staff');
    persist(unpaidRequest, 'awaiting_customer_info', 'Information requested', 'staff');
    await checkpointBrowserCoverage(page);
    await page.goto(`/consultations/${unpaidRequest}/reply`);
    await expect(information).toHaveValue('');
    await information.fill('PRIVATE_NEW_REQUEST_DRAFT');
    await state.detailRead!.fulfill({ json: detail(informationRequest) });
    await expect(information).toHaveValue('PRIVATE_NEW_REQUEST_DRAFT');
    await expect(page.locator('main[data-area=dashboard]')).not.toContainText(captured.body.reason);
    state.replyMode = 'success';
    await submit.click();
    await expect(information).toHaveCount(0);
    await expect(page.getByText(copy('infoSent'), { exact: true })).toBeVisible();
    expect(state.replyWrites.at(-1)).toEqual({
      id: unpaidRequest,
      path: 'provide-info',
      body: { reason: 'PRIVATE_NEW_REQUEST_DRAFT' },
    });
    await checkpointBrowserCoverage(page);
    await page.goto(`/consultations/${unpaidRequest}/reply`);
    await expect(page.getByText(copy('replyUnavailable'), { exact: true })).toBeVisible();
    await expect(form).toHaveCount(0);
    persist(createdRequest, 'under_review', 'Review started', 'staff');
    persist(createdRequest, 'awaiting_customer_info', 'Information requested', 'staff');
    await checkpointBrowserCoverage(page);
    await page.goto(`/consultations/${createdRequest}/reply`);
    await expect(information).toHaveValue('');
    await information.fill('PRIVATE_DENIED_REPLY_DRAFT');
    state.replyMode = 'denied';
    await submit.click();
    await expect(information).toHaveCount(0);
    await expect(page.locator('main[data-area=dashboard]')).not.toContainText(
      'PRIVATE_DENIED_REPLY_DRAFT'
    );
    await expect(page.locator('main[data-area=dashboard]')).not.toContainText(
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
    await page.getByRole('link', { name: /Information buyer/ }).click();
    const backToRequest = page.getByRole('link', { name: copy('backToFeeRequest'), exact: true });
    const openDecision = (decision: string) =>
      page.locator(`a[href*="/decisions/${decision}"]`).click();
    const openFee = () => page.locator('a[href$="/fee"]').click();
    const reason = page.locator('#consultation-reason');
    const form = page.getByRole('form', { name: copy('reasonFormTitle'), exact: true });
    const requestInfo = page.getByRole('button', { name: copy('requestInfo'), exact: true });
    const fee = page.getByLabel(copy('feeIrr'), { exact: true });
    const offerScope = page.getByRole('textbox', { name: copy('scope'), exact: true });
    const deliverables = page.getByRole('textbox', { name: copy('deliverables'), exact: true });
    await openFee();
    await fee.fill('700000');
    await offerScope.fill('  Independent fee scope  ');
    await deliverables.fill('  Independent fee deliverables  ');
    await backToRequest.click();
    await openDecision('request-info');
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
    await backToRequest.click();
    await openFee();
    await expect(fee).toHaveValue('700000');
    await expect(offerScope).toHaveValue('  Independent fee scope  ');
    await expect(deliverables).toHaveValue('  Independent fee deliverables  ');
    await backToRequest.click();
    await openDecision('request-info');
    await expect(reason).toHaveValue('  Captured information request  ');
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
    await expect(backToRequest).toBeEnabled();
    expect(state.staffWrites).toHaveLength(beforeDuplicate);
    persist(informationRequest, 'awaiting_customer_info', captured.body.reason, 'staff');
    await recovery.click();
    await expect(form).toHaveCount(0);
    await backToRequest.click();
    await expect(page.locator('[data-slot=status-timeline]')).toContainText(captured.body.reason);
    persist(informationRequest, 'under_review', 'Customer information supplied', 'customer');
    await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
    await openDecision('request-info');
    await expect(reason).toHaveValue('');
    await backToRequest.click();
    await openFee();
    await expect(fee).toHaveValue('700000');
    await expect(offerScope).toHaveValue('  Independent fee scope  ');
    await expect(deliverables).toHaveValue('  Independent fee deliverables  ');
    await backToRequest.click();
    expect(state.staffWrites).toHaveLength(beforeDuplicate);

    await page.getByRole('link', { name: copy('backToStaffRequests'), exact: true }).click();
    await page.getByRole('link', { name: /Paid buyer/ }).click();
    await openDecision('cancel');
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
    await backToRequest.click();
    await openDecision('reject');
    await expect(reason).toHaveValue('');
    await reason.fill('A separate rejection draft');
    await backToRequest.click();
    await openDecision('cancel');
    await expect(reason).toHaveValue('پ'.repeat(1000));
    await backToRequest.click();

    await page.getByRole('link', { name: copy('backToStaffRequests'), exact: true }).click();
    await page.getByRole('link', { name: /Unpaid buyer/ }).click();
    await openDecision('cancel');
    await reason.fill('  Captured unpaid cancellation  ');
    state.staffMode = 'success';
    await cancelRequest.click();
    dialog = page.getByRole('dialog', { name: copy('cancel'), exact: true });
    await approveRiskConfirmation(page, locale, 'destructive');
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
    await expect(form).toHaveCount(0);
    await backToRequest.click();

    // A late detail read cannot replace the newly selected request's draft.
    state.detailMode = 'held';
    await page.getByRole('link', { name: copy('backToStaffRequests'), exact: true }).click();
    await page.getByRole('link', { name: /Information buyer/ }).click();
    await expect.poll(() => !!state.detailRead).toBe(true);
    state.detailMode = 'success';
    await page.getByRole('link', { name: copy('backToStaffRequests'), exact: true }).click();
    await page.getByRole('link', { name: /Paid buyer/ }).click();
    await openDecision('complete');
    await reason.fill('PRIVATE_STAFF_NEW_SCOPE_DRAFT');
    await state.detailRead!.fulfill({ json: detail(informationRequest) });
    await expect(reason).toHaveValue('PRIVATE_STAFF_NEW_SCOPE_DRAFT');
    await expect(
      page.getByRole('region', { name: copy('complete'), exact: true })
    ).not.toContainText(captured.body.reason);
    state.staffMode = 'denied';
    // Complete uses the same nonfinancial field and receipt while preserving paid-close intent.
    const complete = page.getByRole('button', { name: copy('complete'), exact: true });
    await complete.click();
    dialog = page.getByRole('dialog', { name: copy('complete'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(reason).toHaveCount(0);
    await expect(page.locator('main[data-area=admin]')).not.toContainText(
      'PRIVATE_STAFF_NEW_SCOPE_DRAFT'
    );
    await expect(page.locator('main[data-area=admin]')).not.toContainText(
      'PRIVATE_EXISTING_REQUEST_CONTEXT'
    );
  });
}

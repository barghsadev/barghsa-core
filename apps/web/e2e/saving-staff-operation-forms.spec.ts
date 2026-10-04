import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingStaffReview } from '@barghsa/i18n/saving-staff-review';
import { tSavingOperations } from '@barghsa/i18n/saving-operations';
import { ErrorCodes } from '@barghsa/shared/errors';
import { test, expect } from './coverage-fixture';
import {
  setupSavingStaffOperations,
  savingChangeOrder,
  otherSavingChangeOrder,
  operationDecisionReview,
  operationStageReview,
  refundId,
} from './saving-staff-operation-form-fixture';
const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-description.*-message/);
}
async function inspect(page: Page, region: Locator, selector: string, hover: Locator) {
  const focused = await page.evaluate(() => document.activeElement?.id);
  await hover.hover();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(focused);
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await region.locator('input,select,textarea,button').all()) {
    const box = await control.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
async function capture(region: Locator, path: string) {
  await region.scrollIntoViewIfNeeded();
  await region.evaluate((node) => window.scrollBy(0, node.getBoundingClientRect().top - 200));
  await region.screenshot({ path });
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
    '**/' + manifest['src/lib/saving-staff-operation-form-schemas.ts'].file,
    async (route) => {
      await held;
      await route.continue();
    }
  );
  return release;
}
for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  const formCopy = (key: string) => tSavingOperations(key, locale);
  const form = (page: Page) => page.getByTestId('saving-staff-operation-form');
  const retry = (page: Page) => page.getByTestId('saving-staff-operation-retry');
  const confirm = (page: Page) => page.getByRole('dialog').locator('button[type=submit]');
  const cancel = (page: Page) =>
    page.getByRole('dialog').getByRole('button', { name: t('team.cancel', locale), exact: true });
  const refresh = (page: Page) =>
    page.getByRole('button', { name: copy('staffRefresh'), exact: true }).first();
  const action = (page: Page, key: string) =>
    form(page).getByRole('button', { name: copy(key), exact: true });
  test(`saving staff decisions retain unused drafts and exact refund receipts (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persistDecision } = await setupSavingStaffOperations(page, locale, 'decision');
    const release = await holdSchema(page);
    await page.goto(`/admin/saving-orders?lane=review&orderId=${savingChangeOrder}`);
    const note = page.locator('#saving-staff-note');
    await expect(note).toBeVisible();
    await expect(note).not.toHaveAttribute('aria-invalid', 'true');
    await action(page, 'staffReject').click();
    await expect(action(page, 'staffReject')).toBeDisabled();
    await form(page).locator('form').dispatchEvent('submit');
    expect(state.decisionPreviews).toEqual([]);
    release();
    await focusedError(note);
    const unused = 'x'.repeat(1001);
    await note.fill(unused);
    await action(page, 'staffReject').click();
    await focusedError(note);
    expect(state.decisionPreviews).toEqual([]);
    state.decisionMode = 'foreign';
    await action(page, 'staffApprove').click();
    await expect(form(page).getByRole('alert')).toContainText(copy('staffReviewError'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.decisionPreviews[0]!.body).toEqual({ action: 'approve', reason: '' });
    await expect(note).toHaveValue(unused);
    await inspect(
      page,
      form(page),
      '[data-testid="saving-staff-operation-form"]',
      action(page, 'staffApprove')
    );
    await capture(
      note.locator('..'),
      info.outputPath(`saving-decision-unused-draft-${locale}-${theme}.png`)
    );
    state.decisionMode = 'success';
    await action(page, 'staffApprove').click();
    await expect(page.getByRole('dialog')).toContainText(
      copy('staffReviewOutcome.publish_contract')
    );
    await inspect(page, page.getByRole('dialog'), '[role="dialog"]', confirm(page));
    state.decisionWriteMode = 'held';
    state.needsStepUp = true;
    await confirm(page).click();
    const password = page
      .getByRole('dialog')
      .getByLabel(t('team.password', locale), { exact: true });
    await expect(password).toBeVisible();
    await password.fill('Saving-form-proof-42!');
    await confirm(page).click();
    await expect.poll(() => !!state.heldWrite).toBe(true);
    expect(state.stepUp.requests).toEqual([{ password: 'Saving-form-proof-42!' }]);
    const approval = state.decisionWrites.at(-1)!;
    expect(approval.body).toEqual({
      expectedVersionId: state.details.get(savingChangeOrder)!.versionId,
      expectedReviewHash: operationDecisionReview(state.details.get(savingChangeOrder)!, {
        action: 'approve',
        reason: '',
      }).hash,
      idempotencyKey: expect.stringMatching(keyPattern),
    });
    await page.getByRole('dialog').locator('form').dispatchEvent('submit');
    expect(state.decisionWrites).toHaveLength(2);
    const receipt = persistDecision(approval);
    expect(receipt).toEqual({
      savingOrderId: savingChangeOrder,
      status: 'approved',
      refundId: null,
    });
    // Approval must reject even a valid UUID refund on an otherwise complete receipt.
    await state.heldWrite!.fulfill({ json: { ...receipt, refundId } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(retry(page)).toHaveText(formCopy('retryCaptured'));
    await expect(note).toBeDisabled();
    const reads = state.reads.length;
    await form(page).locator('form').dispatchEvent('submit');
    await refresh(page).dispatchEvent('click');
    expect(state.reads).toHaveLength(reads);
    expect(state.decisionWrites).toHaveLength(2);
    state.decisionWriteMode = 'rejected';
    await retry(page).click();
    await confirm(page).click();
    await cancel(page).click();
    await expect(retry(page)).toBeEnabled();
    await expect(note).toHaveValue(unused);
    state.decisionWriteMode = 'success';
    await retry(page).click();
    await confirm(page).click();
    await expect(retry(page)).toHaveCount(0);
    await expect(note).toHaveValue(unused);
    expect(state.decisionWrites.map((call) => call.raw)).toEqual(Array(4).fill(approval.raw));
    expect(state.decisionWrites.slice(1).map((call) => call.csrf)).toEqual(
      Array(3).fill('rotated-saving-password-proof')
    );
    await page.getByRole('button', { name: /Other Change Buyer/ }).click();
    await expect(note).toHaveValue('');
    await note.fill('  Customer declined the saving order  ');
    state.decisionMode = 'owned';
    state.ownedFields = ['reason'];
    await action(page, 'staffReject').click();
    await focusedError(note);
    await expect(note).toHaveValue('  Customer declined the saving order  ');
    await expect(form(page)).not.toContainText('PRIVATE_OPERATION_SERVER_TEXT');
    await inspect(
      page,
      form(page),
      '[data-testid="saving-staff-operation-form"]',
      action(page, 'staffReject')
    );
    await capture(
      note.locator('..'),
      info.outputPath(`saving-rejection-fields-${locale}-${theme}.png`)
    );
    state.decisionMode = 'malformed';
    await action(page, 'staffReject').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(form(page).getByRole('alert')).toContainText(copy('staffReviewError'));
    state.decisionMode = 'success';
    await action(page, 'staffReject').click();
    await expect(page.getByRole('dialog')).toContainText(
      copy(`staffReviewOutcome.${locale === 'en' ? 'refund_obligation' : 'cancel_invoice'}`)
    );
    state.decisionWriteMode = 'held';
    state.heldWrite = undefined;
    await confirm(page).click();
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const rejection = state.decisionWrites.at(-1)!;
    expect(rejection.body.reason).toBe('Customer declined the saving order');
    expect(rejection.body.expectedVersionId).toBe(
      state.details.get(otherSavingChangeOrder)!.versionId
    );
    const rejected = persistDecision(rejection);
    expect(rejected).toEqual({
      savingOrderId: otherSavingChangeOrder,
      status: 'rejected',
      refundId: locale === 'en' ? refundId : null,
    });
    await state.heldWrite!.fulfill({
      json: { ...rejected, refundId: locale === 'en' ? null : refundId },
    });
    await expect(retry(page)).toBeVisible();
    await expect(note).toBeDisabled();
    state.decisionWriteMode = 'success';
    await retry(page).click();
    await confirm(page).click();
    await expect(retry(page)).toHaveCount(0);
    await expect(note).toHaveValue('');
    expect(
      state.decisionWrites.filter((call) => call.action === 'reject').map((call) => call.raw)
    ).toEqual([rejection.raw, rejection.raw]);
  });
  test(`saving stage handover retains exact optional intent and source privacy (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persistStage } = await setupSavingStaffOperations(page, locale, 'stage');
    const release = await holdSchema(page);
    await page.goto(`/admin/saving-orders?lane=fulfillment&orderId=${savingChangeOrder}`);
    const note = page.locator('#saving-staff-note'),
      handover = page.locator('#saving-handover');
    const intent = locale === 'en' ? 'complete' : 'skip';
    const submit = () => action(page, intent === 'complete' ? 'staffComplete' : 'staffSkip');
    await expect(handover).toBeVisible();
    await submit().click();
    await expect(submit()).toBeDisabled();
    await form(page).locator('form').dispatchEvent('submit');
    expect(state.stagePreviews).toEqual([]);
    release();
    await focusedError(note);
    await note.fill('x'.repeat(1001));
    await submit().click();
    await focusedError(note);
    await note.fill('  Delivery handover recorded  ');
    if (intent === 'complete') {
      await submit().click();
      await focusedError(handover);
      await handover.fill('x'.repeat(1001));
      await submit().click();
      await focusedError(handover);
      await handover.fill('  Meter and accessories received  ');
    }
    expect(state.stagePreviews).toEqual([]);
    state.stageMode = 'owned';
    state.ownedFields = intent === 'complete' ? ['handoverDescription'] : ['explanation'];
    await submit().click();
    await focusedError(intent === 'complete' ? handover : note);
    await expect(note).toHaveValue('  Delivery handover recorded  ');
    await expect(handover).toHaveValue(
      intent === 'complete' ? '  Meter and accessories received  ' : ''
    );
    expect(state.stagePreviews[0]!.body).toEqual({
      expectedStatus: 'in_progress',
      explanation: 'Delivery handover recorded',
      ...(intent === 'complete' ? { handoverDescription: 'Meter and accessories received' } : {}),
    });
    await inspect(page, form(page), '[data-testid="saving-staff-operation-form"]', submit());
    await capture(
      (intent === 'complete' ? handover : note).locator('..'),
      info.outputPath(`saving-handover-fields-${locale}-${theme}.png`)
    );
    state.stageMode = 'foreign';
    await submit().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(form(page).getByRole('alert')).toContainText(copy('staffReviewError'));
    state.stageMode = 'success';
    await submit().click();
    await expect(page.getByRole('dialog')).toContainText(copy('staffStageReviewTitle'));
    await inspect(page, page.getByRole('dialog'), '[role="dialog"]', confirm(page));
    state.stageWriteMode = 'held';
    await confirm(page).click();
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const captured = state.stageWrites.at(-1)!;
    expect(captured.body).toEqual({
      ...state.stagePreviews.at(-1)!.body,
      expectedReviewHash: operationStageReview(
        state.details.get(savingChangeOrder)!,
        'equipment_handover',
        intent,
        state.stagePreviews.at(-1)!.body
      ).hash,
      idempotencyKey: expect.stringMatching(keyPattern),
    });
    await page.getByRole('dialog').locator('form').dispatchEvent('submit');
    expect(state.stageWrites).toHaveLength(1);
    const receipt = persistStage(captured);
    expect(receipt).toEqual({
      savingOrderId: savingChangeOrder,
      status: 'in_progress',
      stage: 'equipment_handover',
      stageStatus: intent === 'complete' ? 'completed' : 'skipped',
      nextStage: 'process_completion',
    });
    // The command committed, but its response was lost. GET state cannot unlock the captured action.
    await state.heldWrite!.fulfill({ status: 503, json: {} });
    await expect(retry(page)).toBeVisible();
    await expect(note).toBeDisabled();
    await expect(handover).toBeDisabled();
    const reads = state.reads.length;
    await refresh(page).dispatchEvent('click');
    await form(page).locator('form').dispatchEvent('submit');
    expect(state.reads).toHaveLength(reads);
    expect(state.stageWrites).toHaveLength(1);
    state.stageWriteMode = 'malformed';
    await retry(page).click();
    await confirm(page).click();
    await expect(retry(page)).toBeVisible();
    state.stageWriteMode = 'rejected';
    await retry(page).click();
    await confirm(page).click();
    await cancel(page).click();
    await expect(retry(page)).toBeEnabled();
    await expect(note).toHaveValue('  Delivery handover recorded  ');
    state.stageWriteMode = 'success';
    await retry(page).click();
    await confirm(page).click();
    await expect(retry(page)).toHaveCount(0);
    await expect(note).toHaveValue('');
    await expect(handover).toHaveCount(0);
    expect(state.stageWrites.map((call) => call.raw)).toEqual(Array(4).fill(captured.raw));
    const history = page.getByRole('region', { name: copy('staffHistory'), exact: true });
    await expect(history).toContainText('Delivery handover recorded');
    if (intent === 'complete')
      await expect(history).toContainText('Meter and accessories received');
    else await expect(history).toContainText(copy('skipped'));
    await capture(history, info.outputPath(`saving-handover-history-${locale}-${theme}.png`));
    await note.fill('  Old current-stage private explanation  ');
    state.stageMode = 'held';
    state.heldPreview = undefined;
    await action(page, 'staffComplete').click();
    await expect.poll(() => !!state.heldPreview).toBe(true);
    const old = state.heldPreview;
    await page.evaluate((id) => {
      const url = new URL(location.href);
      url.searchParams.set('orderId', id);
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, otherSavingChangeOrder);
    await expect(form(page)).toBeVisible();
    await expect(note).toHaveValue('');
    await old!
      .fulfill({
        status: 403,
        json: {
          error: {
            code: ErrorCodes.AUTHZ_FORBIDDEN.code,
            correlationId: savingChangeOrder,
            message: 'OLD_PRIVATE_ERROR',
          },
        },
      })
      .catch(() => {});
    await expect(note).toBeVisible();
    await expect(form(page)).not.toContainText('OLD_PRIVATE_ERROR');
    await note.fill('  Fresh product delivery explanation  ');
    await page.locator('#saving-amend-reason').fill('  Independent address draft  ');
    await page.locator('#saving-amend-hardware-reason').fill('  Independent hardware draft  ');
    state.stageMode = 'success';
    await action(page, 'staffComplete').click();
    await expect(page.getByRole('dialog')).toContainText('Other Change Buyer');
    await expect(
      page.locator('[data-testid="saving-staff-address-form"] button[type=submit]')
    ).toBeDisabled();
    await expect(
      page.locator('[data-testid="saving-staff-hardware-form"] button[type=submit]')
    ).toBeDisabled();
    await cancel(page).click();
    await expect(page.locator('#saving-amend-reason')).toHaveValue('  Independent address draft  ');
    await expect(page.locator('#saving-amend-hardware-reason')).toHaveValue(
      '  Independent hardware draft  '
    );
    state.stageMode = locale === 'en' ? 'missing' : 'denied';
    await action(page, 'staffComplete').click();
    await expect(note).toHaveCount(0);
    await expect(page.locator('#saving-amend-reason')).toHaveCount(0);
    await expect(page.locator('#saving-amend-hardware-reason')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

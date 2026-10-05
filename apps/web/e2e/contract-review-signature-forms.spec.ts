import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n/app';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractReviewSignature } from '@barghsa/i18n/contract-review-signature';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { test, expect } from './coverage-fixture';
import {
  setupContractReviewSignatures,
  contractId,
  otherContract,
  reviewVersion,
  acceptedVersion,
  amendmentVersion,
  originalDocument,
  signedDocument,
  amendmentDocument,
  amendmentSignedDocument,
  jsonbOrder,
} from './contract-review-signature-form-fixture';

const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-message/);
}
async function inspect(page: Page, region: Locator, selector: string, button: Locator) {
  const focused = await page.evaluate(() => document.activeElement?.id);
  await button.hover();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(focused);
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await region.locator('input,textarea,select,button').all()) {
    const box = await control.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
async function fieldCapture(field: Locator, path: string) {
  const region = field.locator('..');
  await region.scrollIntoViewIfNeeded();
  await region.evaluate((node) => window.scrollBy(0, node.getBoundingClientRect().top - 180));
  await region.screenshot({ path });
}
async function outcomeCapture(page: Page, region: Locator, path: string) {
  const total = region.locator(':scope > dl').last(),
    notice = region.locator(':scope > div').last();
  await notice.scrollIntoViewIfNeeded();
  const a = await total.boundingBox(),
    b = await notice.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  await page.screenshot({
    path,
    clip: { x: b!.x, y: a!.y, width: b!.width, height: b!.y + b!.height - a!.y },
  });
}
async function holdSchema(page: Page) {
  const manifest = JSON.parse(
    await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    '**/' + manifest['src/lib/contract-review-signature-form-schemas.ts'].file,
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
  const word = (key: string) => contractText(key, locale);
  const copy = (key: string) => tContractReviewSignature(key, locale);
  const rowName = (number: number) =>
    `${word('electricity')} · ${word('version')} ${number.toLocaleString(locale)}`;
  const panel = (page: Page) => page.locator('#contract-signature');
  const dialog = (page: Page) => page.getByRole('dialog');
  const confirm = (page: Page) => dialog(page).locator('button[type=submit]');
  const cancel = (page: Page) =>
    dialog(page).getByRole('button', { name: t('team.cancel', locale), exact: true });
  const original = (page: Page) => page.locator('#signature-original');
  const signed = (page: Page) => page.locator('#signature-signed');
  const acknowledgement = (page: Page) => page.locator('#signature-acknowledgement');
  const requestForm = (page: Page) => page.getByTestId('contract-signature-request-form');
  const recordForm = (page: Page) => page.getByTestId('contract-signature-record-form');
  async function open(page: Page, staff: boolean, number: number) {
    await page.goto(staff ? '/admin/contracts' : '/contracts');
    await page.getByRole('button', { name: rowName(number), exact: true }).click();
  }
  async function financialDisclosure(page: Page, amendment: boolean, signedName: string | null) {
    const region = dialog(page).getByRole('region', { name: word('financialReview'), exact: true });
    await expect(region).toContainText('Contract buyer');
    await expect(region).toContainText(word('paymentNow'));
    await expect(region).toContainText(
      formatCurrencyIrr('0', locale, locale === 'fa' ? 'persian' : 'western')
    );
    await expect(region).toContainText(word('financialReviewNotice'));
    await expect(dialog(page)).toContainText('Published contract terms');
    await expect(dialog(page)).toContainText(
      formatCurrencyIrr('9007199254740993', locale, locale === 'fa' ? 'persian' : 'western')
    );
    await expect(dialog(page)).toContainText('Delivery before commissioning');
    await expect(dialog(page)).toContainText('Commissioning after delivery');
    await expect(dialog(page)).toContainText(
      amendment ? 'approved-amendment.pdf' : 'approved-original.pdf'
    );
    await expect(dialog(page)).toContainText((amendment ? 'e' : 'b').repeat(64));
    if (signedName) await expect(dialog(page)).toContainText(signedName);
    return region;
  }

  test(`staff change review and original/amendment signing preserve exact commands (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const fixture = await setupContractReviewSignatures(page, locale, true);
    const { state, error, persist } = fixture;
    const release = await holdSchema(page);
    const reason = page.locator('#contract-change-reason'),
      reasonForm = page.getByTestId('contract-request-changes-form');
    const reasonSubmit = reasonForm.locator('button[type=submit]');
    state.holdRead = true;
    await open(page, true, 1);
    await expect.poll(() => !!state.heldRead).toBe(true);
    const oldRead = state.heldRead!;
    state.holdRead = false;
    await page.getByRole('button', { name: rowName(8), exact: true }).click();
    await expect(reason).toBeEnabled();
    await reason.fill('Fresh private review draft');
    await error(oldRead, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
    await expect(reason).toHaveValue('Fresh private review draft');
    await page.getByRole('button', { name: rowName(1), exact: true }).click();
    await expect(reason).toBeEnabled();
    await reason.focus();
    await reason.fill('x'.repeat(1001));
    // Native blur starts the deferred resolver before duplicate native submit events.
    await page.locator('#contracts-number').fill('  23  ');
    await reasonForm.dispatchEvent('submit');
    await expect(reasonSubmit).toBeDisabled();
    await reasonForm.dispatchEvent('submit');
    expect(state.writes).toEqual([]);
    release();
    await focusedError(reason);
    await expect(page.locator('#contracts-number')).toHaveValue('23');
    await expect(reasonForm).toContainText(copy('reasonHelp'));
    await inspect(page, reasonForm, '[data-testid="contract-request-changes-form"]', reasonSubmit);
    await fieldCapture(reason, info.outputPath(`contract-staff-fields-${locale}-${theme}.png`));
    await reason.fill('  Revise the delivery milestones  ');
    state.writeMode = 'held';
    await reasonSubmit.click();
    await expect(dialog(page)).toBeVisible();
    await confirm(page).click();
    await expect.poll(() => !!state.heldWrite).toBe(true);
    await error(state.heldWrite!, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, ['reason']);
    await expect(dialog(page)).toHaveCount(0);
    await focusedError(reason);
    await expect(reason).toHaveValue('  Revise the delivery milestones  ');
    await expect(reasonForm).not.toContainText('PRIVATE_CONTRACT_SERVER_TEXT');
    state.heldWrite = undefined;
    state.needsStepUp = true;
    await reasonSubmit.click();
    await confirm(page).click();
    await dialog(page).locator('input[type=password]').fill('Contract-password');
    await confirm(page).click();
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const captured = state.writes.at(-1)!;
    expect(captured.body).toEqual({
      expectedVersionId: reviewVersion,
      idempotencyKey: expect.stringMatching(keyPattern),
      reason: 'Revise the delivery milestones',
    });
    expect(captured.body).not.toHaveProperty('expectedReviewHash');
    const receipt = persist(captured);
    expect(receipt).not.toHaveProperty('history');
    expect(receipt.currentVersion).not.toHaveProperty('history');
    await state.heldWrite!.abort('failed');
    const retry = page.getByTestId('contract-review-retry');
    await expect(retry).toBeEnabled();
    await expect(reason).toBeDisabled();
    const other = page.getByRole('button', { name: rowName(8), exact: true });
    await expect(other).toBeDisabled();
    await expect(page.getByRole('button', { name: word('close'), exact: true })).toBeDisabled();
    for (const upload of await page
      .getByRole('button', { name: word('uploadSigned'), exact: true })
      .all())
      await expect(upload).toBeDisabled();
    const reads = state.reads.length;
    await other.dispatchEvent('click');
    for (const refresh of await page
      .getByRole('button', { name: word('refresh'), exact: true })
      .all())
      await refresh.dispatchEvent('click');
    await reasonForm.dispatchEvent('submit');
    expect(state.reads).toHaveLength(reads);
    // Another authorized workflow progresses the source; the durable saved write result is still original.
    fixture.revisedPublishedAccepted();
    state.writeMode = 'rejected';
    await retry.click();
    await confirm(page).click();
    await expect(dialog(page).getByRole('alert').first()).toBeVisible();
    await cancel(page).click();
    await expect(retry).toBeEnabled();
    await expect(reason).toBeDisabled();
    state.writeMode = 'success';
    await retry.click();
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(original(page)).toBeEnabled();
    expect(state.effects).toBe(1);
    for (const command of state.writes.slice(1)) expect(command.raw).toBe(captured.raw);
    expect(state.verifications).toEqual([{ password: 'Contract-password' }]);
    expect(
      state.writes.slice(2).every((command) => command.csrf === 'contract-signature-rotated')
    ).toBe(true);
    await expect(page.getByRole('button', { name: rowName(8), exact: true })).toBeEnabled();
    await expect(
      original(page).locator('option', { hasText: 'ineligible-original.png' })
    ).toHaveCount(0);
    await requestForm(page).dispatchEvent('submit');
    await focusedError(original(page));
    await original(page).selectOption(originalDocument);
    state.previewMode = 'owned';
    await requestForm(page).locator('button[type=submit]').click();
    await focusedError(original(page));
    await expect(original(page)).toHaveValue(originalDocument);
    await expect(panel(page)).not.toContainText('PRIVATE_CONTRACT_SERVER_TEXT');
    for (const mode of ['mixed', 'foreign', 'checksum'] as const) {
      state.previewMode = mode;
      const count = state.previews.length + 1;
      await requestForm(page).locator('button[type=submit]').click();
      await expect.poll(() => state.previews.length).toBe(count);
      await expect(requestForm(page).locator('button[type=submit]')).toBeEnabled();
      await expect(dialog(page)).toHaveCount(0);
    }
    state.previewMode = 'held';
    await requestForm(page).locator('button[type=submit]').click();
    await expect.poll(() => !!state.heldPreview).toBe(true);
    const oldInput = state.previews.at(-1)!.body;
    await original(page).selectOption('');
    await state.heldPreview!.fulfill({ json: fixture.financialReview(oldInput) });
    await expect(requestForm(page).locator('button[type=submit]')).toBeEnabled();
    await expect(dialog(page)).toHaveCount(0);
    await original(page).selectOption(originalDocument);
    state.previewMode = 'success';
    await requestForm(page).locator('button[type=submit]').click();
    await financialDisclosure(page, false, null);
    expect(state.previews.at(-1)!.body).toEqual({
      action: 'request',
      expectedVersionId: acceptedVersion,
      originalDocumentId: originalDocument,
      expectedRequestId: null,
    });
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(signed(page)).toBeEnabled();
    await original(page).selectOption(originalDocument);
    await signed(page).selectOption(signedDocument);
    await acknowledgement(page).check();
    await recordForm(page).locator('button[type=submit]').click();
    await financialDisclosure(page, false, 'approved-signed.png');
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(panel(page).getByRole('status')).toContainText('approved-signed.png');
    expect(state.status).toBe('Signed');
    fixture.pendingAmendment();
    await page
      .getByRole('region', { name: word('staffTitle'), exact: true })
      .getByRole('button', { name: word('refresh'), exact: true })
      .first()
      .click();
    await page.getByRole('button', { name: word('amendmentReview'), exact: true }).click();
    await expect(original(page)).toBeEnabled();
    await expect(
      original(page).locator('option', { hasText: 'approved-original.pdf' })
    ).toHaveCount(0);
    await original(page).selectOption(amendmentDocument);
    await requestForm(page).locator('button[type=submit]').click();
    await financialDisclosure(page, true, null);
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(signed(page)).toBeEnabled();
    await original(page).selectOption(amendmentDocument);
    await signed(page).selectOption(amendmentSignedDocument);
    await acknowledgement(page).check();
    state.writeMode = 'held';
    state.heldWrite = undefined;
    await recordForm(page).locator('button[type=submit]').click();
    const outcome = await financialDisclosure(page, true, 'approved-amendment-signed.png');
    await inspect(page, outcome, '[role="dialog"]', confirm(page));
    await outcomeCapture(
      page,
      outcome,
      info.outputPath(`contract-staff-outcome-${locale}-${theme}.png`)
    );
    await confirm(page).click();
    await dialog(page).locator('form').dispatchEvent('submit');
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const amendmentCommand = state.writes.at(-1)!;
    const amendmentReceipt = persist(amendmentCommand);
    expect(amendmentCommand.body).toMatchObject({
      expectedVersionId: amendmentVersion,
      signedDocumentId: amendmentSignedDocument,
      requestId: state.requests.get(amendmentVersion)!.id,
      expectedReviewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const count = state.writes.length;
    const malformed = structuredClone(amendmentReceipt);
    malformed.versionId = acceptedVersion;
    await state.heldWrite!.fulfill({ json: malformed });
    const signatureRetry = page.getByTestId('contract-signature-retry');
    await expect(signatureRetry).toBeEnabled();
    await expect(signed(page)).toBeDisabled();
    await expect(original(page)).toHaveValue(amendmentDocument);
    await expect(acknowledgement(page)).toBeChecked();
    state.writeMode = 'success';
    await signatureRetry.click();
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(state.writes).toHaveLength(count + 1);
    expect(state.writes.at(-1)!.raw).toBe(amendmentCommand.raw);
    await expect(panel(page).getByRole('status')).toContainText('approved-amendment-signed.png');
    expect(state.currentVersion).toBe(amendmentVersion);
    expect(state.status).toBe('Signed');
    expect(state.effects).toBe(5);
  });

  test(`customer signed image requires acknowledgement and retains an uncertain command (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const fixture = await setupContractReviewSignatures(page, locale, false),
      { state } = fixture;
    const release = await holdSchema(page);
    await open(page, false, 2);
    await expect(requestForm(page)).toHaveCount(0);
    await expect(original(page)).toHaveCount(0);
    const initialView = fixture.signingView(acceptedVersion);
    expect(initialView.request).not.toHaveProperty('requestedBy');
    expect(initialView.canRequest).toBe(false);
    await signed(page).focus();
    await signed(page).selectOption('');
    await acknowledgement(page).focus();
    await recordForm(page).dispatchEvent('submit');
    await expect(recordForm(page).locator('button[type=submit]')).toBeDisabled();
    await recordForm(page).dispatchEvent('submit');
    expect(state.previews).toEqual([]);
    release();
    await focusedError(signed(page));
    await signed(page).selectOption(signedDocument);
    await recordForm(page).locator('button[type=submit]').click();
    await focusedError(acknowledgement(page));
    await expect(signed(page)).toHaveValue(signedDocument);
    await acknowledgement(page).check();
    state.previewMode = 'owned';
    await recordForm(page).locator('button[type=submit]').click();
    await focusedError(signed(page));
    await expect(acknowledgement(page)).toBeChecked();
    await expect(panel(page)).not.toContainText('PRIVATE_CONTRACT_SERVER_TEXT');
    await inspect(
      page,
      recordForm(page),
      '[data-testid="contract-signature-record-form"]',
      recordForm(page).locator('button[type=submit]')
    );
    await fieldCapture(
      signed(page),
      info.outputPath(`contract-customer-fields-${locale}-${theme}.png`)
    );
    state.previewMode = 'held';
    await recordForm(page).locator('button[type=submit]').click();
    await expect.poll(() => !!state.heldPreview).toBe(true);
    const oldInput = state.previews.at(-1)!.body;
    await signed(page).selectOption('');
    await state.heldPreview!.fulfill({ json: fixture.financialReview(oldInput) });
    await expect(recordForm(page).locator('button[type=submit]')).toBeEnabled();
    await expect(dialog(page)).toHaveCount(0);
    await signed(page).selectOption(signedDocument);
    await acknowledgement(page).check();
    state.previewMode = 'success';
    state.writeMode = 'held';
    state.needsStepUp = true;
    await recordForm(page).locator('button[type=submit]').click();
    const outcome = await financialDisclosure(page, false, 'approved-signed.png');
    await inspect(page, outcome, '[role="dialog"]', confirm(page));
    await outcomeCapture(
      page,
      outcome,
      info.outputPath(`contract-customer-outcome-${locale}-${theme}.png`)
    );
    expect(state.previews.at(-1)!.body).toEqual({
      action: 'record',
      expectedVersionId: acceptedVersion,
      signedDocumentId: signedDocument,
      requestId: initialView.request!.id,
    });
    await confirm(page).click();
    await dialog(page).locator('input[type=password]').fill('Contract-password');
    await confirm(page).click();
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const captured = state.writes.at(-1)!;
    expect(captured.body).toEqual({
      expectedVersionId: acceptedVersion,
      signedDocumentId: signedDocument,
      requestId: initialView.request!.id,
      idempotencyKey: expect.stringMatching(keyPattern),
      expectedReviewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(captured.body).not.toHaveProperty('action');
    const receipt = fixture.persist(captured);
    expect(receipt.request).not.toHaveProperty('requestedBy');
    expect(receipt.signature).not.toHaveProperty('recordedBy');
    expect(receipt.signature).not.toHaveProperty('uploadedBy');
    await state.heldWrite!.abort('failed');
    const retry = page.getByTestId('contract-signature-retry');
    await expect(retry).toBeEnabled();
    await expect(signed(page)).toBeDisabled();
    await expect(acknowledgement(page)).toBeChecked();
    const previews = state.previews.length,
      reads = state.reads.length,
      effects = state.effects;
    await recordForm(page).dispatchEvent('submit');
    await panel(page)
      .getByRole('button', { name: word('refresh'), exact: true })
      .dispatchEvent('click');
    expect(state.reads).toHaveLength(reads);
    expect(state.previews).toHaveLength(previews);
    for (const invalid of ['foreign', 'ordered-terms', 'staff-only'] as const) {
      state.heldWrite = undefined;
      await retry.click();
      await confirm(page).click();
      await expect.poll(() => !!state.heldWrite).toBe(true);
      const malformed = structuredClone(receipt) as typeof receipt & {
        financialReview: { data: { contract: { content: { milestones: string[] } } } };
        signature: Record<string, unknown>;
      };
      if (invalid === 'foreign') malformed.contractId = otherContract;
      if (invalid === 'ordered-terms')
        malformed.financialReview.data.contract.content.milestones.reverse();
      if (invalid === 'staff-only') malformed.signature.recordedBy = 'PRIVATE_STAFF_ACTOR';
      await state.heldWrite!.fulfill({ json: jsonbOrder(malformed) });
      await expect(retry).toBeEnabled();
      await expect(signed(page)).toBeDisabled();
      await expect(panel(page)).not.toContainText('PRIVATE_STAFF_ACTOR');
    }
    state.writeMode = 'rejected';
    await retry.click();
    await confirm(page).click();
    await expect(dialog(page).getByRole('alert').first()).toBeVisible();
    await cancel(page).click();
    await expect(retry).toBeEnabled();
    await expect(signed(page)).toBeDisabled();
    state.writeMode = 'success';
    await retry.click();
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(panel(page).getByRole('status')).toContainText('approved-signed.png');
    expect(state.effects).toBe(effects);
    expect(state.previews).toHaveLength(previews);
    expect(state.writes.every((command) => command.raw === captured.raw)).toBe(true);
    expect(
      state.writes.slice(1).every((command) => command.csrf === 'contract-signature-rotated')
    ).toBe(true);
    expect(state.verifications).toEqual([{ password: 'Contract-password' }]);
    await expect(recordForm(page)).toHaveCount(0);
    await expect(requestForm(page)).toHaveCount(0);
    // A current resource denial withdraws the selected private document/terms, not the authorized list.
    state.denied = true;
    await panel(page)
      .getByRole('button', { name: word('refresh'), exact: true })
      .click();
    await expect(page.getByRole('region', { name: word('terms'), exact: true })).toHaveCount(0);
    await expect(page.locator('#contract-signature')).toHaveCount(0);
    expect(state.reads.some((url) => url.includes(contractId))).toBe(true);
  });
}

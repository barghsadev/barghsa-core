import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n/app';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractAuthoring } from '@barghsa/i18n/contract-authoring';
import { test, expect } from './coverage-fixture';
import {
  setupContractAuthoring,
  draftContractId,
  createdContractId,
  profileId,
  otherProfileId,
  draftVersionId,
  linkedOrderId,
  invoiceId,
  amendmentVersionId,
  originalContent,
  jsonbOrder,
} from './contract-authoring-form-fixture';

const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-message/);
}
async function inspect(page: Page, form: Locator, selector: string, button: Locator) {
  const focused = await page.evaluate(() => document.activeElement?.id);
  await button.hover();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(focused);
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await form.locator('input,textarea,select,button').all()) {
    const box = await control.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
async function fieldCapture(page: Page, field: Locator, path: string) {
  const row = field.locator('..');
  await row.scrollIntoViewIfNeeded();
  await row.evaluate((node) => window.scrollBy(0, node.getBoundingClientRect().top - 130));
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  // This is a compact field/linked-feedback frame, not a full-page or keyboard capture.
  await page.screenshot({
    path,
    clip: {
      x: box!.x,
      y: Math.max(0, box!.y),
      width: box!.width,
      height: Math.min(box!.height, page.viewportSize()!.height - Math.max(0, box!.y)),
    },
  });
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
  const dialog = (page: Page) => page.getByRole('dialog');
  const draftForm = (page: Page) => page.getByTestId('contract-draft-form');
  const contextForm = (page: Page) => page.getByTestId('contract-context-form');
  const terms = (page: Page) => page.getByRole('region', { name: word('terms'), exact: true });
  const rowName = (n: number) =>
    `${word('electricity')} · ${word('version')} ${n.toLocaleString(locale)}`;
  const draftField = (page: Page, key: string) =>
    draftForm(page).getByLabel(word(key), { exact: true });
  const draftSubmit = (page: Page) => draftForm(page).locator('button[type=submit]');
  const retry = (page: Page) => page.getByTestId('contract-draft-retry');
  const contextRetry = (page: Page) => page.getByTestId('contract-context-retry');
  async function confirm(page: Page) {
    await expect(dialog(page)).toBeVisible();
    const password = dialog(page).locator('input[type=password]');
    if (await password.count()) await password.fill('Authoring-password');
    await dialog(page).locator('button[type=submit]').click();
  }
  async function cancel(page: Page) {
    await dialog(page)
      .getByRole('button', { name: t('team.cancel', locale), exact: true })
      .click();
  }
  async function refresh(page: Page) {
    await page
      .getByRole('region', { name: word('staffTitle'), exact: true })
      .getByRole('button', { name: word('refresh'), exact: true })
      .first()
      .click();
  }
  async function lockedWorkspace(page: Page, reads: string[]) {
    const count = reads.length;
    const refreshes = page.getByRole('button', { name: word('refresh'), exact: true });
    for (const button of await refreshes.all()) {
      await expect(button).toBeDisabled();
      await button.dispatchEvent('click');
    }
    await expect(page.locator('#contracts-number')).toBeDisabled();
    await page.locator('#contracts-number').locator('xpath=ancestor::form').dispatchEvent('submit');
    expect(reads).toHaveLength(count);
  }
  async function outcomeCapture(page: Page, text: string, path: string) {
    const item = terms(page).locator(':scope > dl > div').filter({ hasText: text }).first();
    await expect(item).toBeVisible();
    await item.scrollIntoViewIfNeeded();
    await item.evaluate((node) => window.scrollBy(0, node.getBoundingClientRect().top - 130));
    await item.screenshot({ path });
  }

  test(`draft create and imported revision preserve scope and exact commands (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const fixture = await setupContractAuthoring(page, locale, false);
    const { state, persist, error } = fixture;
    const release = await holdSchema(page);
    state.holdChoices = true;
    await page.goto('/admin/contracts');
    await page.getByRole('button', { name: word('draftCreate'), exact: true }).click();
    await expect.poll(() => !!state.heldChoices).toBe(true);
    const oldChoices = state.heldChoices!;
    state.holdChoices = false;
    await draftField(page, 'draftSearchProfiles').fill('Other');
    await draftForm(page)
      .getByRole('button', { name: word('draftSearch'), exact: true })
      .click();
    await expect(
      draftField(page, 'draftProfile').locator(`option[value="${otherProfileId}"]`)
    ).toHaveCount(1);
    await error(oldChoices, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
    await expect(
      draftField(page, 'draftProfile').locator(`option[value="${otherProfileId}"]`)
    ).toHaveCount(1);
    await draftField(page, 'draftSearchProfiles').fill('');
    await draftForm(page)
      .getByRole('button', { name: word('draftSearch'), exact: true })
      .click();
    await draftField(page, 'draftProfile').selectOption(profileId);
    await draftField(page, 'draftOrder').selectOption(linkedOrderId);
    await draftField(page, 'serviceType').selectOption('savings');
    await expect(draftField(page, 'draftOrder')).toHaveValue('');
    await draftField(page, 'serviceType').selectOption('electricity');
    await draftField(page, 'draftOrder').selectOption(linkedOrderId);
    await draftField(page, 'titleField').fill('  New staff contract  ');
    await draftField(page, 'draftTerms').fill('  New staff terms\n  ');
    await draftField(page, 'statedContractValue').selectOption('fixed');
    await draftField(page, 'fixedContractAmount').fill('9007199254740993');
    await draftField(page, 'statedContractValue').selectOption('variable');
    await draftField(page, 'variableContractDescription').fill('  Hidden variable draft  ');
    await draftField(page, 'statedContractValue').selectOption('fixed');
    await page.locator('#contracts-number').fill('  23  ');
    const reason = draftField(page, 'contextReason');
    await reason.fill('x'.repeat(1001));
    await draftField(page, 'titleField').focus();
    await draftForm(page).dispatchEvent('submit');
    await expect(draftSubmit(page)).toBeDisabled();
    await draftForm(page).dispatchEvent('submit');
    expect(state.writes).toEqual([]);
    release();
    await focusedError(reason);
    await expect(draftField(page, 'titleField')).toHaveValue('  New staff contract  ');
    await inspect(page, draftForm(page), '[data-testid="contract-draft-form"]', draftSubmit(page));
    await fieldCapture(page, reason, info.outputPath(`draft-field-${locale}.png`));
    await reason.fill('  Create the staff contract  ');
    state.writeMode = 'owned';
    await draftSubmit(page).click();
    await confirm(page);
    await expect(dialog(page)).toHaveCount(0);
    await focusedError(reason);
    await expect(reason).toHaveValue('  Create the staff contract  ');
    await expect(draftForm(page)).not.toContainText('PRIVATE_AUTHORING_SERVER_TEXT');
    await draftField(page, 'statedContractValue').selectOption('variable');
    await expect(draftField(page, 'variableContractDescription')).toHaveValue(
      '  Hidden variable draft  '
    );
    await draftField(page, 'statedContractValue').selectOption('fixed');
    state.writeMode = 'mixed';
    await draftSubmit(page).click();
    await confirm(page);
    await expect(dialog(page)).toHaveCount(0);
    await expect(draftForm(page).locator('..').getByRole('alert')).toContainText(word('error'));
    await expect(reason).not.toHaveAttribute('aria-invalid', 'true');
    await expect(reason).toHaveValue('  Create the staff contract  ');
    await expect(draftField(page, 'titleField')).toHaveValue('  New staff contract  ');
    await expect(draftForm(page).locator('..')).not.toContainText('PRIVATE_AUTHORING_SERVER_TEXT');
    state.writeMode = 'held';
    await draftSubmit(page).click();
    await confirm(page);
    await dialog(page).locator('form').dispatchEvent('submit');
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const captured = state.writes.at(-1)!;
    const capturedIndex = state.writes.length - 1;
    expect(captured.body).toEqual({
      profileId,
      serviceType: 'electricity',
      orderId: linkedOrderId,
      content: {
        title: 'New staff contract',
        text: 'New staff terms',
        commercialValue: { kind: 'fixed', amountIrr: '9007199254740993' },
      },
      changeDescription: 'Create the staff contract',
      idempotencyKey: expect.stringMatching(keyPattern),
    });
    const receipt = persist(captured);
    expect(receipt.id).toBe(createdContractId);
    expect(receipt.currentVersion.id).toMatch(uuidPattern);
    expect(receipt).not.toHaveProperty('activationContext');
    expect(receipt).not.toHaveProperty('expectedReviewHash');
    const count = state.writes.length;
    await state.heldWrite!.abort('failed');
    await expect(retry(page)).toBeEnabled();
    await expect(reason).toBeDisabled();
    await lockedWorkspace(page, state.reads);
    await expect(page.locator('#contracts-number')).toHaveValue('23');
    await draftForm(page).dispatchEvent('submit');
    expect(state.writes).toHaveLength(count);
    state.heldWrite = undefined;
    await retry(page).click();
    await confirm(page);
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const foreign = structuredClone(receipt);
    foreign.profileId = otherProfileId;
    await state.heldWrite!.fulfill({ status: 201, json: jsonbOrder(foreign) });
    await expect(retry(page)).toBeEnabled();
    await expect(reason).toBeDisabled();
    state.writeMode = 'rejected';
    await retry(page).click();
    await confirm(page);
    await expect(dialog(page)).toHaveCount(0);
    await expect(draftForm(page).locator('..').getByRole('alert')).toHaveText(
      tContractAuthoring('uncertain', locale)
    );
    await expect(reason).toBeDisabled();
    await expect(draftForm(page).locator('..')).not.toContainText('PRIVATE_AUTHORING_SERVER_TEXT');
    await lockedWorkspace(page, state.reads);
    await retry(page).click();
    await expect(dialog(page)).toBeVisible();
    await cancel(page);
    await expect(retry(page)).toBeEnabled();
    state.writeMode = 'success';
    await retry(page).click();
    await confirm(page);
    await expect(dialog(page)).toHaveCount(0);
    await expect(terms(page)).toContainText('New staff terms');
    expect(state.effects).toBe(1);
    for (const command of state.writes.slice(capturedIndex)) expect(command.raw).toBe(captured.raw);
    expect(state.writes.every((command) => command.csrf === 'contract-authoring-rotated')).toBe(
      true
    );
    expect(state.verifications.every((value) => value.password === 'Authoring-password')).toBe(
      true
    );
    expect(state.verifications.length).toBeGreaterThan(0);
    await page.getByRole('button', { name: rowName(2), exact: true }).click();
    await terms(page)
      .getByRole('button', { name: word('draftEdit'), exact: true })
      .click();
    await expect(draftField(page, 'draftTerms')).toHaveValue(originalContent.text);
    await draftField(page, 'draftTerms').fill('  Revised imported delivery terms  ');
    await draftField(page, 'contextReason').fill('  Correct the imported delivery  ');
    await draftSubmit(page).click();
    await confirm(page);
    await expect(dialog(page)).toHaveCount(0);
    const revised = state.writes.at(-1)!;
    expect(revised.family).toBe('revise');
    expect(revised.body).toEqual({
      expectedVersionId: draftVersionId,
      content: { ...originalContent, text: 'Revised imported delivery terms' },
      changeDescription: 'Correct the imported delivery',
      idempotencyKey: expect.stringMatching(keyPattern),
    });
    expect(fixture.versions.get(draftVersionId)!.content).toEqual(originalContent);
    await expect(terms(page)).toContainText(word('AwaitingStaffReview'));
    await expect(terms(page)).toContainText('Revised imported delivery terms');
    await outcomeCapture(
      page,
      'Revised imported delivery terms',
      info.outputPath(`draft-outcome-${locale}.png`)
    );
    // A current authorized-read denial withdraws the selected private source, without echoing server text.
    state.denied = true;
    await refresh(page);
    await expect(terms(page)).toHaveCount(0);
    await expect(page.locator('#admin-content')).not.toContainText(
      'Revised imported delivery terms'
    );
    await expect(page.locator('#admin-content')).not.toContainText('PRIVATE_AUTHORING_SERVER_TEXT');
  });

  test(`context versions and base amendments keep original instants and immutable retries (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const fixture = await setupContractAuthoring(page, locale, true);
    const { state, persist, error } = fixture;
    const release = await holdSchema(page);
    await page.goto('/admin/contracts');
    await page.getByRole('button', { name: rowName(2), exact: true }).click();
    await terms(page)
      .getByRole('button', { name: word('editContext'), exact: true })
      .click();
    const start = page.locator('#contract-context-start'),
      end = page.locator('#contract-context-end'),
      invoice = page.locator('#contract-context-invoice'),
      reason = page.locator('#contract-context-reason');
    const contextSubmit = contextForm(page).locator('button[type=submit]');
    await expect(start).toHaveValue('2030-01-02T11:30');
    await expect(end).toHaveValue('2030-01-03T11:30');
    await invoice.fill('invalid-invoice');
    await reason.fill('  Keep the original seconds  ');
    await end.focus();
    await contextForm(page).dispatchEvent('submit');
    await expect(contextSubmit).toBeDisabled();
    await contextForm(page).dispatchEvent('submit');
    expect(state.writes).toEqual([]);
    release();
    await focusedError(invoice);
    await expect(reason).toHaveValue('  Keep the original seconds  ');
    await inspect(page, contextForm(page), '[data-testid="contract-context-form"]', contextSubmit);
    await fieldCapture(page, invoice, info.outputPath(`context-field-${locale}.png`));
    await invoice.fill('');
    state.writeMode = 'held';
    state.needsStepUp = true;
    await contextSubmit.click();
    await confirm(page);
    await expect(dialog(page).locator('input[type=password]')).toBeVisible();
    await confirm(page);
    await expect.poll(() => !!state.heldWrite).toBe(true);
    await error(state.heldWrite!, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, [
      'initialInvoiceId',
    ]);
    await expect(dialog(page)).toHaveCount(0);
    await focusedError(invoice);
    await expect(start).toHaveValue('2030-01-02T11:30');
    await expect(end).toHaveValue('2030-01-03T11:30');
    await expect(reason).toHaveValue('  Keep the original seconds  ');
    await invoice.fill(invoiceId.toUpperCase());
    await end.fill('2030-01-04T11:30');
    state.heldWrite = undefined;
    await contextSubmit.click();
    await confirm(page);
    await dialog(page).locator('form').dispatchEvent('submit');
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const captured = state.writes.at(-1)!;
    const capturedIndex = state.writes.length - 1;
    expect(captured.body).toEqual({
      expectedVersionId: draftVersionId,
      content: originalContent,
      activationContext: {
        initialInvoiceId: invoiceId,
        serviceStartsAt: '2030-01-02T08:00:45.678Z',
        serviceEndsAt: '2030-01-04T08:00:00.000Z',
      },
      changeDescription: 'Keep the original seconds',
      idempotencyKey: expect.stringMatching(keyPattern),
    });
    const receipt = persist(captured);
    expect(receipt.currentVersion.content).toEqual(originalContent);
    expect(receipt.currentVersion).not.toHaveProperty('activationContext');
    await state.heldWrite!.abort('failed');
    await expect(contextRetry(page)).toBeEnabled();
    await expect(start).toBeDisabled();
    const reads = state.reads.length;
    state.timezone = 'UTC';
    const preference = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/user/settings/timezone') &&
        response.request().method() === 'GET'
    );
    await page.evaluate(() => window.dispatchEvent(new Event('barghsa:timezone-changed')));
    expect(await (await preference).json()).toEqual({ timezone: 'UTC' });
    // Captured wall-clock fields remain explicitly labelled with their original zone until confirmed.
    await expect(contextForm(page)).toContainText('Asia/Tehran');
    await expect(start).toHaveValue('2030-01-02T11:30');
    await expect(end).toHaveValue('2030-01-04T11:30');
    await expect(contextRetry(page)).toBeEnabled();
    await lockedWorkspace(page, state.reads);
    expect(state.reads).toHaveLength(reads);
    state.heldWrite = undefined;
    await contextRetry(page).click();
    await confirm(page);
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const malformed = structuredClone(receipt);
    malformed.currentVersion.content.imported = { private: 'PRIVATE_FOREIGN_RECEIPT' };
    await state.heldWrite!.fulfill({ status: 200, json: malformed });
    await expect(contextRetry(page)).toBeEnabled();
    await expect(start).toBeDisabled();
    await expect(page.locator('#admin-content')).not.toContainText('PRIVATE_FOREIGN_RECEIPT');
    state.writeMode = 'success';
    await contextRetry(page).click();
    await confirm(page);
    await expect(dialog(page)).toHaveCount(0);
    expect(state.effects).toBe(1);
    for (const command of state.writes.slice(capturedIndex)) expect(command.raw).toBe(captured.raw);
    await terms(page)
      .getByRole('button', { name: word('editContext'), exact: true })
      .click();
    await expect(contextForm(page)).toContainText('UTC');
    await expect(start).toHaveValue('2030-01-02T08:00');
    await expect(end).toHaveValue('2030-01-04T08:00');
    await terms(page)
      .getByRole('button', { name: word('editContext'), exact: true })
      .click();
    const baseVersion = state.currentVersionId;
    expect(baseVersion).not.toBe(draftVersionId);
    fixture.acceptCurrent();
    await refresh(page);
    await expect(terms(page)).toContainText(word('Accepted'));
    await expect(
      terms(page).getByRole('button', { name: word('amendmentCreate'), exact: true })
    ).toBeEnabled();
    await terms(page)
      .getByRole('button', { name: word('amendmentCreate'), exact: true })
      .click();
    await draftField(page, 'statedContractValue').selectOption('variable');
    await draftField(page, 'variableContractDescription').fill('  Indexed delivery value  ');
    await draftField(page, 'contextReason').fill('  Propose indexed delivery  ');
    state.writeMode = 'held';
    state.heldWrite = undefined;
    await draftSubmit(page).click();
    await confirm(page);
    await expect.poll(() => !!state.heldWrite).toBe(true);
    const amendmentCommand = state.writes.at(-1)!;
    expect(amendmentCommand.body).toEqual({
      expectedVersionId: baseVersion,
      content: {
        ...originalContent,
        commercialValue: { kind: 'variable', description: 'Indexed delivery value' },
      },
      changeDescription: 'Propose indexed delivery',
      idempotencyKey: expect.stringMatching(keyPattern),
    });
    const amendment = persist(amendmentCommand);
    expect(amendment.id).toBe(draftContractId);
    expect(amendment.currentVersionId).toBe(baseVersion);
    expect(amendment.currentVersion.content).toEqual(originalContent);
    expect(amendment.pendingAmendment).toEqual({
      versionId: amendmentVersionId,
      baseVersionId: baseVersion,
      state: 'Draft',
      proposedBy: state.actor,
      createdAt: expect.any(String),
      publishedAt: null,
    });
    const wrongBase = structuredClone(amendment);
    wrongBase.pendingAmendment!.baseVersionId = draftVersionId;
    await state.heldWrite!.fulfill({ status: 201, json: jsonbOrder(wrongBase) });
    await expect(retry(page)).toBeEnabled();
    await expect(draftField(page, 'variableContractDescription')).toBeDisabled();
    await lockedWorkspace(page, state.reads);
    state.writeMode = 'success';
    await retry(page).click();
    await confirm(page);
    await expect(dialog(page)).toHaveCount(0);
    expect(state.effects).toBe(2);
    for (const command of state.writes.filter((command) => command.family === 'amendment'))
      expect(command.raw).toBe(amendmentCommand.raw);
    expect(
      state.writes.slice(1).every((command) => command.csrf === 'contract-authoring-rotated')
    ).toBe(true);
    expect(state.verifications).toEqual([
      { password: 'Authoring-password' },
      { password: 'Authoring-password' },
      { password: 'Authoring-password' },
    ]);
    await expect(terms(page)).toContainText(word('amendmentDraftNotice'));
    await expect(terms(page)).toContainText(originalContent.text);
    await expect(terms(page)).not.toContainText('PRIVATE_AUTHORING_SERVER_TEXT');
    await outcomeCapture(
      page,
      originalContent.text.trim(),
      info.outputPath(`context-amendment-outcome-${locale}.png`)
    );
  });
}

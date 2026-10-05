import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n/app';
import { tSolar } from '@barghsa/i18n/solar';
import { contractText } from '@barghsa/i18n/contracts';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { test, expect } from './coverage-fixture';
import {
  setupSolarContractIssue,
  firstSolar,
  solarProfile,
  templateVersion,
  contractDocument,
  jsonbOrder,
} from './solar-contract-issue-form-fixture';

const commandKey = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const generatedId = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const terms =
  'Install the agreed solar equipment.\nStaff publication is required before customer disclosure.';
const maxAmount = '9223372036854775807';
async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-description.*-message/);
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
  await region.evaluate((node) => window.scrollBy(0, node.getBoundingClientRect().top - 200));
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
    '**/' + manifest['src/lib/solar-contract-form-schemas.ts'].file,
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
  const copy = (key: string) => tSolar(key, locale);
  for (const kind of ['template', 'document'] as const) {
    test(`solar ${kind === 'template' ? 'template and fixed value' : 'uploaded terms and variable VAT rows'} retains its exact contract issue command (${locale}, ${theme})`, async ({
      page,
    }, info) => {
      const { state, options, review, persist, error } = await setupSolarContractIssue(
        page,
        locale
      );
      const release = await holdSchema(page);
      const form = page.getByTestId('solar-contract-form');
      const field = (name: string) => page.locator('#solar-contract-' + name);
      const line = (index: number, name: string) => field(`line-${index}-${name}`);
      const submit = form.locator('button[type=submit]');
      const retry = page.getByTestId('solar-contract-retry');
      const dialog = page.getByRole('dialog');
      const confirm = () => dialog.locator('button[type=submit]');
      const cancel = () =>
        dialog.getByRole('button', { name: t('team.cancel', locale), exact: true });
      const guidance = page.locator('#solar-postal-guidance-en');
      const guidanceForm = guidance.locator('xpath=ancestor::form');
      await page.goto('/admin/solar-postal');
      if (kind === 'document') {
        state.optionsMode = 'held';
        await page.getByRole('button', { name: /First solar buyer/ }).click();
        await expect.poll(() => !!state.heldOptions).toBe(true);
        const old = state.heldOptions!;
        state.optionsMode = 'success';
        await page.getByRole('button', { name: /Older solar buyer/ }).click();
        await expect(field('source')).toBeEnabled();
        await expect(
          field('source').locator('option', { hasText: 'signed-solar-terms.pdf' })
        ).toHaveCount(1);
        await field('title').fill('Fresh selected private contract');
        await error(old, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
        await expect(field('title')).toHaveValue('Fresh selected private contract');
      }
      await page.getByRole('button', { name: /First solar buyer/ }).click();
      await expect(field('source')).toBeEnabled();
      await expect(
        field('source').locator('option', { hasText: 'Solar construction template' })
      ).toHaveCount(1);
      await field('source').selectOption(
        kind === 'template' ? `template:${templateVersion}` : `document:${contractDocument}`
      );
      // Native blur starts validation while the same lazy schema is held for duplicate submits.
      await field('title').focus();
      await field('title').fill('x'.repeat(201));
      await field('text').fill('  ' + terms + '  ');
      await field('reason').fill('  Initial solar contract terms and invoice  ');
      await expect(form).toContainText(contractText('commercialValueNotice', locale));
      await field('value-kind').selectOption('variable');
      await field('variable-description').fill(
        '  Final value depends on measured installation work  '
      );
      await field('value-kind').selectOption('fixed');
      await field('fixed-amount').fill(maxAmount);
      if (kind === 'document') await field('value-kind').selectOption('variable');
      await line(0, 'description').fill('  Panel installation  ');
      await line(0, 'quantity').fill(kind === 'template' ? '2' : '3');
      await line(0, 'unit-price').fill(kind === 'template' ? '125000' : '00005');
      await line(0, 'vat-rate').fill(kind === 'template' ? '900' : '1000');
      await line(0, 'taxable').check();
      if (kind === 'document') {
        await page.getByTestId('solar-contract-add-line').click();
        await line(1, 'description').fill('  Non-taxable permit  ');
        await line(1, 'quantity').fill('2');
        await line(1, 'unit-price').fill('10');
        await line(1, 'vat-rate').fill('5000');
        await line(1, 'taxable').uncheck();
        await page.getByTestId('solar-contract-add-line').click();
        await line(2, 'description').fill('  Commissioning  ');
        await line(2, 'quantity').fill('1');
        await line(2, 'unit-price').fill('100');
        await line(2, 'vat-rate').fill('900');
        await line(2, 'taxable').check();
      }
      await guidance.fill('  Independent postal guidance draft  ');
      await page.locator('#solar-postal-reason').fill('  Independent final review draft  ');
      await form.dispatchEvent('submit');
      await expect(submit).toBeDisabled();
      await form.dispatchEvent('submit');
      expect(state.previews).toEqual([]);
      release();
      await focusedError(field('title'));
      await expect(field('text')).toHaveValue('  ' + terms + '  ');
      await expect(line(0, 'unit-price')).toHaveValue(kind === 'template' ? '125000' : '00005');
      await expect(guidance).toHaveValue('  Independent postal guidance draft  ');
      await field('title').fill('  Solar installation agreement  ');
      state.previewMode = 'owned';
      await submit.click();
      await focusedError(line(0, 'unit-price'));
      await expect(form).not.toContainText('PRIVATE_SOLAR_CONTRACT_SERVER_TEXT');
      await expect(field('reason')).toHaveValue('  Initial solar contract terms and invoice  ');
      await inspect(page, form, '[data-testid="solar-contract-form"]', submit);
      await fieldCapture(
        line(0, 'unit-price'),
        info.outputPath(`solar-contract-${kind}-fields-${locale}-${theme}.png`)
      );
      // Conditional raw drafts remain intact after server-owned feedback.
      await field('value-kind').selectOption('variable');
      await expect(field('variable-description')).toHaveValue(
        '  Final value depends on measured installation work  '
      );
      await field('value-kind').selectOption('fixed');
      await expect(field('fixed-amount')).toHaveValue(maxAmount);
      if (kind === 'document') await field('value-kind').selectOption('variable');
      state.previewMode = 'mixed';
      await submit.click();
      await expect(form.getByRole('alert')).toBeVisible();
      await expect(form).not.toContainText('PRIVATE_SOLAR_CONTRACT_SERVER_TEXT');
      await expect(line(0, 'unit-price')).not.toHaveAttribute('aria-invalid', 'true');
      for (const invalid of ['foreign', 'arithmetic'] as const) {
        state.previewMode = invalid;
        const count = state.previews.length + 1;
        await submit.click();
        await expect.poll(() => state.previews.length).toBe(count);
        await expect(submit).toBeEnabled();
        await expect(dialog).toHaveCount(0);
        await expect(field('text')).toHaveValue('  ' + terms + '  ');
      }
      state.previewMode = 'success';
      await submit.click();
      await expect(dialog).toContainText(copy('solarReviewOutcome'));
      const input = state.previews.at(-1)!.body;
      expect(input).toEqual({
        profileId: solarProfile,
        idempotencyKey: expect.stringMatching(commandKey),
        title: 'Solar installation agreement',
        text: terms,
        changeDescription: 'Initial solar contract terms and invoice',
        commercialValue:
          kind === 'template'
            ? { kind: 'fixed', amountIrr: maxAmount }
            : {
                kind: 'variable',
                description: 'Final value depends on measured installation work',
              },
        source:
          kind === 'template'
            ? { kind: 'template', templateVersionId: templateVersion }
            : { kind: 'document', documentId: contractDocument },
        invoiceLines:
          kind === 'template'
            ? [
                {
                  description: 'Panel installation',
                  quantity: 2,
                  unitPrice: '125000',
                  vatRate: 900,
                  isTaxable: true,
                },
              ]
            : [
                {
                  description: 'Panel installation',
                  quantity: 3,
                  unitPrice: '00005',
                  vatRate: 1000,
                  isTaxable: true,
                },
                {
                  description: 'Non-taxable permit',
                  quantity: 2,
                  unitPrice: '10',
                  vatRate: 5000,
                  isTaxable: false,
                },
                {
                  description: 'Commissioning',
                  quantity: 1,
                  unitPrice: '100',
                  vatRate: 900,
                  isTaxable: true,
                },
              ],
      });
      const quoted = review(firstSolar, input);
      expect(quoted.scope.resourceId).toBe(input.idempotencyKey);
      expect(quoted.data.totals).toEqual(
        kind === 'template'
          ? { currency: 'IRR', subtotal: '250000', vat: '22500', total: '272500' }
          : { currency: 'IRR', subtotal: '135', vat: '11', total: '146' }
      );
      if (kind === 'document')
        expect(quoted.data.invoiceLines.map((row) => row.vatAmount)).toEqual(['2', '0', '9']);
      await expect(dialog).toContainText(
        kind === 'template'
          ? options.templates[0]!.name + ' · v3'
          : options.documents[0]!.original_name
      );
      await expect(dialog).toContainText(quoted.data.title);
      await expect(dialog).toContainText(quoted.data.changeDescription);
      await expect(dialog).toContainText(
        kind === 'template'
          ? formatCurrencyIrr(maxAmount, locale)
          : quoted.data.commercialValue.kind === 'variable'
            ? quoted.data.commercialValue.description
            : ''
      );
      for (const row of quoted.data.invoiceLines) {
        await expect(dialog).toContainText(row.description);
        await expect(dialog).toContainText(formatCurrencyIrr(row.lineTotal, locale));
      }
      await expect(dialog).toContainText(formatCurrencyIrr(quoted.data.totals.vat, locale));
      await expect(dialog).toContainText(formatCurrencyIrr(quoted.data.totals.total, locale));
      await expect(dialog).toContainText('7 ' + copy('solarReviewDaysAfterIssue'));
      await dialog.getByText(copy('solarContractText'), { exact: true }).click();
      await expect(dialog).toContainText(terms);
      await inspect(page, dialog, '[role="dialog"]', confirm());
      await outcomeCapture(
        page,
        dialog.getByRole('region', { name: copy('solarContractReviewTitle'), exact: true }),
        info.outputPath(`solar-contract-${kind}-outcome-${locale}-${theme}.png`)
      );
      state.needsStepUp = true;
      state.writeMode = 'held';
      await confirm().click();
      const password = dialog.getByLabel(t('team.password', locale), { exact: true });
      await expect(password).toBeVisible();
      await password.fill('Solar-contract-proof-42!');
      await confirm().click();
      await expect.poll(() => !!state.heldWrite).toBe(true);
      const command = state.writes.at(-1)!;
      expect(command.body).toEqual({ ...input, expectedReviewHash: quoted.hash });
      expect(state.verifications).toEqual([{ password: 'Solar-contract-proof-42!' }]);
      await dialog.locator('form').dispatchEvent('submit');
      expect(state.writes).toHaveLength(2);
      const receipt = persist(command);
      expect(receipt).toEqual({
        status: 'contract_created',
        contractId: expect.stringMatching(generatedId),
        invoiceIds: [expect.stringMatching(generatedId)],
      });
      expect(receipt.contractId).not.toBe(receipt.invoiceIds[0]);
      await state.heldWrite!.fulfill({ json: { ...receipt, status: 'published' } });
      await expect(retry).toBeEnabled();
      await expect(dialog).toHaveCount(0);
      await expect(field('title')).toBeDisabled();
      const readCount = state.reads.length,
        optionCount = state.optionsReads.length,
        previewCount = state.previews.length;
      const other = page.getByRole('button', { name: /Older solar buyer/ });
      const close = page.getByRole('button', { name: copy('solarCloseNoContract'), exact: true });
      const saveGuidance = guidanceForm.getByRole('button', {
        name: copy('postalSaveGuidance'),
        exact: true,
      });
      await expect(other).toBeDisabled();
      await expect(page.locator('#solar-postal-lane')).toBeDisabled();
      await expect(close).toBeDisabled();
      await expect(saveGuidance).toBeDisabled();
      await other.dispatchEvent('click');
      await page.locator('#solar-postal-lane').evaluate((node) => {
        (node as HTMLSelectElement).value = 'waiting_customer';
        node.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await close.dispatchEvent('click');
      await guidanceForm.dispatchEvent('submit');
      await form.dispatchEvent('submit');
      expect(state.reads).toHaveLength(readCount);
      expect(state.optionsReads).toHaveLength(optionCount);
      expect(state.previews).toHaveLength(previewCount);
      expect(state.guidanceWrites).toEqual([]);
      expect(state.siblingWrites).toEqual([]);
      await expect(guidance).toHaveValue('  Independent postal guidance draft  ');
      await expect(page.locator('#solar-postal-reason')).toHaveValue(
        '  Independent final review draft  '
      );
      for (const malformed of [
        { ...receipt, invoiceIds: [] },
        { ...receipt, invoiceIds: [receipt.contractId] },
        { ...receipt, requestId: firstSolar },
      ]) {
        state.heldWrite = undefined;
        await retry.click();
        await confirm().click();
        await expect.poll(() => !!state.heldWrite).toBe(true);
        await state.heldWrite!.fulfill({ json: jsonbOrder(malformed) });
        await expect(retry).toBeEnabled();
        await expect(field('title')).toBeDisabled();
      }
      state.writeMode = 'owned';
      await retry.click();
      await confirm().click();
      await expect(cancel()).toBeEnabled();
      await cancel().click();
      await expect(retry).toBeEnabled();
      state.writeMode = 'success';
      await retry.click();
      await confirm().click();
      await expect(form).toHaveCount(0);
      await expect(page.getByText(copy('solarContractCreated'), { exact: false })).toBeVisible();
      await expect(
        page.getByRole('link', { name: copy('solarViewContract'), exact: true })
      ).toHaveAttribute('href', `/admin/contracts?contractId=${receipt.contractId}`);
      await expect(guidance).toHaveValue('  Independent postal guidance draft  ');
      expect(state.writes.every((call) => call.raw === command.raw)).toBe(true);
      expect(state.writes.slice(1).every((call) => call.csrf === 'solar-contract-rotated')).toBe(
        true
      );
      expect(state.previews).toHaveLength(previewCount);
      expect(state.effects).toBe(1);
      // Current contract authority withdrawal removes the selected private editor.
      await page.getByRole('button', { name: /Older solar buyer/ }).click();
      await expect(field('source')).toBeEnabled();
      await field('title').fill('PRIVATE_CURRENT_SOLAR_DRAFT');
      state.previewMode = 'denied';
      await field('source').selectOption(`template:${templateVersion}`);
      await field('text').fill(terms);
      await field('reason').fill('Current denial proof');
      await field('value-kind').selectOption('fixed');
      await field('fixed-amount').fill('1');
      await line(0, 'description').fill('Current line');
      await line(0, 'quantity').fill('1');
      await line(0, 'unit-price').fill('1');
      await submit.click();
      await expect(form).toHaveCount(0);
      await expect(page.locator('#admin-content')).not.toContainText('PRIVATE_CURRENT_SOLAR_DRAFT');
    });
  }
}

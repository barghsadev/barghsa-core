import { expect, it } from 'vitest';
import { agreementFormSchema, inventoryFormSchema } from './catalogue-form-schemas.js';
import {
  inventoryInteger,
  matchesAgreementReceipt,
  matchesInventoryReceipt,
  validAgreementConfig,
  validInventory,
} from './saving-catalogue-form.js';
import {
  savingAgreement as agreement,
  savingAgreementConfig as config,
  savingInventory as inventory,
} from '../test/saving-catalogue-fixtures.js';
import { catalogueId, hardwareId, secondCatalogueId } from '../test/catalogue-fixtures.js';
it.each(['0', ' ۰۰۰ ', '٠', '1000000'])('accepts exact localized count %s', (raw) =>
  expect(inventoryInteger(raw, 0, 1_000_000)).not.toBeNull()
);
it.each(['', '1e3', '1.0', '-1', '1000001', '9007199254740993'])(
  'rejects non-whole or excessive stock %s',
  (raw) => expect(inventoryInteger(raw, 0, 1_000_000)).toBeNull()
);
it('validates trimmed agreement lengths and both owned field paths', () => {
  const schema = agreementFormSchema({ title: 'title', body: 'body' });
  expect(
    schema.safeParse({ title: ' ' + 'a'.repeat(300) + ' ', body: ' ' + 'b'.repeat(50_000) + ' ' })
      .success
  ).toBe(true);
  const invalid = schema.safeParse({ title: ' ', body: 'b'.repeat(50_001) });
  expect(invalid.success).toBe(false);
  if (!invalid.success)
    expect(invalid.error.issues.map((issue) => issue.path)).toEqual([['title'], ['body']]);
});
it('reports reserved stock, tracking and duration independently and accepts localized bounds', () => {
  const schema = inventoryFormSchema(
    2,
    { stockTracking: 'tracking', stockCount: 'count', reservationMinutes: 'minutes' },
    inventoryInteger
  );
  const invalid = schema.safeParse({
    stockTracking: false,
    stockCount: '1',
    reservationMinutes: '4',
  });
  expect(invalid.success).toBe(false);
  if (!invalid.success)
    expect(invalid.error.issues.map((issue) => issue.path)).toEqual([
      ['stockTracking'],
      ['stockCount'],
      ['reservationMinutes'],
    ]);
  expect(
    schema.safeParse({ stockTracking: true, stockCount: ' ۲ ', reservationMinutes: '١٠٠٨٠' })
      .success
  ).toBe(true);
});
it('accepts only complete unique agreement configuration for its plan', () => {
  expect(validAgreementConfig(config)).toBe(true);
  for (const value of [
    { agreements: [] },
    { ...config, agreements: [agreement, agreement] },
    { ...config, agreements: [{ ...agreement, plan_id: secondCatalogueId }] },
    { ...config, agreements: [{ ...agreement, status: 'active' }] },
  ])
    expect(validAgreementConfig(value)).toBe(false);
});
it('verifies immutable draft or activated receipts with plan, version and complete text', () => {
  expect(matchesAgreementReceipt(agreement, catalogueId, agreement)).toBe(true);
  expect(
    matchesAgreementReceipt(
      { ...agreement, status: 'active', effective_from: '2026-10-03T00:00:00Z' },
      catalogueId,
      agreement,
      agreement.id
    )
  ).toBe(true);
  for (const value of [
    { id: agreement.id, status: 'draft' },
    { ...agreement, body: 'wrong' },
    { ...agreement, plan_id: secondCatalogueId },
  ])
    expect(matchesAgreementReceipt(value, catalogueId, agreement)).toBe(false);
  expect(
    matchesAgreementReceipt(
      { ...agreement, status: 'active', effective_from: '2026-10-03T00:00:00Z' },
      catalogueId,
      agreement,
      secondCatalogueId
    )
  ).toBe(false);
});
it('inventory DTO and receipt require hardware identity, constraints and captured counts', () => {
  const draft = { stockTracking: true, stockCount: '۱۰', reservationMinutes: '٣٠' };
  expect(matchesInventoryReceipt(inventory, hardwareId, draft)).toBe(true);
  for (const value of [
    { ...inventory, hardwareId: secondCatalogueId },
    { ...inventory, stockCount: 11 },
    { ...inventory, reservedCount: 11 },
    { ...inventory, stockTracking: false },
    { ...inventory, reservationMinutes: 4 },
  ])
    expect(matchesInventoryReceipt(value, hardwareId, draft)).toBe(false);
  expect(validInventory({ ...inventory, reservedCount: -1 })).toBe(false);
});

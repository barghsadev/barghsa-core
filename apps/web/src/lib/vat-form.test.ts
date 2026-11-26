import { expect, it } from 'vitest';
import {
  vatBasisPoints,
  vatDraftInstant,
  vatDefaults,
  vatOverrideRateChoice,
  type VatFormContext,
} from './vat-form.js';
import { vatFormSchema } from './vat-form-schema.js';

it.each([
  ['۰۷٫۲۵', 725],
  ['٧.٢٥', 725],
  [' .5 ', 50],
  ['0', 0],
  ['100.00', 10000],
  ['1.234', null],
  ['100.01', null],
  ['-1', null],
  ['1e2', null],
  ['', null],
])('validates exact localized percentage %s', (raw, expected) => {
  expect(vatBasisPoints(raw)).toBe(expected);
});

it('follows the linked-rate rules at exact override window boundaries', () => {
  const window = {
    category: 'hardware' as const,
    effectiveFrom: '2026-11-26T15:00:00.000Z',
    effectiveUntil: '2026-11-27T15:00:00.000Z',
  };
  const productRate = { ...window, category: 'product_override' as const };
  const before = new Date('2026-11-26T14:59:59.999Z');
  expect(vatOverrideRateChoice(window, before)).toBe('unavailable');
  expect(vatOverrideRateChoice(productRate, before)).toBe('later');
  expect(vatOverrideRateChoice(window, new Date(window.effectiveFrom))).toBe('available');
  expect(vatOverrideRateChoice(productRate, new Date(window.effectiveUntil))).toBe('unavailable');
});
const parse = { basisPoints: vatBasisPoints, instant: vatDraftInstant };
const context: VatFormContext = {
  kind: 'override',
  categories: ['electricity'],
  productIds: ['p'],
  rateIds: ['r'],
  resolveDate: () => undefined,
};
const messages = Object.fromEntries(Object.keys(vatDefaults).map((key) => [key, key])) as Record<
  keyof typeof vatDefaults,
  string
>;
it('reports both missing override choices and both empty scheduled inputs', () => {
  const result = vatFormSchema(context, messages, parse).safeParse({
    ...vatDefaults,
    scheduled: true,
    time: '',
  });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues.map((issue) => issue.path)).toEqual([
      ['productId'],
      ['rateId'],
      ['date'],
      ['time'],
    ]);
});
it('rejects skipped timezone times on the composite date control', () => {
  const result = vatFormSchema(context, messages, parse).safeParse({
    ...vatDefaults,
    productId: 'p',
    rateId: 'r',
    scheduled: true,
    date: new Date(),
    time: '02:30',
  });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toEqual([['date']]);
});
it('immediate end-date forms ignore hidden companion inputs', () => {
  expect(
    vatFormSchema({ ...context, kind: 'endRate' }, messages, parse).safeParse({
      ...vatDefaults,
      percent: 'bad',
      time: 'bad',
    }).success
  ).toBe(true);
});

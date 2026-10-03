import { expect, it } from 'vitest';
import {
  catalogueInteger,
  productDefaults,
  priceDefaults,
  categoryOptions,
  detailBasis,
  validDetail,
  validProducts,
  matchesProductReceipt,
  matchesPriceReceipt,
} from './catalogue-form.js';
import { productFormSchema, priceFormSchema } from './catalogue-form-schemas.js';
import { catalogueDetail, catalogueProduct, hardwareId } from '../test/catalogue-fixtures.js';
const messages = Object.fromEntries(
  Object.keys(productDefaults).map((key) => [key, key])
) as Record<keyof typeof productDefaults, string>;
const context = {
  type: 'saving_plan' as const,
  isNew: true,
  categories: [],
  hardwareIds: [hardwareId],
};
const draft = {
  ...productDefaults,
  titleFa: ' محصول ',
  titleEn: ' Product ',
  hardwareIds: [hardwareId],
  price: ' ۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳ ',
};
it('keeps large localized integer amounts exact and accepts zero without decimal/exponent coercion', () => {
  expect(catalogueInteger(draft.price)).toBe('9007199254740993');
  expect(catalogueInteger('٠٠١٢٣')).toBe('123');
  expect(catalogueInteger('۰')).toBe('0');
  for (const invalid of ['', '-1', '1.2', '1e3', '1,000', '1000000000000000000'])
    expect(catalogueInteger(invalid)).toBeNull();
});
it('validates bilingual title limits and descriptions without changing the raw draft', () => {
  const schema = productFormSchema(context, messages, catalogueInteger);
  expect(schema.safeParse(draft).success).toBe(true);
  const result = schema.safeParse({
    ...draft,
    titleFa: ' ',
    titleEn: 'x'.repeat(301),
    descriptionEn: 'x'.repeat(4001),
  });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues.map((issue) => issue.path[0])).toEqual([
      'titleFa',
      'titleEn',
      'descriptionEn',
    ]);
  expect(draft.price).toBe(' ۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳ ');
});
it.each([[], [hardwareId, hardwareId], ['withdrawn']].map((hardwareIds) => ({ hardwareIds })))(
  'requires unique available hardware selections (%j)',
  ({ hardwareIds }) => {
    expect(
      productFormSchema(context, messages, catalogueInteger).safeParse({ ...draft, hardwareIds })
        .success
    ).toBe(false);
  }
);
it('rejects unavailable categories and accepts the consultation category set', () => {
  const schema = productFormSchema(
    { ...context, type: 'consultation', categories: categoryOptions.consultation },
    messages,
    catalogueInteger
  );
  expect(
    schema.safeParse({ ...draft, categories: [categoryOptions.consultation[0]!] }).success
  ).toBe(true);
  expect(schema.safeParse({ ...draft, categories: ['thermal_electricity'] }).success).toBe(false);
});
it('compares exact electricity bounds and supports an unbounded maximum', () => {
  const schema = productFormSchema(
    { ...context, type: 'electricity', isNew: false },
    messages,
    catalogueInteger
  );
  const limits = {
    ...draft,
    configureLimits: true,
    minKwh: '9007199254740993',
    maxKwh: '9007199254740992',
  };
  const parsed = schema.safeParse(limits);
  expect(parsed.success).toBe(false);
  if (!parsed.success)
    expect(parsed.error.issues.map((issue) => issue.path[0])).toEqual(['minKwh', 'maxKwh']);
  expect(schema.safeParse({ ...limits, maxKwh: '۰' }).success).toBe(true);
  expect(schema.safeParse({ ...limits, minKwh: '0', maxKwh: '0' }).success).toBe(false);
});
it('scheduled price validation rejects missing dates, invalid time and nonexistent wall time', () => {
  const schema = priceFormSchema(
    { price: 'price', scheduled: 'scheduled', date: 'date', time: 'time' },
    catalogueInteger,
    () => null
  );
  expect(schema.safeParse({ ...priceDefaults, price: '۱۲۳' }).success).toBe(true);
  for (const value of [
    { ...priceDefaults, price: '1', scheduled: true },
    { ...priceDefaults, price: '1', scheduled: true, date: new Date(), time: '25:00' },
    { ...priceDefaults, price: '1', scheduled: true, date: new Date(), time: '02:30' },
  ])
    expect(schema.safeParse(value).success).toBe(false);
});
it('rejects malformed or wrong-type reads and retains only valid version windows', () => {
  expect(validProducts([catalogueProduct('hardware')], 'consultation')).toBe(false);
  expect(
    validDetail({
      ...catalogueDetail(),
      priceHistory: [
        { id: 'v', price: '1', effectiveFrom: '2026-01-02', effectiveUntil: '2026-01-01' },
      ],
    })
  ).toBe(false);
  expect(validDetail(catalogueDetail())).toBe(true);
});
it('ignores audit timestamps and ordering but detects changes to rules, selections and financial versions', () => {
  const value = catalogueDetail('saving_plan');
  const refs = { greenModes: ['a', 'b'], vatOverride: false };
  const config = { hardwareIds: [hardwareId], preventActiveDuplicates: true };
  const basis = detailBasis(value, refs, config);
  expect(
    detailBasis(
      { ...value, updatedAt: 'later' } as typeof value,
      { ...refs, greenModes: ['b', 'a'] },
      config
    )
  ).toBe(basis);
  expect(detailBasis(value, { ...refs, vatOverride: true }, config)).not.toBe(basis);
  expect(detailBasis(value, refs, { ...config, hardwareIds: [] })).not.toBe(basis);
});
it('accepts a persisted saving-plan receipt and rejects dropped selections or changed product identity', () => {
  const selected = catalogueDetail('saving_plan');
  const body = {
    title: selected.title,
    description: selected.description,
    categories: [],
    hardwareIds: [hardwareId],
  };
  const receipt = { ...selected, hardwareIds: [hardwareId] };
  expect(matchesProductReceipt(body, receipt, selected, 'saving_plan')).toBe(true);
  expect(matchesProductReceipt(body, selected, selected, 'saving_plan')).toBe(false);
  expect(
    matchesProductReceipt(body, { ...receipt, hardwareIds: [] }, selected, 'saving_plan')
  ).toBe(false);
  expect(matchesProductReceipt(body, { ...receipt, id: 'wrong' }, selected, 'saving_plan')).toBe(
    false
  );
});
it('creation acknowledgement must match initial exact price and inactive status', () => {
  const body = {
    title: { fa: 'محصول', en: 'Product' },
    description: { fa: '', en: '' },
    categories: [],
    price: '9007199254740993',
    status: 'inactive',
  };
  const receipt = { ...catalogueDetail(), ...body };
  expect(matchesProductReceipt(body, receipt, null, 'consultation')).toBe(true);
  expect(
    matchesProductReceipt(body, { ...receipt, price: '9007199254740992' }, null, 'consultation')
  ).toBe(false);
  expect(matchesProductReceipt(body, { ...receipt, status: 'active' }, null, 'consultation')).toBe(
    false
  );
});
it('accepts future price history without requiring the legacy price cache to change and permits identical-price no-ops', () => {
  const selected = catalogueDetail();
  const version = {
    id: 'v1',
    price: '9007199254740993',
    effectiveFrom: '2026-11-01T00:00:00.000Z',
    effectiveUntil: null,
  };
  const body = { price: version.price, effectiveFrom: version.effectiveFrom };
  const receipt = { ...selected, priceHistory: [version] };
  expect(matchesPriceReceipt(body, receipt, selected)).toBe(true);
  expect(
    matchesPriceReceipt(
      body,
      { ...receipt, priceHistory: [{ ...version, effectiveFrom: '2026-12-01T00:00:00Z' }] },
      selected
    )
  ).toBe(false);
  expect(
    matchesPriceReceipt({ ...body, effectiveFrom: '2026-12-01T00:00:00Z' }, receipt, receipt)
  ).toBe(true);
  expect(
    matchesPriceReceipt(body, { ...receipt, priceHistory: [{ ...version, price: '1' }] }, selected)
  ).toBe(false);
});

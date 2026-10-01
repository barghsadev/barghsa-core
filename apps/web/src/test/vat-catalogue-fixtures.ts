export const vatRate = {
  id: '01900000-0000-7000-8000-000000000001',
  category: 'hardware',
  rateBasisPoints: 900,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveUntil: null,
  status: 'current',
};
export const electricityVatRate = {
  ...vatRate,
  id: '01900000-0000-7000-8000-000000000002',
  category: 'electricity',
};
export const vatProduct = {
  id: '01900000-0000-7000-8000-000000000003',
  type: 'hardware',
  title: { en: 'Meter kit', fa: 'بسته کنتور' },
};
export const vatOverride = {
  id: '01900000-0000-7000-8000-000000000004',
  productId: vatProduct.id,
  vatConfigId: vatRate.id,
  rateBasisPoints: 900,
  effectiveFrom: '2026-01-02T00:00:00.000Z',
  effectiveUntil: null,
};

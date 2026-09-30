export const catalogueBase = '/api/admin/catalogue/products';
export const catalogueTypes = ['consultation', 'electricity', 'hardware', 'saving_plan'] as const;
export type CatalogueType = (typeof catalogueTypes)[number];
export const catalogueId = '85000000-0000-4000-8000-000000000001';
export const secondCatalogueId = '85000000-0000-4000-8000-000000000002';
export const hardwareId = '85000000-0000-4000-8000-000000000003';
export function catalogueProduct(type: CatalogueType = 'consultation', id = catalogueId) {
  return {
    id,
    type,
    systemKey: type === 'electricity' ? 'thermal' : null,
    title: {
      fa: 'محصول نمونه',
      en: id === secondCatalogueId ? 'Second product' : 'Sample product',
    },
    description: { fa: 'توضیح محصول', en: 'Product description' },
    price: '15000',
    status: 'active' as const,
    categories: [],
    electricityLimits: type === 'electricity' ? { minKwh: '100', maxKwh: '5000' } : null,
  };
}
export function catalogueDetail(type: CatalogueType = 'consultation', id = catalogueId) {
  return { ...catalogueProduct(type, id), priceHistory: [], electricityLimitHistory: [] };
}
export const catalogueReferences = { greenModes: [], vatOverride: false };
export const catalogueConfig = {
  hardwareIds: [hardwareId],
  preventActiveDuplicates: true,
  agreements: [],
};

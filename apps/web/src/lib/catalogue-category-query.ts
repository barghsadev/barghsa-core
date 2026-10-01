import { listChoice, type ListQueryOptions } from './list-query.js';

export const productCatalogueTypes = [
  'consultation',
  'electricity',
  'hardware',
  'saving_plan',
] as const;
export type ProductCatalogueType = (typeof productCatalogueTypes)[number];
export type KnowledgeCatalogueKind = 'knowledge-bases' | 'kb-groups';
export type PolicyCatalogueKind = 'policies' | 'policy-groups';

const base: ListQueryOptions = {
  searchLimit: 0,
  filters: {},
  sortFields: [],
  defaultSort: '',
  pageSizes: [25],
  defaultPageSize: 25,
  pagination: 'page',
};
export const productCatalogueQueryOptions: ListQueryOptions = {
  ...base,
  filters: { type: listChoice(productCatalogueTypes.slice(1)) },
};
export const knowledgeCatalogueQueryOptions: ListQueryOptions = {
  ...base,
  filters: { kind: listChoice(['kb-groups']) },
};
export const policyCatalogueQueryOptions: ListQueryOptions = {
  ...base,
  filters: { kind: listChoice(['policy-groups']) },
};
export function productCatalogueSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const type = productCatalogueQueryOptions.filters.type!(raw.type);
  return type ? { type } : {};
}
export function knowledgeCatalogueSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const kind = knowledgeCatalogueQueryOptions.filters.kind!(raw.kind);
  return kind ? { kind } : {};
}
export function policyCatalogueSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const kind = policyCatalogueQueryOptions.filters.kind!(raw.kind);
  return kind ? { kind } : {};
}

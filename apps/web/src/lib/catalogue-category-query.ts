import {
  CATALOGUE_SEARCH_LIMIT,
  CATALOGUE_SORT_FIELDS,
  CATALOGUE_PAGE_SIZES,
  CATALOGUE_STATUSES,
} from '@barghsa/shared/catalogue-query';
import { listChoice, parseListQuery, writeListQuery, type ListQueryOptions } from './list-query.js';

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
  searchLimit: CATALOGUE_SEARCH_LIMIT,
  sortFields: CATALOGUE_SORT_FIELDS,
  defaultSort: 'createdAt',
  pageSizes: CATALOGUE_PAGE_SIZES,
  filters: {
    type: listChoice(productCatalogueTypes.slice(1)),
    status: listChoice(CATALOGUE_STATUSES),
  },
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
  const query = parseListQuery(raw, productCatalogueQueryOptions);
  return Object.fromEntries(
    Object.entries(writeListQuery(raw, productCatalogueQueryOptions, query)).filter(
      ([key, value]) =>
        ['q', 'sort', 'order', 'page', 'pageSize', 'type', 'status'].includes(key) &&
        value !== undefined
    )
  );
}
export function knowledgeCatalogueSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const kind = knowledgeCatalogueQueryOptions.filters.kind!(raw.kind);
  return kind ? { kind } : {};
}
export function policyCatalogueSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const kind = policyCatalogueQueryOptions.filters.kind!(raw.kind);
  return kind ? { kind } : {};
}

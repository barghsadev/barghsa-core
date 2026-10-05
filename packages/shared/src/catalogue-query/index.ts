export const CATALOGUE_SEARCH_LIMIT = 200;
export const CATALOGUE_SORT_FIELDS = ['createdAt', 'titleFa', 'titleEn', 'price'] as const;
export const CATALOGUE_PAGE_SIZES = [25, 50, 100] as const;
export const CATALOGUE_STATUSES = ['active', 'inactive', 'archived'] as const;
export const CATALOGUE_TYPES = ['consultation', 'electricity', 'hardware', 'saving_plan'] as const;
export interface CatalogueListQuery {
  type?: (typeof CATALOGUE_TYPES)[number];
  search: string;
  status: '' | (typeof CATALOGUE_STATUSES)[number];
  sort: (typeof CATALOGUE_SORT_FIELDS)[number];
  order: 'asc' | 'desc';
  page: number;
  limit: number;
}
export function parseCatalogueListQuery(raw: Record<string, unknown>): CatalogueListQuery | null {
  if (
    Object.keys(raw).some(
      (key) => !['type', 'search', 'status', 'sort', 'order', 'page', 'limit'].includes(key)
    )
  )
    return null;
  const {
    type,
    search = '',
    status = '',
    sort = 'createdAt',
    order = 'desc',
    page = '1',
    limit = '25',
  } = raw;
  const integer = (value: unknown, max: number) => {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text !== 'string' || !/^\d{1,7}$/.test(text)) return null;
    const n = Number(text);
    return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : null;
  };
  const parsedPage = integer(page, 1_000_000),
    parsedLimit = integer(limit, 100);
  if (
    (type !== undefined && !CATALOGUE_TYPES.includes(type as never)) ||
    typeof search !== 'string' ||
    search.trim().length > CATALOGUE_SEARCH_LIMIT ||
    (status !== '' && !CATALOGUE_STATUSES.includes(status as never)) ||
    !CATALOGUE_SORT_FIELDS.includes(sort as never) ||
    (order !== 'asc' && order !== 'desc') ||
    parsedPage === null ||
    parsedLimit === null
  )
    return null;
  return {
    ...(type !== undefined ? { type: type as CatalogueListQuery['type'] & string } : {}),
    search: search.trim(),
    status: status as CatalogueListQuery['status'],
    sort: sort as CatalogueListQuery['sort'],
    order,
    page: parsedPage,
    limit: parsedLimit,
  };
}

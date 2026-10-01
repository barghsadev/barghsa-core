export interface ListQueryOptions {
  prefix?: string;
  searchLimit: number;
  filters: Readonly<Record<string, (value: unknown) => string>>;
  sortFields: readonly string[];
  defaultSort: string;
  defaultOrder?: 'asc' | 'desc';
  pageSizes: readonly number[];
  defaultPageSize: number;
  pagination: 'page' | 'cursor';
}
export interface ListQueryState {
  search: string;
  sort: string;
  order: 'asc' | 'desc';
  filters: Record<string, string>;
  page: number;
  pageSize: number;
  cursor: string;
}
export type ListQueryPatch = Partial<Omit<ListQueryState, 'filters'>> & {
  filters?: Record<string, string>;
};
export type Search = Record<string, unknown>;

export const listText = (limit: number) => (value: unknown) =>
  typeof value === 'string' && value.length <= limit ? value.trim() : '';
export const listChoice = (values: readonly string[]) => (value: unknown) =>
  typeof value === 'string' && values.includes(value) ? value : '';
export function listPage(value: unknown): number {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,7}$/.test(value)
        ? Number(value)
        : 0;
  return Number.isSafeInteger(number) && number > 0 && number <= 1_000_000 ? number : 1;
}

export function parseListQuery(raw: Search, options: ListQueryOptions): ListQueryState {
  const read = (key: string) => raw[(options.prefix ?? '') + key];
  const sizeValue = read('pageSize');
  const size =
    typeof sizeValue === 'number'
      ? sizeValue
      : typeof sizeValue === 'string' && /^\d{1,4}$/.test(sizeValue)
        ? Number(sizeValue)
        : 0;
  const cursor = read('cursor');
  const order = read('order');
  return {
    search: listText(options.searchLimit)(read('q')),
    sort: listChoice(options.sortFields)(read('sort')) || options.defaultSort,
    order: order === 'asc' || order === 'desc' ? order : (options.defaultOrder ?? 'desc'),
    filters: Object.fromEntries(
      Object.entries(options.filters).map(([key, parse]) => [key, parse(read(key))])
    ),
    page: options.pagination === 'page' ? listPage(read('page')) : 1,
    pageSize: options.pageSizes.includes(size) ? size : options.defaultPageSize,
    cursor:
      options.pagination === 'cursor' && typeof cursor === 'string' && cursor.length <= 4096
        ? cursor
        : '',
  };
}

/** Only the owning list's keys change; other lists and route context survive. */
export function writeListQuery(
  raw: Search,
  options: ListQueryOptions,
  patch: ListQueryPatch
): Search {
  const before = parseListQuery(raw, options);
  const next = { ...before, ...patch, filters: { ...before.filters, ...patch.filters } };
  const criteriaChanged =
    ['search', 'sort', 'order', 'pageSize'].some(
      (key) => before[key as keyof ListQueryState] !== next[key as keyof ListQueryState]
    ) || Object.keys(options.filters).some((key) => before.filters[key] !== next.filters[key]);
  if (criteriaChanged) {
    next.page = 1;
    next.cursor = '';
  }
  const prefix = options.prefix ?? '';
  const serialize = (state: ListQueryState): Search => ({
    ...raw,
    [prefix + 'q']: state.search || undefined,
    [prefix + 'sort']: state.sort === options.defaultSort ? undefined : state.sort,
    [prefix + 'order']: state.order === (options.defaultOrder ?? 'desc') ? undefined : state.order,
    [prefix + 'page']: options.pagination === 'page' && state.page !== 1 ? state.page : undefined,
    [prefix + 'pageSize']: state.pageSize === options.defaultPageSize ? undefined : state.pageSize,
    [prefix + 'cursor']: options.pagination === 'cursor' ? state.cursor || undefined : undefined,
    ...Object.fromEntries(
      Object.keys(options.filters).map((key) => [prefix + key, state.filters[key] || undefined])
    ),
  });
  // Apply the same validation to UI updates and direct links.
  return serialize(parseListQuery(serialize(next), options));
}

import { useEffect, useMemo, useRef, useState } from 'react';

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
type Search = Record<string, unknown>;
type Navigation = (change: (current: Search) => Search, options?: { replace?: boolean }) => void;

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
  return {
    search: listText(options.searchLimit)(read('q')),
    sort: listChoice(options.sortFields)(read('sort')) || options.defaultSort,
    order:
      read('order') === 'asc' || read('order') === 'desc'
        ? (read('order') as 'asc' | 'desc')
        : (options.defaultOrder ?? 'desc'),
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
  const serialize = (state: ListQueryState): Search => {
    const result: Search = { ...raw };
    const set = (key: string, value: unknown) => {
      result[prefix + key] = value;
    };
    set('q', state.search || undefined);
    set('sort', state.sort === options.defaultSort ? undefined : state.sort);
    set('order', state.order === (options.defaultOrder ?? 'desc') ? undefined : state.order);
    set('page', options.pagination === 'page' && state.page !== 1 ? state.page : undefined);
    set('pageSize', state.pageSize === options.defaultPageSize ? undefined : state.pageSize);
    set('cursor', options.pagination === 'cursor' ? state.cursor || undefined : undefined);
    for (const key of Object.keys(options.filters)) set(key, state.filters[key] || undefined);
    return result;
  };
  // Apply the same validation to UI updates and direct links.
  return serialize(parseListQuery(serialize(next), options));
}

/** Route adapters pass their router search and navigation, keeping list views testable. */
export function useListQuery(options: ListQueryOptions, raw: Search, navigate: Navigation) {
  const query = useMemo(() => parseListQuery(raw, options), [raw, options]);
  const key = JSON.stringify(query);
  const [draft, setDraft] = useState({ basis: key, value: query.search });
  if (draft.basis !== key) setDraft({ basis: key, value: query.search });
  const searchInput = draft.basis === key ? draft.value : query.search;
  const navigation = useRef(navigate);
  navigation.current = navigate;
  const setQuery = (patch: ListQueryPatch, replace = false) =>
    navigation.current(
      (current) =>
        writeListQuery(current, options, {
          ...(searchInput.trim() !== query.search ? { search: searchInput } : {}),
          ...patch,
        }),
      { replace }
    );
  const commitSearch = useRef(setQuery);
  commitSearch.current = setQuery;
  useEffect(() => {
    if (searchInput.trim() === query.search) return;
    const timer = setTimeout(() => commitSearch.current({ search: searchInput }), 300);
    return () => clearTimeout(timer);
  }, [searchInput, query.search, key]);
  const criteria = JSON.stringify([
    query.search,
    query.sort,
    query.order,
    query.filters,
    query.pageSize,
  ]);
  const [trail, setTrail] = useState({ criteria, cursors: [query.cursor] });
  let cursors = trail.cursors;
  if (trail.criteria !== criteria) {
    cursors = [query.cursor];
    setTrail({ criteria, cursors });
  } else if (cursors.at(-1) !== query.cursor) {
    const known = cursors.indexOf(query.cursor);
    cursors = !query.cursor
      ? ['']
      : known >= 0
        ? cursors.slice(0, known + 1)
        : [...cursors, query.cursor].slice(-100);
    setTrail({ criteria, cursors });
  }
  const params = new URLSearchParams({ limit: String(query.pageSize) });
  if (query.search) params.set('search', query.search);
  if (query.sort) {
    params.set('sort', query.sort);
    params.set('order', query.order);
  }
  for (const [key, value] of Object.entries(query.filters)) if (value) params.set(key, value);
  if (options.pagination === 'page') params.set('page', String(query.page));
  else if (query.cursor) params.set('cursor', query.cursor);
  return {
    query,
    params,
    searchInput,
    setSearchInput: (value: string) =>
      setDraft({ basis: key, value: value.slice(0, options.searchLimit) }),
    setQuery,
    clear: () =>
      setQuery({
        search: '',
        sort: options.defaultSort,
        order: options.defaultOrder ?? 'desc',
        filters: Object.fromEntries(Object.keys(options.filters).map((key) => [key, ''])),
        page: 1,
        pageSize: options.defaultPageSize,
        cursor: '',
      }),
    hasPrevious: cursors.length > 1,
    previous: () => {
      if (cursors.length > 1) setQuery({ cursor: cursors.at(-2)! });
    },
    canAdvance: (cursor: string | null) => !!cursor && !cursors.includes(cursor),
    next: (cursor: string) => {
      if (cursor && !cursors.includes(cursor)) setQuery({ cursor });
    },
  };
}
export type ListQueryBinding = ReturnType<typeof useListQuery>;

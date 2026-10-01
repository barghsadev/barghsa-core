import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseListQuery,
  writeListQuery,
  type ListQueryOptions,
  type ListQueryPatch,
  type Search,
} from '../lib/list-query.js';
export {
  listChoice,
  listPage,
  listText,
  parseListQuery,
  writeListQuery,
} from '../lib/list-query.js';
export type { ListQueryOptions, ListQueryState, ListQueryPatch } from '../lib/list-query.js';

type Navigation = (change: (current: Search) => Search, options?: { replace?: boolean }) => void;

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

export const HISTORY_SORT_OPTIONS = ['submitted_at:desc', 'submitted_at:asc'] as const;
export type HistorySort = (typeof HISTORY_SORT_OPTIONS)[number];
export const DEFAULT_HISTORY_SORT: HistorySort = 'submitted_at:desc';
export interface HistoryQuery {
  q: string;
  sort: HistorySort;
}

export function parseHistoryQuery(q: unknown, sort: unknown): HistoryQuery | null {
  const text = q === undefined ? '' : q;
  const order = sort === undefined || sort === '' ? DEFAULT_HISTORY_SORT : sort;
  if (
    typeof text !== 'string' ||
    text.length > 120 ||
    Array.from(text).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    !HISTORY_SORT_OPTIONS.includes(order as HistorySort)
  )
    return null;
  return { q: text.trim(), sort: order as HistorySort };
}

/** Treat user text as a literal substring, including %, _ and backslashes. */
export function literalSearchPattern(q: string): string | null {
  return q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
}

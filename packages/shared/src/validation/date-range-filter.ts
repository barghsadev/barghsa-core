/** UTC timestamp bounds; `from` is included and `to` is excluded. */
export interface DateRangeFilterValue {
  from?: string | undefined;
  to?: string | undefined;
}

export function parseDateRangeFilter(from: unknown, to: unknown): DateRangeFilterValue | null {
  const timestamp = (value: unknown) => {
    if (value === undefined || value === '') return undefined;
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      value.startsWith('0000')
    )
      return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
  };
  const start = timestamp(from);
  const end = timestamp(to);
  if (start === null || end === null || (start && end && start >= end)) return null;
  return { from: start, to: end };
}

export type HistoryFilterKey = 'search' | 'status' | 'date' | 'amount' | 'service';

interface HistoryFilterState {
  q?: string | undefined;
  statuses?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  min?: string | undefined;
  max?: string | undefined;
  serviceType?: string | undefined;
}

/** Remove one applied field or status while retaining every other URL selection. */
export function removeHistoryFilter<T extends HistoryFilterState>(
  current: T,
  key: HistoryFilterKey,
  value?: string
): T {
  switch (key) {
    case 'search':
      return { ...current, q: undefined };
    case 'status':
      return {
        ...current,
        statuses:
          current.statuses
            ?.split(',')
            .filter((status) => status !== value)
            .join(',') || undefined,
      };
    case 'date':
      return { ...current, from: undefined, to: undefined };
    case 'amount':
      return { ...current, min: undefined, max: undefined };
    case 'service':
      return { ...current, serviceType: undefined };
  }
}

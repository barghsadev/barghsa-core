import { useLayoutEffect, useRef, useState } from 'react';
import { useProfileContextRevision } from '../lib/profile-context.js';
import type {
  DateRangeFilterValue as DateRangeValue,
  NumberRangeValue,
} from '@barghsa/shared/validation';

export interface HistoryFilterSelection<Q extends { q: string }> {
  query: Q;
  statuses: readonly string[];
  dateRange: DateRangeValue;
  amountRange?: NumberRangeValue | undefined;
}

/** One URL transaction, including the last uncommitted text/date/amount edits. */
export function useHistoryFilterDraft<Q extends { q: string }>(
  applied: HistoryFilterSelection<Q>,
  onApply?: ((selection: HistoryFilterSelection<Q>) => void) | undefined
) {
  const profileRevision = useProfileContextRevision();
  const key = JSON.stringify([profileRevision, applied]);
  const [state, setState] = useState({ key, selection: applied });
  const draft = state.key === key ? state.selection : applied;
  const pending = useRef(draft);
  useLayoutEffect(() => {
    pending.current = draft;
  }, [draft]);
  function stage<K extends keyof HistoryFilterSelection<Q>>(
    field: K,
    value: HistoryFilterSelection<Q>[K]
  ) {
    const selection = { ...pending.current, [field]: value };
    pending.current = selection;
    setState({ key, selection });
  }
  return {
    draft,
    begin: () => {
      pending.current = applied;
      setState({ key, selection: applied });
    },
    apply: () => onApply?.(pending.current),
    setQuery: (query: Q) => stage('query', query),
    setStatuses: (statuses: readonly string[]) => stage('statuses', statuses),
    setDateRange: (dateRange: DateRangeValue) => stage('dateRange', dateRange),
    setAmountRange: (amountRange: NumberRangeValue) => stage('amountRange', amountRange),
  };
}

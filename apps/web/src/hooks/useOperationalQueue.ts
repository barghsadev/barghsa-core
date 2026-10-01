import { useCallback, useEffect, useState } from 'react';
import { useCatalogueResource, useCatalogueScope } from './useCatalogueResource.js';

type QueueAccess = { canView: boolean; canRetry: boolean };
const isAccess = (value: unknown): value is QueueAccess =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as QueueAccess).canView === 'boolean' &&
  typeof (value as QueueAccess).canRetry === 'boolean';

/** Independent authority/queue recovery; failed navigation retains the accepted page. */
export function useOperationalQueue<T extends { id: string }>(
  endpoint: string,
  criteria: string,
  offset: number,
  validate: (value: unknown) => value is T,
  clearPrivate: () => void
) {
  const scope = useCatalogueScope(clearPrivate);
  const { live, version, denied, deny } = scope;
  const access = useCatalogueResource(scope, `${endpoint}/access`, isAccess);
  const canView = !denied && access.data?.canView === true;
  const [revision, setRevision] = useState(0);
  const key = `${version}:${endpoint}:${criteria}`;
  const [accepted, setAccepted] = useState<{
    key: string;
    offset: number;
    rows: T[];
    hasMore: boolean;
  } | null>(null);
  const [state, setState] = useState<{
    key: string;
    offset: number;
    loading: boolean;
    error: boolean;
  } | null>(null);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (access.data && !access.data.canView) deny();
  }, [access.data, deny]);
  useEffect(() => {
    if (!canView) {
      if (denied) {
        setAccepted(null);
        setState(null);
      }
      return;
    }
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && live.current === version;
    const query = new URLSearchParams(criteria);
    query.set('limit', '26');
    query.set('offset', String(offset));
    setState({ key, offset, loading: true, error: false });
    void (async () => {
      try {
        const response = await fetch(`${endpoint}?${query}`, { signal: controller.signal });
        if (!current()) return;
        if (response.status === 401 || response.status === 403) {
          deny();
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const rows: unknown = await response.json();
        if (!current()) return;
        if (
          !Array.isArray(rows) ||
          rows.length > 26 ||
          !rows.every(validate) ||
          new Set(rows.map((row) => row.id)).size !== rows.length
        )
          throw new Error('Invalid queue');
        setAccepted({ key, offset, rows: rows.slice(0, 25), hasMore: rows.length > 25 });
        setState({ key, offset, loading: false, error: false });
      } catch {
        if (current()) setState({ key, offset, loading: false, error: true });
      }
    })();
    return () => controller.abort();
  }, [canView, denied, endpoint, criteria, offset, key, live, version, deny, revision, validate]);
  const data = canView && accepted?.key === key ? accepted : null;
  const status = canView && state?.key === key && state.offset === offset ? state : null;
  const loading = canView && (status?.loading ?? true);
  const error = status?.error ?? false;
  const ready = canView && !!data && !loading && !error && !access.loading && !access.error;
  function refresh() {
    if (denied) scope.recover();
    else {
      access.retry();
      retry();
    }
  }
  return {
    data,
    access,
    canView,
    canRetry: ready && access.data?.canRetry === true,
    ready,
    loading,
    error,
    denied,
    retry,
    refresh,
    deny,
  };
}

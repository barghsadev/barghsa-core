import { useCallback, useEffect, useState } from 'react';
import { GeographyRequestError, type Province } from '../lib/geography-api.js';
import type { useCatalogueScope } from './useCatalogueResource.js';

export const geographyBasis = (row: Province) =>
  JSON.stringify([row.id, row.nameFa, row.nameEn, row.status]);
export type GeographyScope = ReturnType<typeof useCatalogueScope>;
export type GeographyPage<T extends Province> = { rows: T[]; total: number };
/** Failed page navigation retains the accepted page; changed criteria or authority cannot reuse it. */
export function useGeographyList<T extends Province>(
  scope: GeographyScope,
  criteria: string,
  page: number,
  load: (page: number, signal: AbortSignal) => Promise<GeographyPage<T>>,
  setPage: (page: number) => void
) {
  const { live, version, denied, deny } = scope;
  const key = `${version}:${criteria}`;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    page: number;
    data: GeographyPage<T>;
  } | null>(null);
  const [status, setStatus] = useState<{
    key: string;
    page: number;
    loading: boolean;
    error: boolean;
  } | null>(null);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (denied) {
      setResult(null);
      setStatus(null);
      return;
    }
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && live.current === version;
    setStatus({ key, page, loading: true, error: false });
    void load(page, controller.signal)
      .then((data) => {
        if (!current()) return;
        const last = Math.max(1, Math.ceil(data.total / 20));
        if (page > last) {
          setPage(last);
          return;
        }
        setResult({ key, page, data });
        setStatus({ key, page, loading: false, error: false });
      })
      .catch((cause: unknown) => {
        if (!current()) return;
        if (cause instanceof GeographyRequestError && cause.code === 'denied') {
          deny();
          return;
        }
        setStatus({ key, page, loading: false, error: true });
      });
    return () => controller.abort();
  }, [denied, key, page, load, setPage, live, version, deny, revision]);
  const accepted = !denied && result?.key === key ? result : null;
  const state = !denied && status?.key === key && status.page === page ? status : null;
  return {
    data: accepted?.data ?? null,
    acceptedPage: accepted?.page ?? page,
    loading: !denied && (state?.loading ?? true),
    error: state?.error ?? false,
    retry,
  };
}

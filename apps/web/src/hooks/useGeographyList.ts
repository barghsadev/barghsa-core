import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { GeographyRequestError, type Province } from '../lib/geography-api.js';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { useServerListQuery } from './useServerQuery.js';
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
  const reader = useId();
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const key = JSON.stringify([
    scope.identity,
    reader,
    accountId,
    profileRevision,
    version,
    criteria,
  ]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    page: number;
    request: string;
    data: GeographyPage<T>;
  } | null>(null);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const request = JSON.stringify([key, page, revision]);
  const sequence = useRef({ request, revision: 0 });
  if (sequence.current.request !== request)
    sequence.current = { request, revision: sequence.current.revision + 1 };
  const params = new URLSearchParams({
    reader,
    criteria,
    epoch: String(version),
    page: String(page),
  });
  const query = useServerListQuery<GeographyPage<T>>({
    queryKey: denied
      ? null
      : queryKeys.catalogue.list(
          { context: 'staff', ownerId: scope.identity, accountId, revision: profileRevision },
          params,
          sequence.current.revision
        ),
    manual: true,
    read: (signal) => load(page, signal),
  });
  const forbidden = query.error instanceof GeographyRequestError && query.error.code === 'denied';
  useEffect(() => {
    if (denied) {
      setResult(null);
      return;
    }
    if (live.current !== version) return;
    if (forbidden) {
      deny();
      return;
    }
    if (!query.isSuccess || query.isFetching || query.isPlaceholderData) return;
    const last = Math.max(1, Math.ceil(query.data.total / 20));
    if (page > last) {
      setPage(last);
      return;
    }
    setResult({ key, page, request, data: query.data });
  }, [
    denied,
    key,
    page,
    request,
    setPage,
    live,
    version,
    deny,
    forbidden,
    query.isSuccess,
    query.isFetching,
    query.isPlaceholderData,
    query.data,
  ]);
  const accepted = !denied && !forbidden && result?.key === key ? result : null;
  return {
    data: accepted?.data ?? null,
    acceptedPage: accepted?.page ?? page,
    loading:
      !denied &&
      !forbidden &&
      (query.isPending || query.isFetching || (query.isSuccess && accepted?.request !== request)),
    error: !denied && !forbidden && query.isError,
    retry,
  };
}

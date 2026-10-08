import { useCallback, useId, useRef, useState } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { useServerDetailQuery } from './useServerQuery.js';

export interface GeographyOption {
  id: string;
  nameFa: string;
  nameEn: string;
  provinceId?: string;
}
const empty: GeographyOption[] = [];

/** Shared validated read for selectors and display-only address name lookups. */
export async function loadGeographyOptions(path: string, signal: AbortSignal, provinceId?: string) {
  const response = await fetch(path, { credentials: 'include', signal });
  if (!response.ok) throw new Error('Geography unavailable');
  const data: unknown = await response.json();
  if (
    !Array.isArray(data) ||
    data.some(
      (row) =>
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        ['id', 'nameFa', 'nameEn'].some(
          (key) => typeof row[key] !== 'string' || !row[key].trim()
        ) ||
        (provinceId !== undefined && row.provinceId !== provinceId)
    ) ||
    new Set(data.map((row) => row.id)).size !== data.length
  )
    throw new Error('Invalid geography options');
  return data as GeographyOption[];
}

/** Validate option lists and bind city results to their requested province. */
export function useGeographyOptions(path: string | null, provinceId?: string) {
  const [revision, setRevision] = useState(0);
  const reader = useId();
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const request = JSON.stringify([path, provinceId, revision]);
  const readOwner = useRef({ request, revision: 0 });
  if (readOwner.current.request !== request)
    readOwner.current = { request, revision: readOwner.current.revision + 1 };
  const query = useServerDetailQuery<GeographyOption[]>({
    queryKey: path
      ? queryKeys.catalogue.detail(
          {
            context: 'account',
            ownerId: accountId?.trim() ? accountId : reader,
            accountId,
            revision: profileRevision,
          },
          JSON.stringify([
            path,
            provinceId,
            readOwner.current.revision === 0 ? 0 : [reader, readOwner.current.revision],
          ])
        )
      : null,
    manual: true,
    read: (signal) => loadGeographyOptions(path!, signal, provinceId),
  });
  const loading = path !== null && (query.isPending || query.isFetching);
  const ready = !!path && query.isSuccess && !loading;
  return {
    options: ready ? query.data : empty,
    ready,
    loading,
    error: !!path && query.isError,
    retry,
  };
}

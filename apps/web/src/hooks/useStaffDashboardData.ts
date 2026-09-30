import { useAsyncData, type AsyncData } from './useAsyncData.js';

/** Keep permission denial distinct from service failure; malformed data remains retryable. */
export function staffDashboardReader<T>(parse: (value: unknown) => T | null) {
  return async (response: Response): Promise<T | null> => {
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error('Staff dashboard resource unavailable');
    return parse(await response.json());
  };
}

export function useStaffDashboardData<T>(
  url: string,
  read: (response: Response) => Promise<T | null>,
  retainDataOnRefreshError = false
): AsyncData<T> | null {
  const resource = useAsyncData<T | null>(url, {
    read,
    refreshIntervalMs: 30_000,
    retainDataOnRefreshError,
  });
  if (resource.status !== 'ready') return resource;
  return resource.data === null ? null : { ...resource, data: resource.data };
}

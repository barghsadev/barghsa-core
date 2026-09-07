import { useCallback, useEffect, useState } from 'react';

export interface GeographyOption {
  id: string;
  nameFa: string;
  nameEn: string;
}
interface State {
  path: string | null;
  provinceId: string | undefined;
  status: 'loading' | 'ready' | 'error';
  options: GeographyOption[];
}
const empty: GeographyOption[] = [];

/** Validate option lists and bind city results to their requested province. */
export function useGeographyOptions(path: string | null, provinceId?: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State | null>(null);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!path) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    setState({ path, provinceId, status: 'loading', options: empty });
    void (async () => {
      try {
        const response = await fetch(path, { credentials: 'include', signal: controller.signal });
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
        if (!controller.signal.aborted)
          setState({ path, provinceId, status: 'ready', options: data as GeographyOption[] });
      } catch {
        if (!controller.signal.aborted)
          setState({ path, provinceId, status: 'error', options: empty });
      }
    })();
    return () => controller.abort();
  }, [path, provinceId, revision]);
  const current = path !== null && state?.path === path && state.provinceId === provinceId;
  return {
    options: current ? state.options : empty,
    ready: current && state.status === 'ready',
    loading: path !== null && (!current || state.status === 'loading'),
    error: current && state.status === 'error',
    retry,
  };
}

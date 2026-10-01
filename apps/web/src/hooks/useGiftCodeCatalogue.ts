import { useCallback, useEffect, useRef, useState } from 'react';
import type { GiftCodeDto } from '@barghsa/shared/promotions';
import { GIFT_CODE_PAGE_SIZE, isGiftCodePage } from '../lib/gift-code-catalogue.js';
import type { useCatalogueScope } from './useCatalogueResource.js';
export function giftCodeListPath(filter: string, before?: string): string {
  const query = new URLSearchParams(filter);
  query.set('limit', String(GIFT_CODE_PAGE_SIZE));
  if (before) query.set('before', before);
  return `/api/admin/promotions/gift-codes?${query}`;
}
export function useGiftCodeCatalogue(
  scope: ReturnType<typeof useCatalogueScope>,
  filter: string,
  enabled: boolean
) {
  const { live, version, denied, deny } = scope;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    rows: GiftCodeDto[] | null;
    loading: boolean;
    error: boolean;
    hasMore: boolean;
    more: 'idle' | 'loading' | 'error';
  } | null>(null);
  const key = `${version}:${filter}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const sequence = useRef(0),
    moreBusy = useRef(false);
  const retry = useCallback(() => {
    sequence.current++;
    setAttempt((v) => v + 1);
  }, []);
  useEffect(() => {
    if (denied || !enabled) {
      setResult(null);
      return;
    }
    const controller = new AbortController(),
      read = ++sequence.current;
    moreBusy.current = false;
    const current = () =>
      !controller.signal.aborted &&
      live.current === version &&
      currentKey.current === key &&
      read === sequence.current;
    setResult((old) => ({
      key,
      rows: old?.key === key ? old.rows : null,
      loading: true,
      error: false,
      hasMore: false,
      more: 'idle',
    }));
    void (async () => {
      try {
        const response = await fetch(giftCodeListPath(filter), { signal: controller.signal });
        if (!current()) return;
        if (response.status === 401 || response.status === 403) {
          deny();
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const data: unknown = await response.json();
        if (!current()) return;
        if (!isGiftCodePage(data)) throw new Error('Invalid gift codes');
        setResult({
          key,
          rows: data,
          loading: false,
          error: false,
          hasMore: data.length === GIFT_CODE_PAGE_SIZE,
          more: 'idle',
        });
      } catch {
        if (current())
          setResult((old) => ({
            key,
            rows: old?.key === key ? old.rows : null,
            loading: false,
            error: true,
            hasMore: false,
            more: 'idle',
          }));
      }
    })();
    return () => {
      controller.abort();
      sequence.current++;
    };
  }, [denied, enabled, key, filter, live, version, deny, attempt]);
  const accepted = !denied && enabled && result?.key === key ? result : null;
  const loadMore = async () => {
    if (
      !accepted?.hasMore ||
      !accepted.rows?.length ||
      accepted.loading ||
      accepted.error ||
      moreBusy.current
    )
      return;
    const read = sequence.current,
      cursor = accepted.rows.at(-1)!.id;
    const current = () =>
      live.current === version && currentKey.current === key && read === sequence.current;
    moreBusy.current = true;
    setResult((old) => old && { ...old, more: 'loading' });
    try {
      const response = await fetch(giftCodeListPath(filter, cursor));
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        deny();
        return;
      }
      if (!response.ok) throw new Error('Unavailable');
      const data: unknown = await response.json();
      if (!current()) return;
      if (
        !isGiftCodePage(data) ||
        (data.length === GIFT_CODE_PAGE_SIZE &&
          accepted.rows!.some((r) => r.id === data.at(-1)!.id))
      )
        throw new Error('Invalid next page');
      setResult((old) => {
        if (!old || old.key !== key) return old;
        const known = new Set(old.rows?.map((r) => r.id));
        return {
          ...old,
          rows: [...(old.rows ?? []), ...data.filter((r) => !known.has(r.id))],
          hasMore: data.length === GIFT_CODE_PAGE_SIZE,
          more: 'idle',
        };
      });
    } catch {
      if (current()) setResult((old) => old && { ...old, more: 'error' });
    } finally {
      if (current()) moreBusy.current = false;
    }
  };
  const accept = (row: GiftCodeDto) => {
    if (denied || live.current !== version || currentKey.current !== key) return;
    sequence.current++;
    setResult((old) =>
      old?.key === key
        ? { ...old, rows: old.rows?.map((r) => (r.id === row.id ? row : r)) ?? null, more: 'idle' }
        : old
    );
  };
  return {
    rows: accepted?.rows ?? null,
    loading: enabled && !denied && (accepted?.loading ?? true),
    error: accepted?.error ?? false,
    hasMore: accepted?.hasMore ?? false,
    more: accepted?.more ?? 'idle',
    retry,
    loadMore,
    accept,
  };
}

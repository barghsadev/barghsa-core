import { useLayoutEffect, useRef } from 'react';

export interface RecordAddress {
  id: string | null;
  set: (id: string | null, replace?: boolean) => void;
}

export function useRecordAddress<T>(
  selection: RecordAddress | undefined,
  rows: readonly T[],
  identify: (row: T) => string,
  ready: boolean,
  restore: (row: T | null) => void
) {
  const applied = useRef<string | null>(null);
  const request = useRef<{ id: string | null; pending: boolean }>({ id: null, pending: false });
  const id = selection?.id;
  useLayoutEffect(() => {
    if (id === undefined) return;
    if (request.current.id !== id) {
      const pending = applied.current !== id;
      if (pending) restore(null);
      request.current = { id, pending };
    }
    if (!request.current.pending || !ready) return;
    const record = id === null ? null : rows.find((row) => identify(row) === id);
    if (record === undefined) return;
    request.current.pending = false;
    applied.current = id;
    if (record !== null) restore(record);
  }, [id, rows, ready]);
  return (next: string | null, replace = false) => {
    if (!selection || (applied.current === next && !request.current.pending)) return;
    applied.current = next;
    request.current.pending = false;
    selection.set(next, replace);
  };
}

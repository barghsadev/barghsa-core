import { useCallback, useState } from 'react';

/** Accumulate a real next page; restored pages and successful refreshes replace it. */
export function useCursorPageRows<T extends { id: string }>(scope: string, cursor: string) {
  const [accepted, setAccepted] = useState<{
    scope: string;
    cursor: string;
    rows: T[];
    next: string | null;
  } | null>(null);
  const acceptPage = useCallback(
    (rows: T[], next: string | null) => {
      setAccepted((current) => {
        const extending =
          !!cursor &&
          current?.scope === scope &&
          current.next === cursor &&
          current.cursor !== cursor;
        const previous = extending ? current.rows : [];
        const ids = new Set(previous.map((row) => row.id));
        return {
          scope,
          cursor,
          rows: [...previous, ...rows.filter((row) => !ids.has(row.id))],
          next,
        };
      });
    },
    [scope, cursor]
  );
  const discard = useCallback(() => setAccepted(null), []);
  return {
    rows: accepted?.scope === scope ? accepted.rows : [],
    next: accepted?.scope === scope ? accepted.next : null,
    acceptPage,
    discard,
  };
}

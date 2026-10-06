import { useCallback, useState } from 'react';

/** Accumulated cursor pages belong to one profile/filter scope. */
export function useCursorHistory<T extends { id: string }>(scope: string) {
  const [page, setPage] = useState<{
    scope: string;
    before?: string | undefined;
    items: T[];
    nextBefore: string | null;
  }>({
    scope,
    items: [],
    nextBefore: null,
  });
  if (page.scope !== scope) setPage({ scope, items: [], nextBefore: null });
  const before = page.scope === scope ? page.before : undefined;
  const items = page.scope === scope ? page.items : [];
  const nextBefore = page.scope === scope ? page.nextBefore : null;
  const acceptPage = useCallback(
    (incoming: T[], next: string | null) => {
      setPage((current) => {
        if (current.scope !== scope || current.before !== before) return current;
        const previous = before && current.scope === scope ? current.items : [];
        const seen = new Set(previous.map((item) => item.id));
        return {
          scope,
          before,
          items: [...previous, ...incoming.filter((item) => !seen.has(item.id))],
          nextBefore: next,
        };
      });
    },
    [scope, before]
  );
  const clear = useCallback(() => {
    setPage((current) =>
      current.scope === scope ? { ...current, items: [], nextBefore: null } : current
    );
  }, [scope]);
  const reset = useCallback(() => {
    setPage((current) =>
      current.scope === scope ? { scope, items: [], nextBefore: null } : current
    );
  }, [scope]);
  const loadMore = () => {
    if (nextBefore)
      setPage((current) =>
        current.scope === scope && current.nextBefore === nextBefore
          ? { ...current, before: nextBefore }
          : current
      );
  };
  return { items, before, nextBefore, acceptPage, loadMore, clear, reset };
}

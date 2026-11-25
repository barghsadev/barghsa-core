import { useBlocker } from '@tanstack/react-router';

export function RecordCommandGuard({ blocked }: { blocked: () => boolean }) {
  useBlocker({
    shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname && blocked(),
    enableBeforeUnload: blocked,
  });
  return null;
}

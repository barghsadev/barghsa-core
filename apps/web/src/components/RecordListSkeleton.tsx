import { Skeleton, cn, type ListView } from '@barghsa/ui';

const listSkeletonTracks: Record<number, string> = {
  3: '2fr 1fr 1fr',
  4: '2fr 1.25fr 1fr 1fr',
  5: '2fr 1.25fr 1fr 1.25fr 1fr',
  6: '2fr 1.25fr 1.25fr 1fr 1fr 0.6fr',
};

/** Match result rows and cards. Filters stay mounted and usable above this placeholder. */
export function RecordListSkeleton({
  label,
  view,
  headings,
}: {
  label: string;
  view: ListView;
  headings: readonly string[];
}) {
  const card = view === 'card';
  const columns = 'grid items-center gap-4 px-4 py-3';
  const grid = {
    gridTemplateColumns: listSkeletonTracks[headings.length] ?? listSkeletonTracks[3],
  };
  return (
    <div role="status" aria-label={label} data-slot="record-list-skeleton">
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className={card ? 'grid gap-3' : 'divide-y rounded-xl border bg-card'}
      >
        {!card && (
          <div style={grid} className={cn(columns, 'rounded-t-xl bg-muted/40 text-sm font-medium')}>
            {headings.map((heading) => (
              <span key={heading} className="min-w-0 wrap-anywhere">
                {heading}
              </span>
            ))}
          </div>
        )}
        {['w-4/5', 'w-3/5', 'w-2/3', 'w-1/2'].slice(0, card ? 3 : 4).map((width) => (
          <div
            key={width}
            style={card ? undefined : grid}
            className={card ? 'space-y-3 rounded-xl border bg-card p-4' : cn(columns, 'min-h-18')}
          >
            <div className="min-w-0 space-y-2">
              <Skeleton className={cn('h-4 max-w-64', width)} />
              <Skeleton className="h-3 w-16 max-w-full" />
            </div>
            <Skeleton className="h-5 w-20 max-w-full rounded-full" />
            <Skeleton className="h-4 w-24 max-w-full" />
            {!card &&
              headings
                .slice(3)
                .map((heading) => <Skeleton key={heading} className="h-4 w-24 max-w-full" />)}
            {card && (
              <div className="border-t pt-3">
                <Skeleton className="h-4 w-24" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

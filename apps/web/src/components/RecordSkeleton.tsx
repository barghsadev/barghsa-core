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

/** Reserve the identity header and reading area while a record is being retrieved. */
export function RecordDetailSkeleton({
  label,
  sidebar = false,
  layout = 'thread',
}: {
  label: string;
  sidebar?: boolean;
  layout?: 'thread' | 'order';
}) {
  const order = layout === 'order';
  return (
    <div role="status" aria-label={label} data-slot="record-detail-skeleton">
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className={cn(
          'grid items-start gap-4',
          order ? 'lg:grid-cols-2' : sidebar && 'lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.5fr)]'
        )}
      >
        <div className="space-y-3 rounded-xl border bg-card p-4 sm:p-6 lg:col-span-full">
          <Skeleton className="h-7 w-3/5 max-w-80 sm:h-9" />
          {!order && <StatusPills />}
          <div className={cn('flex flex-wrap gap-6', !order && 'border-t pt-3')}>
            {[0, 1].map((field) => (
              <div key={field} className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
        {order && (
          <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-6 lg:col-span-full">
            <StatusPills />
            <div className="space-y-2 border-t pt-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-1/2 max-w-80" />
              <Skeleton className="h-4 w-2/3 max-w-96" />
            </div>
          </div>
        )}
        <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <Skeleton className="h-4 w-28" />
          <div className="space-y-2">
            <Skeleton className={order ? 'h-3 w-28' : 'h-4 w-full'} />
            <Skeleton className={order ? 'h-6 w-32' : 'h-4 w-2/3'} />
          </div>
          <div className="flex items-start gap-3 border-t pt-4">
            {!order && <Skeleton className="size-9 shrink-0 rounded-full" />}
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-28 max-w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </div>
        {(sidebar || order) && (
          <div
            className={cn('space-y-4 rounded-xl border bg-card p-5', !order && 'hidden lg:block')}
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-2/3" />
            <div className="space-y-2 border-y py-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPills() {
  return (
    <div className="flex gap-2">
      <Skeleton className="h-6 w-24 rounded-full" />
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}

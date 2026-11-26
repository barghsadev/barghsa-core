import { Skeleton, cn } from '@barghsa/ui';

/** Reserve the identity header and reading area while a record is being retrieved. */
export function RecordDetailSkeleton({
  label,
  sidebar = false,
  layout = 'thread',
}: {
  label: string;
  sidebar?: boolean;
  layout?: 'thread' | 'order' | 'payment';
}) {
  const order = layout === 'order';
  if (layout === 'payment') {
    return (
      <div role="status" aria-label={label} data-slot="record-detail-skeleton">
        <span className="sr-only">{label}</span>
        <div aria-hidden="true" className="space-y-4">
          <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-3">
              {[0, 1, 2].map((metric) => (
                <div key={metric} className="space-y-2">
                  <Skeleton className="h-3 w-16 max-w-full" />
                  <Skeleton className="h-6 w-28 max-w-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-2/3 max-w-80" />
            <Skeleton className="h-3 w-1/2 max-w-56" />
          </div>
        </div>
      </div>
    );
  }
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

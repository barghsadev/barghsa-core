import { cn } from '../../lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden rounded-md bg-muted motion-safe:after:absolute motion-safe:after:inset-0 motion-safe:after:animate-shimmer motion-safe:after:bg-linear-to-r motion-safe:after:from-transparent motion-safe:after:via-foreground/10 motion-safe:after:to-transparent',
        className
      )}
      {...props}
    />
  );
}

function SkeletonText({
  lines = 1,
  className,
  ...props
}: React.ComponentProps<'div'> & { lines?: number }) {
  const count = Number.isFinite(lines) ? Math.max(1, Math.min(20, Math.floor(lines))) : 1;
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton-text"
      className={cn('space-y-2', className)}
      {...props}
    >
      {Array.from({ length: count }, (_, index) => (
        <Skeleton
          key={index}
          className={index === count - 1 && count > 1 ? 'h-4 w-2/3' : 'h-4 w-full'}
        />
      ))}
    </div>
  );
}
function SkeletonCard({ className, ...props }: React.ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn('h-32 w-full', className)} {...props} />;
}
function SkeletonAvatar({ className, ...props }: React.ComponentProps<typeof Skeleton>) {
  return <Skeleton className={cn('size-10 rounded-full', className)} {...props} />;
}
function SkeletonTableRow({
  columns = 4,
  ...props
}: React.ComponentProps<'tr'> & { columns?: number }) {
  const count = Number.isFinite(columns) ? Math.max(1, Math.min(20, Math.floor(columns))) : 4;
  return (
    <tr aria-hidden="true" data-slot="skeleton-table-row" {...props}>
      {Array.from({ length: count }, (_, index) => (
        <td key={index} className="p-3">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}
function SkeletonChart({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton-chart"
      className={cn('grid h-40 grid-cols-6 items-end gap-2', className)}
      {...props}
    >
      {['h-1/3', 'h-2/3', 'h-1/2', 'h-3/4', 'h-1/4', 'h-full'].map((height, index) => (
        <Skeleton key={index} className={cn('w-full', height)} />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonText, SkeletonCard, SkeletonAvatar, SkeletonTableRow, SkeletonChart };

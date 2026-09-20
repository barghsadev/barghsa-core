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

export { Skeleton };

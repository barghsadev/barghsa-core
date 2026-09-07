import { PageLoading, Skeleton } from '@barghsa/ui';
import { feedbackText } from '@barghsa/i18n/feedback';
import { useLocale } from '../hooks/useLocale.js';

interface RouteSkeletonProps {
  layout?: 'default' | 'admin';
}

/** Responsive route placeholders use CSS motion preferences, including first paint. */
export function RouteSkeleton({ layout = 'default' }: RouteSkeletonProps) {
  const locale = useLocale();
  if (layout === 'admin')
    return (
      <div className="flex min-h-screen bg-background">
        <div
          aria-hidden="true"
          className="hidden w-64 shrink-0 flex-col gap-4 border-e p-4 md:flex"
        >
          {[70, 50, 80, 55, 65, 75].map((width, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${width}%` }} />
          ))}
        </div>
        <PageLoading label={feedbackText('loadingAdmin', locale)} className="flex-1" />
      </div>
    );
  return <PageLoading label={feedbackText('loading', locale)} className="min-h-screen" />;
}

/** Static reduced-motion indicator retains the same accessible loading status. */
export function RouteSpinner() {
  const locale = useLocale();
  const label = feedbackText('loading', locale);
  return (
    <div className="flex min-h-48 items-center justify-center" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="size-8 rounded-full border-4 border-muted border-t-primary motion-safe:animate-spin"
      />
    </div>
  );
}

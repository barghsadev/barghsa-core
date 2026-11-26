import { PageLoading, Skeleton } from '@barghsa/ui';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { useContext } from 'react';
import { useLocale } from '../hooks/useLocale.js';
import { InsideRouteMain, RouteFallbackLandmark } from './RouteFallbackLandmark.js';

interface RouteSkeletonProps {
  layout?: 'default' | 'admin';
}

/** Responsive route placeholders use CSS motion preferences, including first paint. */
export function RouteSkeleton({ layout = 'default' }: RouteSkeletonProps) {
  const locale = useLocale();
  const admin = layout === 'admin';
  const insideMain = useContext(InsideRouteMain);
  const showSidebar = admin && !insideMain;
  const label = loadingText(admin ? 'loadingAdmin' : 'loading', locale);
  return (
    <RouteFallbackLandmark>
      <h1 className="sr-only">{label}</h1>
      <div className={showSidebar ? 'flex min-h-screen' : undefined}>
        {showSidebar && (
          <div
            aria-hidden="true"
            className="hidden w-64 shrink-0 flex-col gap-4 border-e p-4 md:flex"
          >
            {[1, 2, 3, 4, 5, 6].map((row) => (
              <Skeleton key={row} className="h-4 w-3/4 even:w-1/2" />
            ))}
          </div>
        )}
        <PageLoading label={label} className={insideMain ? 'min-h-48' : 'min-h-screen'} />
      </div>
    </RouteFallbackLandmark>
  );
}

export function StaffRecordLoading() {
  const locale = useLocale();
  return <PageLoading className="min-h-48" label={loadingText('loadingAdmin', locale)} />;
}

/** Static reduced-motion indicator retains the same accessible loading status. */
export function RouteSpinner() {
  const locale = useLocale();
  const label = loadingText('loading', locale);
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

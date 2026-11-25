import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button, Card, CardHeader, CardContent, cn, ResultGlyph, Skeleton } from '@barghsa/ui';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { loadingText, reloadText } from '@barghsa/i18n/loading-feedback';
import type { Locale } from '@barghsa/i18n/app';
import type { AsyncData } from '../../hooks/useAsyncData.js';
import { announceReadRetry } from '../../lib/read-retry-feedback.js';

export function retryDashboardRead(resource: AsyncData<unknown>, locale: Locale) {
  if (resource.status === 'error' && resource.error.code === 'READ_NETWORK')
    announceReadRetry(locale);
  resource.retry();
}

export function DashboardWidget<T>({
  title,
  icon: Icon,
  viewAll,
  resource,
  locale,
  empty,
  emptyMessage,
  className,
  children,
}: {
  title: string;
  icon: LucideIcon;
  viewAll?: ReactNode;
  resource: AsyncData<T>;
  locale: Locale;
  empty?: (data: T) => boolean;
  emptyMessage?: string;
  className?: string;
  children: (data: T) => ReactNode;
}) {
  const id = useId();
  const profileChanged = resource.status === 'error' && resource.error.code === 'READ_CONFLICT';
  return (
    <Card
      variant="widget"
      role="region"
      aria-labelledby={id}
      className={cn(
        '@container/widget min-h-44 min-w-0 gap-2 py-3 [--card-spacing:1rem] sm:[--card-spacing:1.25rem]',
        className
      )}
    >
      <CardHeader className="flex min-h-11 flex-row flex-wrap items-center justify-between gap-x-2 gap-y-0 border-b pb-2!">
        <h2 id={id} className="flex min-w-0 items-center gap-2 text-base font-semibold">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <Icon className="size-[1.125rem]" />
          </span>
          {title}
        </h2>
        {viewAll}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 py-1">
        {resource.status === 'loading' ? (
          <div role="status" aria-label={loadingText('loading', locale)} className="space-y-2 py-2">
            <Skeleton aria-hidden="true" className="h-4 w-2/3" />
            <Skeleton aria-hidden="true" className="h-4 w-1/2" />
          </div>
        ) : resource.status === 'error' ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-danger-soft/40 px-2.5 py-1"
          >
            <ResultGlyph error className="hidden size-8 @md/widget:inline-flex" />
            <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <p className="text-sm">
                {dashboardText(profileChanged ? 'widget.profileChanged' : 'widget.error', locale)}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0"
                onClick={() => {
                  if (profileChanged) window.location.reload();
                  else retryDashboardRead(resource, locale);
                }}
              >
                {profileChanged
                  ? reloadText('reload', locale)
                  : dashboardText('widget.retry', locale)}
              </Button>
            </div>
          </div>
        ) : empty?.(resource.data) ? (
          <div className="flex items-center gap-3 rounded-lg bg-muted/60 p-3">
            <ResultGlyph />
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : (
          children(resource.data)
        )}
      </CardContent>
    </Card>
  );
}

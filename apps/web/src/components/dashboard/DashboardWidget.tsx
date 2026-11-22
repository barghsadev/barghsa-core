import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button, Card, CardHeader, CardContent, LoadingSkeleton } from '@barghsa/ui';
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
  children,
}: {
  title: string;
  icon: LucideIcon;
  viewAll?: ReactNode;
  resource: AsyncData<T>;
  locale: Locale;
  empty?: (data: T) => boolean;
  emptyMessage?: string;
  children: (data: T) => ReactNode;
}) {
  const id = useId();
  const profileChanged = resource.status === 'error' && resource.error.code === 'READ_CONFLICT';
  return (
    <Card
      variant="widget"
      role="region"
      aria-labelledby={id}
      className="h-[24rem] min-w-0 gap-3 pt-4 pb-3 [--card-spacing:1rem] sm:[--card-spacing:1.25rem]"
    >
      <CardHeader className="flex min-h-11 flex-row flex-wrap items-center justify-between gap-x-2 gap-y-0 border-b pb-2">
        <h2 id={id} className="flex min-w-0 items-center gap-2 text-base font-semibold">
          <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          {title}
        </h2>
        {viewAll}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto py-1" tabIndex={0}>
        {resource.status === 'loading' ? (
          <LoadingSkeleton label={loadingText('loading', locale)} variant="table" />
        ) : resource.status === 'error' ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {dashboardText(profileChanged ? 'widget.profileChanged' : 'widget.error', locale)}
            </p>
            <Button
              variant="outline"
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
        ) : empty?.(resource.data) ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          children(resource.data)
        )}
      </CardContent>
    </Card>
  );
}

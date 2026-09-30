import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button, Card, CardHeader, CardContent, LoadingSkeleton } from '@barghsa/ui';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { feedbackText } from '@barghsa/i18n/feedback';
import type { Locale } from '@barghsa/i18n/app';
import type { AsyncData } from '../../hooks/useAsyncData.js';

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
  return (
    <Card variant="widget" role="region" aria-labelledby={id} className="h-[32rem] min-w-0">
      <CardHeader className="flex min-h-12 flex-row flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="flex min-w-0 items-center gap-2 text-base font-semibold">
          <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          {title}
        </h2>
        {viewAll}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto" tabIndex={0}>
        {resource.status === 'loading' ? (
          <LoadingSkeleton label={feedbackText('loading', locale)} variant="table" />
        ) : resource.status === 'error' ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-muted-foreground">{dashboardText('widget.error', locale)}</p>
            <Button variant="outline" onClick={resource.retry}>
              {dashboardText('widget.retry', locale)}
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

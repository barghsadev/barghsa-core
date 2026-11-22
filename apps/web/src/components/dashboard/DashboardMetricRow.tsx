import { cn } from '@barghsa/ui';

export const dashboardMetricLink =
  'flex min-h-11 min-w-0 items-center justify-between gap-2 px-2 py-2 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

export function DashboardMetricRow({
  label,
  count,
  attention,
}: {
  label: string;
  count: string;
  attention?: string | undefined;
}) {
  return (
    <>
      <span className="min-w-0 text-sm wrap-anywhere">
        {label}
        {attention && (
          <span className="mt-0.5 block text-xs font-medium text-destructive">{attention}</span>
        )}
      </span>
      <bdi
        className={cn(
          'shrink-0 rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums',
          attention ? 'bg-danger-soft text-destructive' : 'bg-muted text-muted-foreground'
        )}
      >
        {count}
      </bdi>
    </>
  );
}

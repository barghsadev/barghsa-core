import type { ComponentProps, ReactNode } from 'react';
import { Check, Circle, Clock3, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Skeleton } from './skeleton';

export type StatusTone = 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'purple';

/** Labels are mandatory: color never carries the only meaning. */
export function StatusBadge({
  label,
  tone = 'default',
  dot = true,
  ...props
}: {
  label: string;
  tone?: StatusTone;
  dot?: boolean;
} & Omit<ComponentProps<typeof Badge>, 'variant' | 'children'>) {
  return (
    <Badge variant={tone} {...props}>
      {dot ? (
        <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {label}
    </Badge>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-2 text-xs font-medium text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="text-3xl leading-snug font-semibold text-foreground">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface ProgressStep {
  id: string;
  label: string;
  description?: string;
  state: 'complete' | 'current' | 'pending';
  /** Localized state text for assistive technology. */
  stateLabel: string;
}
/** Read-only progress. Navigation and validation stay with the owning workflow. */
export function ProgressStepper({ steps, label }: { steps: ProgressStep[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-4 sm:flex-row">
      {steps.map((step) => (
        <li
          key={step.id}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className="flex min-w-0 flex-1 items-start gap-3"
        >
          <span
            aria-hidden="true"
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-full border',
              step.state === 'complete'
                ? 'border-success/20 bg-success-soft text-success'
                : step.state === 'current'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted text-muted-foreground'
            )}
          >
            {step.state === 'complete' ? (
              <Check className="size-4" />
            ) : (
              <Circle className="size-3" />
            )}
          </span>
          <span className="min-w-0 pt-1 text-sm">
            <span
              className={cn('block', step.state === 'current' ? 'font-semibold' : 'font-medium')}
            >
              {step.label}
              <span className="sr-only"> · {step.stateLabel}</span>
            </span>
            {step.description ? (
              <span className="mt-1 block text-xs text-muted-foreground">{step.description}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface TimelineEntry {
  id: string;
  title: string;
  description?: string;
  dateTime: string;
  dateLabel: string;
}
export function Timeline({ items, label }: { items: TimelineEntry[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {items.map((item) => (
        <li
          key={item.id}
          className="relative border-s border-border pb-6 ps-6 last:border-transparent last:pb-0"
        >
          <span
            aria-hidden="true"
            className="absolute -start-1 top-1.5 size-2 rounded-full bg-input ring-4 ring-card"
          />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{item.title}</p>
            <time dateTime={item.dateTime} className="text-xs text-muted-foreground">
              {item.dateLabel}
            </time>
          </div>
          {item.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Display-only rows must come from an authoritative server preview, never client totals. */
export function FinancialReviewSummary({
  title,
  rows,
  total,
  notice,
}: {
  title: string;
  rows: { id: string; label: string; value: ReactNode }[];
  total: { label: string; value: ReactNode };
  notice?: ReactNode;
}) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-xl border bg-card">
      <h3 className="border-b px-5 py-4 text-sm font-semibold">{title}</h3>
      <dl className="divide-y divide-border px-5">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 text-sm"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words text-end font-medium tabular-nums">
              <bdi>{row.value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <dl className="border-t bg-muted px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <dt className="text-sm font-semibold">{total.label}</dt>
          <dd className="break-words text-xl font-semibold tabular-nums">
            <bdi>{total.value}</bdi>
          </dd>
        </div>
      </dl>
      {notice ? (
        <div className="border-t px-5 py-3 text-xs text-muted-foreground">{notice}</div>
      ) : null}
    </section>
  );
}

export function WaitingForBarghsa({
  title,
  description,
  submittedAt,
  update,
  expectedResponse,
  help,
}: {
  title: string;
  description: string;
  submittedAt: ReactNode;
  update?: ReactNode;
  expectedResponse?: ReactNode;
  help: ReactNode;
}) {
  return (
    <Alert variant="info" role="status">
      <Clock3 aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>
        <div className="flex flex-col gap-2">
          <span>{submittedAt}</span>
          {update}
          {expectedResponse}
          {help}
        </div>
      </AlertDescription>
    </Alert>
  );
}
export function NoDeadEndBanner({
  title,
  description,
  responsibleTeam,
  action,
  help,
}: {
  title: string;
  description: string;
  responsibleTeam: string;
  action: ReactNode;
  help: ReactNode;
}) {
  return (
    <Alert variant="warning">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>
        <p>{responsibleTeam}</p>
        <div className="flex flex-wrap items-center gap-3">
          {action}
          {help}
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function LoadingSkeleton({
  label,
  variant = 'detail',
}: {
  label: string;
  variant?: 'detail' | 'form' | 'table' | 'cards';
}) {
  return (
    <div role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className={cn('grid gap-4', variant === 'cards' ? 'sm:grid-cols-2 lg:grid-cols-3' : '')}
      >
        {Array.from(
          { length: variant === 'detail' ? 3 : variant === 'cards' ? 6 : 5 },
          (_, index) => (
            <Skeleton
              key={index}
              className={cn(
                variant === 'cards'
                  ? 'h-32'
                  : variant === 'table'
                    ? 'h-12'
                    : variant === 'form'
                      ? 'h-11'
                      : index === 2
                        ? 'h-48'
                        : 'h-6',
                variant === 'detail' && index === 0 ? 'w-1/3' : 'w-full'
              )}
            />
          )
        )}
      </div>
    </div>
  );
}

/** Explicit empty state avoids treating valid values such as 0 as missing data. */
export function AsyncView({
  loading,
  error,
  empty,
  loadingView,
  errorView,
  emptyView,
  children,
}: {
  loading: boolean;
  error: boolean;
  empty: boolean;
  loadingView: ReactNode;
  errorView: ReactNode;
  emptyView: ReactNode;
  children: ReactNode;
}) {
  return <>{loading ? loadingView : error ? errorView : empty ? emptyView : children}</>;
}

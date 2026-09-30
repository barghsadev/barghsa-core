'use client';

import { cn } from '../../lib/utils';
import { Button, buttonVariants } from './button';
import { Progress } from './progress';
import { StatusBadge } from './workflow';

export type JobProgressStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface JobProgressLabels {
  progress: string;
  queued: string;
  processing: string;
  completed: string;
  failed: string;
  loading: string;
  loadError: string;
  failedDescription: string;
  retryLoad: string;
  retryJob: string;
  openResult: string;
  estimateUnavailable: string;
  estimate: (remaining: string) => string;
}

/** Display-only job status; the owning app supplies polling and mutations. */
export function JobProgressView({
  status,
  progress = 0,
  resultUrl,
  estimatedRemaining,
  loading = false,
  loadError = false,
  retrying = false,
  labels,
  onRefresh,
  onRetry,
  className,
}: {
  status?: JobProgressStatus | undefined;
  progress?: number | undefined;
  resultUrl?: string | null | undefined;
  estimatedRemaining?: string | null | undefined;
  loading?: boolean;
  loadError?: boolean;
  retrying?: boolean;
  labels: JobProgressLabels;
  onRefresh?: () => void;
  onRetry?: () => void;
  className?: string;
}) {
  const value = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  const title = loadError ? labels.loadError : loading || !status ? labels.loading : labels[status];
  const tone =
    status === 'completed' ? 'success' : status === 'failed' || loadError ? 'destructive' : 'info';
  return (
    <section
      aria-busy={loading || retrying || undefined}
      className={cn('space-y-4 border-y border-border py-5', className)}
    >
      <div
        aria-live="polite"
        aria-atomic="true"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <StatusBadge label={title} tone={tone} />
        {!loadError && status ? (
          <span className="text-sm font-medium tabular-nums text-foreground" dir="ltr">
            {value}%
          </span>
        ) : null}
      </div>
      {!loadError ? <Progress value={value} aria-label={labels.progress} /> : null}
      {status === 'queued' || status === 'processing' ? (
        <p className="text-sm text-muted-foreground">
          {estimatedRemaining ? labels.estimate(estimatedRemaining) : labels.estimateUnavailable}
        </p>
      ) : null}
      {status === 'failed' && !loadError ? (
        <p className="text-sm text-destructive">{labels.failedDescription}</p>
      ) : null}
      {loadError && onRefresh ? (
        <Button type="button" variant="outline" onClick={onRefresh}>
          {labels.retryLoad}
        </Button>
      ) : null}
      {status === 'failed' && !loadError && onRetry ? (
        <Button type="button" variant="outline" loading={retrying} onClick={onRetry}>
          {labels.retryJob}
        </Button>
      ) : null}
      {status === 'completed' && resultUrl?.startsWith('/') && !resultUrl.startsWith('//') ? (
        <a className={buttonVariants({ variant: 'default' })} href={resultUrl}>
          {labels.openResult}
        </a>
      ) : null}
    </section>
  );
}

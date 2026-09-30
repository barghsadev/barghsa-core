import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import { JobProgressView } from '@barghsa/ui';
import { useLocale } from '../../hooks/useLocale.js';
import { fetchJobStatus, retryFailedJob, type JobStatus } from '../../lib/jobs.js';

/** Polls the owner-scoped API without overlapping requests; stops at a terminal state. */
export function JobProgress({
  jobId,
  estimatedRemaining,
}: {
  jobId: string;
  /** Only pass a duration supplied by the operation itself, never a guessed deadline. */
  estimatedRemaining?: string | null;
}) {
  const locale = useLocale();
  const [job, setJob] = useState<JobStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const visibleJob = job?.id === jobId ? job : null;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoadError(false);
    async function load() {
      try {
        const next = await fetchJobStatus(jobId, controller.signal);
        if (controller.signal.aborted) return;
        setJob(next);
        setLoadError(false);
        if (next.status === 'queued' || next.status === 'processing') {
          timer = setTimeout(() => void load(), 2_000);
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      }
    }
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobId, refresh]);

  async function retry() {
    setRetrying(true);
    try {
      const queued = await retryFailedJob(jobId);
      setJob(queued);
      setRefresh((value) => value + 1);
    } catch {
      setLoadError(true);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <JobProgressView
      status={visibleJob?.status}
      progress={visibleJob?.progress_pct}
      resultUrl={visibleJob?.result_url}
      estimatedRemaining={estimatedRemaining}
      loading={!visibleJob && !loadError}
      loadError={loadError}
      retrying={retrying}
      onRefresh={() => setRefresh((value) => value + 1)}
      onRetry={() => void retry()}
      labels={{
        progress: t('jobs.progress', locale),
        queued: t('jobs.queued', locale),
        processing: t('jobs.processing', locale),
        completed: t('jobs.completed', locale),
        failed: t('jobs.failed', locale),
        loading: t('jobs.loading', locale),
        loadError: t('jobs.loadError', locale),
        failedDescription: t('jobs.failedDescription', locale),
        retryLoad: t('jobs.retryLoad', locale),
        retryJob: t('jobs.retryJob', locale),
        openResult: t('jobs.openResult', locale),
        estimateUnavailable: t('jobs.estimateUnavailable', locale),
        estimate: (remaining) => t('jobs.estimate', locale).replace('{remaining}', remaining),
      }}
    />
  );
}

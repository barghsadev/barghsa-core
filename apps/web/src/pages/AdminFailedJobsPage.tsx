import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { BACKGROUND_JOB_TYPES } from '@barghsa/shared/admin';
import { Button, Label, ListPage, ScrollArea } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useOperationalQueue } from '../hooks/useOperationalQueue.js';
interface Job {
  id: string;
  jobType: string;
  status: string;
  error: string | null;
  errorCategory: string;
  attempts: number;
  maxAttempts: number;
  firstFailedAt: string;
  lastRunAt: string;
  nextRunAt: string | null;
  resolvedAt: string | null;
  resolvedByUsername: string | null;
}
function isJob(value: unknown): value is Job {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Job;
  const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
  const nullableText = (v: unknown) => v === null || typeof v === 'string';
  return (
    typeof row.id === 'string' &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id) &&
    typeof row.jobType === 'string' &&
    !!row.jobType &&
    ['failed', 'retrying', 'dead_letter', 'resolved'].includes(row.status) &&
    nullableText(row.error) &&
    typeof row.errorCategory === 'string' &&
    Number.isSafeInteger(row.attempts) &&
    row.attempts >= 0 &&
    Number.isSafeInteger(row.maxAttempts) &&
    row.maxAttempts > 0 &&
    date(row.firstFailedAt) &&
    date(row.lastRunAt) &&
    (row.nextRunAt === null || date(row.nextRunAt)) &&
    (row.resolvedAt === null || date(row.resolvedAt)) &&
    nullableText(row.resolvedByUsername)
  );
}
const jobBasis = (row: Job) =>
  JSON.stringify([
    row.id,
    row.jobType,
    row.status,
    row.error,
    row.errorCategory,
    row.attempts,
    row.maxAttempts,
    row.lastRunAt,
  ]);
const statuses = ['failed', 'retrying', 'dead_letter', 'resolved', 'all'];
const pageSize = 25;
export default function AdminFailedJobsPage() {
  const time = useAccountTime();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.jobs.${key}`, locale);
  const [status, setStatus] = useState('failed'),
    [jobType, setJobType] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]),
    [notice, setNotice] = useState<{
      kind: 'retry' | 'resolve';
      count: number;
      skipped: number;
    } | null>(null);
  const [action, setAction] = useState<
    | (TeamAction & {
        kind: 'retry' | 'resolve';
        count: number;
        rows: Job[];
        trigger: HTMLElement | null;
      })
    | null
  >(null);
  const savedTrigger = useRef<HTMLElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const clearPrivate = useCallback(() => {
    setSelected([]);
    setAction(null);
    setNotice(null);
    savedTrigger.current = null;
  }, []);
  const criteria = new URLSearchParams({
    ...(status === 'all' ? {} : { status }),
    ...(jobType ? { jobType } : {}),
  }).toString();
  const queue = useOperationalQueue(
    '/api/admin/failed-jobs',
    criteria,
    offset,
    isJob,
    clearPrivate
  );
  const { access, loading, error } = queue;
  const jobs = queue.data?.rows ?? [],
    hasMore = queue.data?.hasMore ?? false;
  const previousCriteria = useRef(criteria);
  useEffect(() => {
    if (previousCriteria.current === criteria) return;
    previousCriteria.current = criteria;
    clearPrivate();
  }, [criteria, clearPrivate]);
  useEffect(() => {
    if (!queue.data || loading || error) return;
    const eligible = queue.data.rows.filter((row) =>
      ['failed', 'dead_letter'].includes(row.status)
    );
    setSelected((current) => current.filter((id) => eligible.some((row) => row.id === id)));
    if (
      action &&
      action.rows.some(
        (row) =>
          !queue.data!.rows.some((next) => next.id === row.id && jobBasis(next) === jobBasis(row))
      )
    )
      setAction(null);
  }, [queue.data, loading, error, action]);
  useEffect(() => {
    if (access.data && !access.data.canRetry) {
      setSelected([]);
      setAction(null);
    }
  }, [access.data]);
  useEffect(() => {
    if (!queue.ready || action || !savedTrigger.current) return;
    const target = savedTrigger.current;
    const frame = requestAnimationFrame(() => {
      if (savedTrigger.current !== target) return;
      savedTrigger.current = null;
      if (target.isConnected && !target.hasAttribute('disabled')) target.focus();
      else refreshButton.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [queue.ready, action]);
  const recovery = (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={access.loading} onClick={access.retry}>
        {label('accessRetry')}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={loading || !queue.canView}
        onClick={queue.retry}
      >
        {label('queueRetry')}
      </Button>
      {(error || access.error) && <p role="alert">{label('error')}</p>}
    </div>
  );
  const jobName = (type: string) => {
    const key = `admin.jobs.type.${type}`,
      value = t(key, locale);
    return value === key ? type : value;
  };
  const date = (value: string | null) => (value ? time.format(value) : label('none'));
  function act(kind: 'retry' | 'resolve', ids: string[]) {
    if (!queue.canRetry) return;
    const rows = jobs.filter((row) => ids.includes(row.id));
    if (
      !rows.length ||
      rows.length !== ids.length ||
      rows.some((row) =>
        kind === 'retry'
          ? !['failed', 'dead_letter'].includes(row.status)
          : row.status === 'resolved'
      )
    )
      return;
    savedTrigger.current = null;
    const bulk = ids.length > 1;
    setAction({
      kind,
      rows,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      count: ids.length,
      title: label(kind === 'resolve' ? 'resolve' : bulk ? 'bulk' : 'retry'),
      description:
        label(kind === 'resolve' ? 'resolveConfirm' : 'retryConfirm').replace(
          '{count}',
          numbers.number(ids.length)
        ) +
        ' ' +
        ids.map((id) => jobName(jobs.find((job) => job.id === id)!.jobType)).join(', '),
      path: bulk ? '/api/admin/failed-jobs/retry-bulk' : `/api/admin/failed-jobs/${ids[0]}/${kind}`,
      method: 'POST',
      ...(bulk ? { body: { ids } } : {}),
      conflictMessage: label('conflict'),
      forbiddenMessage: label('forbidden'),
    });
  }
  return (
    <section className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{label('description')}</p>
        </div>
        <Button
          variant="outline"
          disabled={loading || access.loading}
          ref={refreshButton}
          onClick={queue.refresh}
        >
          {label('refresh')}
        </Button>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice.kind === 'resolve'
            ? label('resolvedNotice')
            : label('retryNotice')
                .replace('{count}', numbers.number(notice.count))
                .replace('{skipped}', numbers.number(notice.skipped))}
        </p>
      )}
      {queue.denied && <p role="alert">{label('forbidden')}</p>}
      <ListPage>
        <ListPage.Toolbar>
          <div className="flex flex-wrap items-end gap-4">
            <div role="group" aria-label={label('status')} className="flex flex-wrap gap-2">
              {statuses.map((value) => (
                <Button
                  key={value}
                  variant={status === value ? 'default' : 'outline'}
                  aria-pressed={status === value}
                  onClick={() => {
                    setStatus(value);
                    setOffset(0);
                    setNotice(null);
                  }}
                >
                  {label(`status.${value}`)}
                </Button>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="job-type">{label('type')}</Label>
              <select
                id="job-type"
                value={jobType}
                onChange={(event) => {
                  setJobType(event.target.value);
                  setOffset(0);
                  setNotice(null);
                }}
                className="block h-9 rounded-md border bg-card text-card-foreground px-3 text-sm"
              >
                <option value="">{label('allTypes')}</option>
                {BACKGROUND_JOB_TYPES.map((type) => (
                  <option key={type.key} value={type.key}>
                    {jobName(type.key)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {time.status === 'ready' && label('timezone').replace('{zone}', time.timezone)}
          </p>
          {access.data?.canRetry && (
            <Button
              disabled={!queue.canRetry || !selected.length}
              onClick={() => act('retry', selected)}
            >
              {label('bulk')} ({numbers.number(selected.length)})
            </Button>
          )}
        </ListPage.Toolbar>
        <ListPage.Content
          loading={loading || access.loading}
          error={error || access.error}
          retainContent={queue.data !== null}
          empty={queue.ready && !jobs.length}
          emptyView={<p>{label('empty')}</p>}
          loadingView={<p role="status">{label('loading')}</p>}
          errorView={
            <div role="alert">
              <p>{label('error')}</p>
              <Button onClick={queue.refresh}>{label('reload')}</Button>
            </div>
          }
        >
          {queue.data && (
            <ScrollArea
              scrollbarOrientation="horizontal"
              className="min-w-0 rounded-lg border bg-card text-card-foreground"
            >
              <table className="w-full min-w-[52rem] text-start text-sm" aria-busy={loading}>
                <caption className="sr-only">{label('title')}</caption>
                <thead>
                  <tr className="border-b bg-muted/40">
                    {['select', 'type', 'error', 'attempts', 'lastRun', 'actions'].map((key) => (
                      <th key={key} scope="col" className="p-3 text-start font-medium">
                        {label(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b last:border-0" data-job-id={job.id}>
                      <td className="p-3">
                        {access.data?.canRetry &&
                          ['failed', 'dead_letter'].includes(job.status) && (
                            <input
                              type="checkbox"
                              disabled={!queue.canRetry}
                              aria-label={label('selectJob').replace(
                                '{type}',
                                jobName(job.jobType)
                              )}
                              checked={selected.includes(job.id)}
                              onChange={(event) =>
                                setSelected((current) =>
                                  event.target.checked
                                    ? [...current, job.id]
                                    : current.filter((id) => id !== job.id)
                                )
                              }
                            />
                          )}
                      </td>
                      <th scope="row" className="p-3 text-start font-medium">
                        <span>{jobName(job.jobType)}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {label(`status.${job.status}`)}
                        </span>
                      </th>
                      <td className="max-w-md p-3">
                        <p className="whitespace-pre-wrap break-words">
                          {job.error ?? label('noError')}
                        </p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-muted-foreground">
                            {label('details')}
                          </summary>
                          <dl className="mt-2 space-y-2">
                            <div>
                              <dt>{label('id')}</dt>
                              <dd>
                                <bdi className="break-all font-mono text-xs">{job.id}</bdi>
                              </dd>
                            </div>
                            <div>
                              <dt>{label('firstFailed')}</dt>
                              <dd>{date(job.firstFailedAt)}</dd>
                            </div>
                            <div>
                              <dt>{label('nextRun')}</dt>
                              <dd>{date(job.nextRunAt)}</dd>
                            </div>
                            {job.resolvedAt && (
                              <div>
                                <dt>{label('resolvedAt')}</dt>
                                <dd>
                                  {date(job.resolvedAt)}
                                  {job.resolvedByUsername && (
                                    <>
                                      {' '}
                                      / <bdi>{job.resolvedByUsername}</bdi>
                                    </>
                                  )}
                                </dd>
                              </div>
                            )}
                          </dl>
                        </details>
                      </td>
                      <td className="whitespace-nowrap p-3">
                        {numbers.number(job.attempts)} / {numbers.number(job.maxAttempts)}
                      </td>
                      <td className="whitespace-nowrap p-3">{date(job.lastRunAt)}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {access.data?.canRetry &&
                            ['failed', 'dead_letter'].includes(job.status) && (
                              <Button
                                size="sm"
                                disabled={!queue.canRetry}
                                variant="outline"
                                onClick={() => act('retry', [job.id])}
                              >
                                {label('retry')}
                              </Button>
                            )}
                          {access.data?.canRetry && job.status !== 'resolved' && (
                            <Button
                              size="sm"
                              disabled={!queue.canRetry}
                              variant="outline"
                              onClick={() => act('resolve', [job.id])}
                            >
                              {label('resolve')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </ListPage.Content>
        <nav aria-label={label('pagination')} className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={!queue.canView || loading || error || !offset}
            onClick={() => setOffset((v) => Math.max(0, v - pageSize))}
          >
            {label('previous')}
          </Button>
          <span>
            {label('page').replace(
              '{page}',
              numbers.number((queue.data?.offset ?? offset) / pageSize + 1)
            )}
          </span>
          <Button
            variant="outline"
            disabled={!queue.canView || loading || error || !hasMore}
            onClick={() => setOffset((v) => v + pageSize)}
          >
            {label('next')}
          </Button>
        </nav>
      </ListPage>
      {action && !queue.denied && (
        <TeamActionDialog
          action={action}
          onDenied={queue.deny}
          confirmationDisabled={!queue.canRetry}
          summary={recovery}
          finalFocus={() =>
            action.trigger?.isConnected && !action.trigger.hasAttribute('disabled')
              ? action.trigger
              : refreshButton.current
          }
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            const acknowledged = Array.isArray(result) ? result : [result];
            if (
              (action.count > 1 ? !Array.isArray(result) : Array.isArray(result)) ||
              acknowledged.length > action.count ||
              new Set(acknowledged.map((row) => (row as Job)?.id)).size !== acknowledged.length ||
              !acknowledged.every(
                (row) =>
                  isJob(row) &&
                  action.rows.some(
                    (chosen) => chosen.id === row.id && chosen.jobType === row.jobType
                  ) &&
                  row.status === (action.kind === 'retry' ? 'retrying' : 'resolved')
              ) ||
              (action.count === 1 && acknowledged.length !== 1)
            )
              throw new Error('Invalid action acknowledgment');
            const count = acknowledged.length;
            setNotice({ kind: action.kind, count, skipped: action.count - count });
            savedTrigger.current = action.trigger;
            setSelected([]);
            queue.refresh();
          }}
        />
      )}
    </section>
  );
}

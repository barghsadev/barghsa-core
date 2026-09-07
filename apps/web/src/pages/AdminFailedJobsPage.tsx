import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { BACKGROUND_JOB_TYPES } from '@barghsa/shared/admin';
import { Button, Label } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
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
const statuses = ['failed', 'retrying', 'dead_letter', 'resolved', 'all'];
const pageSize = 25;
export default function AdminFailedJobsPage() {
  const time = useAccountTime();
  const locale = useLocale(),
    label = (key: string) => t(`admin.jobs.${key}`, locale);
  const [status, setStatus] = useState('failed'),
    [jobType, setJobType] = useState('');
  const [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]),
    [hasMore, setHasMore] = useState(false);
  const [access, setAccess] = useState<{ canView: boolean; canRetry: boolean } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [selected, setSelected] = useState<string[]>([]),
    [notice, setNotice] = useState<{
      kind: 'retry' | 'resolve';
      count: number;
      skipped: number;
    } | null>(null);
  const [action, setAction] = useState<
    (TeamAction & { kind: 'retry' | 'resolve'; count: number }) | null
  >(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setSelected([]);
    void (async () => {
      try {
        const accessResponse = await fetch('/api/admin/failed-jobs/access', {
          signal: controller.signal,
        });
        if (!accessResponse.ok) throw new Error('Unavailable');
        const permissions = (await accessResponse.json()) as {
          canView: boolean;
          canRetry: boolean;
        };
        if (controller.signal.aborted) return;
        setAccess(permissions);
        if (!permissions.canView) {
          setJobs([]);
          setHasMore(false);
          return;
        }
        const query = new URLSearchParams({
          limit: String(pageSize + 1),
          offset: String(offset),
          ...(status === 'all' ? {} : { status }),
          ...(jobType ? { jobType } : {}),
        });
        const response = await fetch(`/api/admin/failed-jobs?${query}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unavailable');
        const result = (await response.json()) as Job[];
        if (!Array.isArray(result)) throw new Error('Invalid response');
        if (!controller.signal.aborted) {
          setJobs(result.slice(0, pageSize));
          setHasMore(result.length > pageSize);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [status, jobType, offset, revision]);
  const jobName = (type: string) => {
    const key = `admin.jobs.type.${type}`,
      value = t(key, locale);
    return value === key ? type : value;
  };
  const date = (value: string | null) => (value ? time.format(value) : label('none'));
  function act(kind: 'retry' | 'resolve', ids: string[]) {
    const bulk = ids.length > 1;
    setAction({
      kind,
      count: ids.length,
      title: label(kind === 'resolve' ? 'resolve' : bulk ? 'bulk' : 'retry'),
      description:
        label(kind === 'resolve' ? 'resolveConfirm' : 'retryConfirm').replace(
          '{count}',
          new Intl.NumberFormat(locale).format(ids.length)
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
        <Button variant="outline" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
          {label('refresh')}
        </Button>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice.kind === 'resolve'
            ? label('resolvedNotice')
            : label('retryNotice')
                .replace('{count}', new Intl.NumberFormat(locale).format(notice.count))
                .replace('{skipped}', new Intl.NumberFormat(locale).format(notice.skipped))}
        </p>
      )}
      {loading && <p role="status">{label('loading')}</p>}
      {error && (
        <div role="alert" className="space-y-3">
          <p>{label('error')}</p>
          <Button onClick={() => setRevision((v) => v + 1)}>{label('reload')}</Button>
        </div>
      )}
      {!loading && !error && !access?.canView && <p role="alert">{label('forbidden')}</p>}
      {access?.canView && (
        <>
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
                className="block h-9 rounded-md border bg-white px-3 text-sm"
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
          {access.canRetry && (
            <Button
              disabled={loading || error || !selected.length}
              onClick={() => act('retry', selected)}
            >
              {label('bulk')} ({new Intl.NumberFormat(locale).format(selected.length)})
            </Button>
          )}
          {loading || error ? null : !jobs.length ? (
            <p>{label('empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full text-start text-sm">
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
                        {access.canRetry && ['failed', 'dead_letter'].includes(job.status) && (
                          <input
                            type="checkbox"
                            aria-label={label('selectJob').replace('{type}', jobName(job.jobType))}
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
                        {new Intl.NumberFormat(locale).format(job.attempts)} /{' '}
                        {new Intl.NumberFormat(locale).format(job.maxAttempts)}
                      </td>
                      <td className="whitespace-nowrap p-3">{date(job.lastRunAt)}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {access.canRetry && ['failed', 'dead_letter'].includes(job.status) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => act('retry', [job.id])}
                            >
                              {label('retry')}
                            </Button>
                          )}
                          {access.canRetry && job.status !== 'resolved' && (
                            <Button
                              size="sm"
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
            </div>
          )}
          <nav aria-label={label('pagination')} className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={loading || error || !offset}
              onClick={() => setOffset((v) => Math.max(0, v - pageSize))}
            >
              {label('previous')}
            </Button>
            <span>
              {label('page').replace(
                '{page}',
                new Intl.NumberFormat(locale).format(offset / pageSize + 1)
              )}
            </span>
            <Button
              variant="outline"
              disabled={loading || error || !hasMore}
              onClick={() => setOffset((v) => v + pageSize)}
            >
              {label('next')}
            </Button>
          </nav>
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            const count = Array.isArray(result) ? result.length : 1;
            setNotice({ kind: action.kind, count, skipped: action.count - count });
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}

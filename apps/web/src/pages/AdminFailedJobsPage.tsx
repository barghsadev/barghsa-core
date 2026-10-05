import { OperationalQueueTable, QueueRecordDetails } from '../components/OperationalQueueTable.js';
import { OperationalCommandReview } from '../components/OperationalCommandReview.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { BACKGROUND_JOB_TYPES } from '@barghsa/shared/admin';
import { Button, Label, DateCell, TextCell, ListPage } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useOperationalQueue } from '../hooks/useOperationalQueue.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
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
const jobIdentity = (row: Job) => JSON.stringify([row.id, row.jobType]);
const statuses = ['failed', 'retrying', 'dead_letter', 'resolved', 'all'];
const pageSize = 25;
export default function AdminFailedJobsPage({ queries }: { queries?: ListQueryBinding } = {}) {
  const time = useAccountTime();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.jobs.${key}`, locale);
  const [localStatus, setStatus] = useState('failed'),
    [localJobType, setJobType] = useState('');
  const [localOffset, setOffset] = useState(0);
  const status = queries ? queries.query.filters.status : localStatus;
  const jobType = queries ? queries.query.filters.jobType || '' : localJobType;
  const offset = queries ? (queries.query.page - 1) * pageSize : localOffset;
  const actionGeneration = useRef(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleDetails = (id: string) =>
    setExpanded((current) => ({ ...current, [id]: !current[id] }));
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
  const [unconfirmed, setUnconfirmed] = useState<NonNullable<typeof action> | null>(null);
  const [pending, setPending] = useState(false);
  const [reviewReload, setReviewReload] = useState(false);
  const owned = useRef(false);
  const sending = useRef(false);
  const reloadBase = useRef<object | null>(null);
  const locked = pending || !!unconfirmed || reviewReload;
  const savedTrigger = useRef<HTMLElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const clearPrivate = useCallback(() => {
    actionGeneration.current++;
    owned.current = false;
    sending.current = false;
    reloadBase.current = null;
    setUnconfirmed(null);
    setPending(false);
    setReviewReload(false);
    setSelected([]);
    setExpanded({});
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
  useEffect(() => {
    if (reviewReload && queue.ready && queue.data !== reloadBase.current) {
      reloadBase.current = null;
      owned.current = false;
      setReviewReload(false);
    }
  }, [reviewReload, queue.ready, queue.data]);
  function returnToQueue() {
    ++actionGeneration.current;
    setUnconfirmed(null);
    setAction(null);
    reloadBase.current = queue.data;
    setReviewReload(true);
    setSelected([]);
    queue.refresh();
  }
  const previousCriteria = useRef(criteria);
  const actionScope = `${criteria}:${offset}`;
  const previousActionScope = useRef(actionScope);
  if (previousActionScope.current !== actionScope) {
    previousActionScope.current = actionScope;
    actionGeneration.current++;
  }
  const receiptGeneration = actionGeneration.current;
  useEffect(
    () => () => {
      actionGeneration.current++;
    },
    []
  );
  useEffect(() => {
    setAction(null);
    setUnconfirmed(null);
    setPending(false);
    setReviewReload(false);
    owned.current = false;
    sending.current = false;
    reloadBase.current = null;
    setNotice(null);
    savedTrigger.current = null;
  }, [offset]);
  useEffect(() => {
    if (previousCriteria.current === criteria) return;
    previousCriteria.current = criteria;
    clearPrivate();
  }, [criteria, clearPrivate]);
  useEffect(() => {
    if (!queue.data || loading || error || unconfirmed) return;
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
    ) {
      ++actionGeneration.current;
      owned.current = false;
      sending.current = false;
      setPending(false);
      setAction(null);
    }
  }, [queue.data, loading, error, action, unconfirmed]);
  useEffect(() => {
    if (access.data && !access.data.canRetry && !unconfirmed) {
      ++actionGeneration.current;
      setSelected([]);
      setAction(null);
      setPending(false);
      sending.current = false;
      owned.current = false;
    }
  }, [access.data, unconfirmed]);
  useEffect(() => {
    if (!queue.ready || action || !savedTrigger.current) return;
    const target = savedTrigger.current;
    const frame = requestAnimationFrame(() => {
      if (savedTrigger.current !== target) return;
      savedTrigger.current = null;
      if (
        target.isConnected &&
        target.getClientRects().length > 0 &&
        !target.hasAttribute('disabled')
      )
        target.focus();
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
  const date = (value: string | null) =>
    value ? <DateCell value={value} format={(stamp) => time.format(stamp)} /> : label('none');
  function act(kind: 'retry' | 'resolve', ids: string[]) {
    if (!queue.canRetry || owned.current) return;
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
    owned.current = true;
    ++actionGeneration.current;
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
      successStatus: 200,
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
          disabled={pending || !!unconfirmed || loading || access.loading}
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
                  disabled={locked}
                  onClick={() => {
                    if (queries) queries.setQuery({ filters: { status: value } });
                    else {
                      setStatus(value);
                      setOffset(0);
                    }
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
                  if (queries) queries.setQuery({ filters: { jobType: event.target.value } });
                  else {
                    setJobType(event.target.value);
                    setOffset(0);
                  }
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
              disabled={!!action || locked || !queue.canRetry || !selected.length}
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
            <OperationalQueueTable
              locale={locale}
              cardHeading="h2"
              rows={jobs}
              caption={label('title')}
              scrollLabel={label('table')}
              loading={loading}
              emptyMessage={label('empty')}
              nameHeader={label('type')}
              renderName={(job) => (
                <>
                  <span>
                    <TextCell value={jobName(job.jobType)} />
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {label(`status.${job.status}`)}
                  </span>
                </>
              )}
              selectionHeader={label('select')}
              renderSelection={(job) => (
                <>
                  {access.data?.canRetry && ['failed', 'dead_letter'].includes(job.status) && (
                    <input
                      type="checkbox"
                      disabled={!!action || locked || !queue.canRetry}
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
                </>
              )}
              fields={[
                {
                  id: 'error',
                  label: label('errorMessage'),
                  render: (job) => (
                    <div className="max-w-md [overflow-wrap:anywhere]">
                      <p className="whitespace-pre-wrap break-words">
                        <TextCell value={job.error ?? label('noError')} />
                      </p>
                      <QueueRecordDetails
                        open={!!expanded[job.id]}
                        onToggle={() => toggleDetails(job.id)}
                        label={label('details')}
                      >
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
                      </QueueRecordDetails>
                    </div>
                  ),
                },
                {
                  id: 'attempts',
                  label: label('attempts'),
                  render: (job) => (
                    <bdi dir="ltr" className="whitespace-nowrap">
                      {numbers.number(job.attempts)} / {numbers.number(job.maxAttempts)}
                    </bdi>
                  ),
                },
                {
                  id: 'lastRun',
                  label: label('lastRun'),
                  render: (job) => <>{date(job.lastRunAt)}</>,
                },
              ]}
              actionHeader={label('actions')}
              renderActions={(job) => (
                <>
                  <div className="flex flex-wrap gap-2">
                    {access.data?.canRetry && ['failed', 'dead_letter'].includes(job.status) && (
                      <Button
                        size="sm"
                        disabled={!!action || locked || !queue.canRetry}
                        variant="outline"
                        onClick={() => act('retry', [job.id])}
                      >
                        {label('retry')}
                      </Button>
                    )}
                    {access.data?.canRetry && job.status !== 'resolved' && (
                      <Button
                        size="sm"
                        disabled={!!action || locked || !queue.canRetry}
                        variant="outline"
                        onClick={() => act('resolve', [job.id])}
                      >
                        {label('resolve')}
                      </Button>
                    )}
                  </div>
                </>
              )}
            />
          )}
        </ListPage.Content>
        <nav aria-label={label('pagination')} className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={locked || !queue.canView || loading || error || !offset}
            onClick={() =>
              queries
                ? queries.setQuery({ page: Math.max(1, queries.query.page - 1) })
                : setOffset((v) => Math.max(0, v - pageSize))
            }
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
            disabled={
              locked || !queue.canView || loading || error || !hasMore || offset >= 1_000_000
            }
            onClick={() =>
              queries
                ? queries.setQuery({ page: queries.query.page + 1 })
                : setOffset((v) => v + pageSize)
            }
          >
            {label('next')}
          </Button>
        </nav>
      </ListPage>
      {unconfirmed && !queue.denied && (
        <OperationalCommandReview
          locale={locale}
          endpoint="/api/admin/failed-jobs"
          rows={unconfirmed.rows}
          validate={isJob}
          identity={jobIdentity}
          onDenied={queue.deny}
          onReviewed={returnToQueue}
          renderRecord={(row, available) => (
            <>
              <p className="font-semibold">{jobName(row.jobType)}</p>
              {available && (
                <p>
                  {label(`status.${row.status}`)} ·{' '}
                  <bdi dir="ltr">
                    {numbers.number(row.attempts)} / {numbers.number(row.maxAttempts)}
                  </bdi>
                </p>
              )}
              <p className="text-muted-foreground">{date(row.lastRunAt)}</p>
            </>
          )}
        />
      )}
      {action && !queue.denied && (
        <TeamActionDialog
          action={action}
          onDenied={queue.deny}
          confirmationDisabled={!queue.canRetry}
          summary={recovery}
          finalFocus={() =>
            action.trigger?.isConnected &&
            action.trigger.getClientRects().length > 0 &&
            !action.trigger.hasAttribute('disabled')
              ? action.trigger
              : refreshButton.current
          }
          onPendingChange={(value) => {
            if (receiptGeneration !== actionGeneration.current) return;
            sending.current = value;
            setPending(value);
          }}
          onUnconfirmed={() => {
            if (receiptGeneration !== actionGeneration.current) return;
            ++actionGeneration.current;
            setUnconfirmed(action);
            setAction(null);
            setNotice(null);
            sending.current = false;
            setPending(false);
          }}
          onClose={() => {
            if (receiptGeneration !== actionGeneration.current) return;
            ++actionGeneration.current;
            owned.current = false;
            sending.current = false;
            setPending(false);
            setAction(null);
          }}
          onSuccess={async (result) => {
            if (receiptGeneration !== actionGeneration.current) return;
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

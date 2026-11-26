import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { Check as TableCheckIcon, RotateCw as TableRotateCwIcon } from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { Link } from '@tanstack/react-router';
import { HistoryIcon } from 'lucide-react';
import { t as workspaceText } from '@barghsa/i18n/workspace';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { OperationalQueueTable, QueueRecordDetails } from '../components/OperationalQueueTable.js';
import {
  OperationalCommandChecks,
  OperationalCommandRecords,
  OperationalCommandReview,
} from '../components/OperationalCommandReview.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { BACKGROUND_JOB_TYPES } from '@barghsa/shared/admin';
import {
  Button,
  Badge,
  Label,
  NativeSelect,
  NativeSelectOption,
  DateCell,
  TextCell,
  ListPage,
  ListRefreshButton,
} from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useOperationalQueue } from '../hooks/useOperationalQueue.js';
import { QueueEmptyState, statusAlternatives } from '../components/QueueEmptyState.js';
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
export default function AdminFailedJobsPage({
  queries,
  recordId,
  historySearch,
}: {
  queries?: ListQueryBinding;
  recordId?: string;
  historySearch?: Record<string, unknown>;
} = {}) {
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
    clearPrivate,
    recordId
  );
  const { access, loading, error } = queue;
  const jobs = queue.data?.rows ?? [],
    hasMore = queue.data?.hasMore ?? false;
  function changeStatus(value: string) {
    if (locked) return;
    if (queries) queries.setQuery({ filters: { status: value } });
    else {
      setStatus(value);
      setOffset(0);
    }
    setNotice(null);
  }
  useEffect(() => {
    if (reviewReload && queue.ready && queue.data !== reloadBase.current) {
      reloadBase.current = null;
      owned.current = false;
      setReviewReload(false);
    }
  }, [reviewReload, queue.ready, queue.data]);
  function returnToQueue() {
    ++actionGeneration.current;
    savedTrigger.current = unconfirmed?.trigger ?? refreshButton.current;
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
    <>
      {(error || access.error) && (
        <p role="alert" className="text-sm">
          {label('error')}
        </p>
      )}
      <OperationalCommandChecks locale={locale}>
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
      </OperationalCommandChecks>
    </>
  );
  const jobName = (type: string) => {
    const key = `admin.jobs.type.${type}`,
      value = t(key, locale);
    return value === key ? type : value;
  };
  const date = (value: string | null) =>
    value ? <DateCell value={value} format={(stamp) => time.format(stamp)} /> : label('none');
  const renderJob = (row: Job, available: boolean) => (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold">{jobName(row.jobType)}</p>
        {available && <Badge variant="outline">{label(`status.${row.status}`)}</Badge>}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {available && (
          <span>
            {label('attempts')}{' '}
            <bdi dir="ltr">
              {numbers.number(row.attempts)} / {numbers.number(row.maxAttempts)}
            </bdi>
          </span>
        )}
        {date(row.lastRunAt)}
        {available && (
          <span title={row.id} className="font-mono tabular-nums">
            <bdi dir="ltr" aria-hidden="true">
              …{row.id.slice(-8)}
            </bdi>
            <span className="sr-only">
              {label('id')} <bdi>{row.id}</bdi>
            </span>
          </span>
        )}
      </p>
    </>
  );
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
      description: label(kind === 'resolve' ? 'resolveConfirm' : 'retryConfirm').replace(
        '{count}',
        numbers.number(ids.length)
      ),
      path: bulk ? '/api/admin/failed-jobs/retry-bulk' : `/api/admin/failed-jobs/${ids[0]}/${kind}`,
      method: 'POST',
      responseDeadline: true,
      successStatus: 200,
      ...(bulk ? { body: { ids } } : {}),
      conflictMessage: label('conflict'),
      forbiddenMessage: label('forbidden'),
    });
  }
  const jobActions = (job: Job) => (
    <>
      <div className="flex flex-wrap gap-2">
        {access.data?.canRetry && ['failed', 'dead_letter'].includes(job.status) && (
          <Button
            size="sm"
            disabled={!!action || locked || !queue.canRetry}
            variant="outline"
            onClick={() => act('retry', [job.id])}
            data-table-action-tooltip={label('retry')}
          >
            <TableActionIcon icon={TableRotateCwIcon}>{label('retry')}</TableActionIcon>
          </Button>
        )}
        {access.data?.canRetry && job.status !== 'resolved' && (
          <Button
            size="sm"
            disabled={!!action || locked || !queue.canRetry}
            variant="outline"
            onClick={() => act('resolve', [job.id])}
            data-table-action-tooltip={label('resolve')}
          >
            <TableActionIcon icon={TableCheckIcon}>{label('resolve')}</TableActionIcon>
          </Button>
        )}
      </div>
    </>
  );
  const record = recordId ? jobs[0] : undefined;
  return (
    <section className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          {recordId && !locked && !action && (
            <Link
              to="/admin/failed-jobs"
              search={historySearch}
              className="touch-action text-sm text-primary underline underline-offset-4"
            >
              {label('title')}
            </Link>
          )}
          <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">
            {record ? jobName(record.jobType) : label(recordId ? 'recordTitle' : 'title')}
          </h1>
          {!recordId && (
            <p className="max-w-2xl text-sm text-muted-foreground">{label('description')}</p>
          )}
        </div>
        <ListRefreshButton
          label={label('refresh')}
          refreshing={loading || access.loading}
          disabled={pending || !!unconfirmed}
          ref={refreshButton}
          onClick={queue.refresh}
        />
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
        {!recordId && !queue.denied && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 items-end gap-2 sm:max-w-lg sm:gap-3">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="job-status">{label('status')}</Label>
                <NativeSelect
                  id="job-status"
                  className="w-full"
                  value={status}
                  disabled={locked || !!action}
                  onChange={(event) => changeStatus(event.target.value)}
                >
                  {statuses.map((value) => (
                    <NativeSelectOption key={value} value={value}>
                      {label(`status.${value}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor="job-type">{label('type')}</Label>
                <NativeSelect
                  id="job-type"
                  className="w-full"
                  value={jobType}
                  disabled={locked || !!action}
                  onChange={(event) => {
                    if (queries) queries.setQuery({ filters: { jobType: event.target.value } });
                    else {
                      setJobType(event.target.value);
                      setOffset(0);
                    }
                    setNotice(null);
                  }}
                >
                  <NativeSelectOption value="">{label('allTypes')}</NativeSelectOption>
                  {BACKGROUND_JOB_TYPES.map((type) => (
                    <NativeSelectOption key={type.key} value={type.key}>
                      {jobName(type.key)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {time.status === 'ready' && label('timezone').replace('{zone}', time.timezone)}
            </p>
          </div>
        )}
        {!recordId && access.data?.canRetry && selected.length > 0 && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm">
            <span role="status" className="text-sm font-medium">
              {label('selectedCount').replace('{count}', numbers.number(selected.length))}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!action || locked}
                onClick={() => {
                  setSelected([]);
                  refreshButton.current?.focus();
                }}
              >
                {label('clearSelection')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!!action || locked || !queue.canRetry}
                onClick={() => act('retry', selected)}
              >
                {label('bulk')}
              </Button>
            </div>
          </div>
        )}
        <ListPage.Content
          loading={loading || access.loading}
          error={error || access.error}
          retainContent={queue.data !== null && jobs.length > 0}
          empty={queue.ready && !jobs.length}
          emptyView={
            !recordId && offset === 0 && status && status !== 'all' ? (
              <QueueEmptyState
                locale={locale}
                message={label('empty')}
                status={label(`status.${status}`)}
                alternatives={statusAlternatives(
                  statuses,
                  status,
                  (value) => label(`status.${value}`),
                  '/api/admin/failed-jobs',
                  criteria
                )}
                hasResults={(body, value) =>
                  Array.isArray(body) && body.some((row) => isJob(row) && row.status === value)
                }
                select={changeStatus}
                all={() => changeStatus('all')}
                disabled={locked}
              />
            ) : (
              <p>{label('empty')}</p>
            )
          }
          loadingView={
            recordId ? (
              <RecordDetailSkeleton label={label('loading')} />
            ) : (
              <RecordListSkeleton label={label('loading')} view="card" headings={[]} />
            )
          }
          errorView={
            <div role="alert">
              <p>{label(queue.missing ? 'recordUnavailable' : 'error')}</p>
              <Button onClick={queue.refresh}>{label('reload')}</Button>
            </div>
          }
        >
          {record && (
            <section className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline">{label(`status.${record.status}`)}</Badge>
                <span className="text-sm text-muted-foreground">
                  {label('attempts')}{' '}
                  <bdi>
                    {numbers.number(record.attempts)} / {numbers.number(record.maxAttempts)}
                  </bdi>
                </span>
              </div>
              <section aria-labelledby="job-error">
                <h2 id="job-error" className="mb-2 font-semibold">
                  {label('errorMessage')}
                </h2>
                <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {record.error ?? label('noError')}
                </p>
              </section>
              <dl className="grid gap-4 border-t pt-4 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">{label('id')}</dt>
                  <dd>
                    <bdi className="break-all font-mono">{record.id}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{label('firstFailed')}</dt>
                  <dd>{date(record.firstFailedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{label('lastRun')}</dt>
                  <dd>{date(record.lastRunAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{label('nextRun')}</dt>
                  <dd>{date(record.nextRunAt)}</dd>
                </div>
                {record.resolvedAt && (
                  <div>
                    <dt className="text-muted-foreground">{label('resolvedAt')}</dt>
                    <dd>
                      {date(record.resolvedAt)}
                      {record.resolvedByUsername && (
                        <bdi className="ms-2 [overflow-wrap:anywhere]">
                          {record.resolvedByUsername}
                        </bdi>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
              {jobActions(record)}
            </section>
          )}
          {!recordId && queue.data && (
            <OperationalQueueTable
              locale={locale}
              cardHeading="h2"
              rows={jobs}
              caption={label('title')}
              scrollLabel={label('table')}
              loading={loading}
              emptyMessage={label('empty')}
              nameHeader={label('type')}
              tableClassName="min-w-[48rem]"
              fieldGroups={[
                {
                  label: workspaceText('recordTable.activity', locale),
                  fields: ['firstFailed', 'lastRun'],
                  icon: HistoryIcon,
                },
              ]}
              renderName={(job) => (
                <>
                  {queries && !locked && !action ? (
                    <Link
                      to="/admin/failed-jobs/$jobId"
                      params={{ jobId: job.id }}
                      search={historySearch}
                      className="touch-action font-medium text-primary underline underline-offset-4"
                    >
                      {jobName(job.jobType)}
                    </Link>
                  ) : (
                    <TextCell value={jobName(job.jobType)} />
                  )}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {label(`status.${job.status}`)}
                  </span>
                </>
              )}
              selectionHeader={label('select')}
              renderSelection={(job) => (
                <>
                  {access.data?.canRetry && ['failed', 'dead_letter'].includes(job.status) && (
                    <label className="touch-label inline-flex items-center justify-center">
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
                    </label>
                  )}
                </>
              )}
              fields={[
                {
                  id: 'error',
                  label: label('errorMessage'),
                  render: (job) => (
                    <div className="max-w-md [overflow-wrap:anywhere]">
                      <p
                        className={
                          queries
                            ? 'line-clamp-2 whitespace-pre-wrap break-words'
                            : 'whitespace-pre-wrap break-words'
                        }
                      >
                        <TextCell value={job.error ?? label('noError')} />
                      </p>
                      {!queries && (
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
                      )}
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
                  id: 'firstFailed',
                  label: label('firstFailed'),
                  render: (job) => date(job.firstFailedAt),
                },
                {
                  id: 'lastRun',
                  label: label('lastRun'),
                  render: (job) => <>{date(job.lastRunAt)}</>,
                },
              ]}
              actionHeader={label('actions')}
              renderActions={jobActions}
            />
          )}
        </ListPage.Content>
        {!recordId && (
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
        )}
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
          renderRecord={renderJob}
        />
      )}
      {action && !queue.denied && (
        <TeamActionDialog
          action={action}
          focusSummary
          onDenied={queue.deny}
          confirmationDisabled={!queue.canRetry}
          summary={
            <>
              <OperationalCommandRecords
                locale={locale}
                rows={action.rows}
                render={(row) => renderJob(row, true)}
              />
              {recovery}
            </>
          }
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
            return count > 0 ? confirmationText('recorded', locale) : undefined;
          }}
        />
      )}
    </section>
  );
}

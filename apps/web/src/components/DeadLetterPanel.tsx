import { OperationalQueueTable, QueueRecordDetails } from './OperationalQueueTable.js';
import { OperationalCommandReview } from './OperationalCommandReview.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useState, useEffect, useId, useRef, useMemo } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { Button, DateCell, TextCell, ListPage } from '@barghsa/ui';
import type { Locale } from '@barghsa/i18n/app';
import { NotificationDeliveryHistory } from './NotificationDeliveryHistory.js';

import { useOperationalQueue } from '../hooks/useOperationalQueue.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
/**
 * Admin dead-letter queue panel (E-05, T-05.01.06).
 *
 * Lists dead-lettered notification deliveries written by the outbox worker
 * when a job exhausts its retry budget, and exposes the three triage actions:
 * Retry (re-queue with the same idempotency key), Resolve (mark final), and
 * Dismiss (acknowledge/remove from the active view).
 *
 * Reads /api/admin/failed-notifications and posts to the per-record
 * action endpoints. Open items default to the front; a toggle reveals all
 * statuses.
 */

interface DeadLetterRow {
  id: string;
  outboxId: string;
  jobId: string;
  channel: 'in_app' | 'email' | 'sms';
  eventKey: string;
  severity: 'error' | 'critical';
  recipientKey: string | null;
  data: Record<string, unknown> | null;
  cause: string | null;
  errorCategory: string | null;
  attempts: number;
  maxAttempts: number;
  status: 'open' | 'retried' | 'resolved' | 'dismissed';
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isDeadLetterRow(value: unknown): value is DeadLetterRow {
  if (!isRecord(value)) return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const nullableText = (item: unknown) => item === null || typeof item === 'string';
  const date = (item: unknown) => typeof item === 'string' && Number.isFinite(Date.parse(item));
  return (
    ['id', 'outboxId', 'jobId'].every(
      (key) => typeof value[key] === 'string' && uuid.test(value[key])
    ) &&
    typeof value.eventKey === 'string' &&
    value.eventKey.length > 0 &&
    typeof value.channel === 'string' &&
    ['in_app', 'email', 'sms'].includes(value.channel) &&
    typeof value.severity === 'string' &&
    ['error', 'critical'].includes(value.severity) &&
    typeof value.status === 'string' &&
    ['open', 'retried', 'resolved', 'dismissed'].includes(value.status) &&
    [value.recipientKey, value.cause, value.errorCategory, value.resolvedById].every(
      nullableText
    ) &&
    (value.data === null || isRecord(value.data)) &&
    Number.isSafeInteger(value.attempts) &&
    Number(value.attempts) >= 0 &&
    Number.isSafeInteger(value.maxAttempts) &&
    Number(value.maxAttempts) > 0 &&
    date(value.createdAt) &&
    (value.resolvedAt === null || date(value.resolvedAt))
  );
}

const deadLetterIdentity = (row: DeadLetterRow) =>
  JSON.stringify([row.id, row.outboxId, row.jobId, row.channel]);
function channelLabel(channel: DeadLetterRow['channel'], uiLocale: Locale): string {
  const key = `admin.notifications.deadLetter.channel${
    channel === 'email' ? 'Email' : channel === 'sms' ? 'Sms' : 'InApp'
  }` as const;
  return t(key, uiLocale);
}

function statusLabel(status: DeadLetterRow['status'], uiLocale: Locale): string {
  const key = `admin.notifications.deadLetter.status${
    status === 'open'
      ? 'Open'
      : status === 'retried'
        ? 'Retried'
        : status === 'resolved'
          ? 'Resolved'
          : 'Dismissed'
  }` as const;
  return t(key, uiLocale);
}

export default function DeadLetterPanel({
  uiLocale,
  queries,
  historyQueries,
}: {
  uiLocale: Locale;
  queries?: ListQueryBinding | undefined;
  historyQueries?: ListQueryBinding | undefined;
}) {
  const time = useAccountTime(uiLocale);
  const numbers = useNumberFormatting(uiLocale);
  const filterId = useId();
  const label = (key: string) => t(`admin.notifications.deadLetter.${key}`, uiLocale);
  const [localStatus, setStatus] = useState('open');
  const [localChannel, setChannel] = useState('');
  const [localSeverity, setSeverity] = useState('');
  const [localOffset, setOffset] = useState(0);
  const status = queries
    ? queries.query.filters.status === 'all'
      ? ''
      : queries.query.filters.status
    : localStatus;
  const channel = queries ? queries.query.filters.channel || '' : localChannel;
  const severity = queries ? queries.query.filters.severity || '' : localSeverity;
  const offset = queries ? (queries.query.page - 1) * 25 : localOffset;
  const actionGeneration = useRef(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleDetails = (id: string) =>
    setExpanded((current) => ({ ...current, [id]: !current[id] }));
  const [history, setHistory] = useState<DeadLetterRow | null>(null);
  const [allHistory, setAllHistory] = useState(false);
  const [action, setAction] = useState<
    | (TeamAction & {
        row: DeadLetterRow;
        trigger: HTMLElement | null;
        kind: 'retry' | 'resolve' | 'dismiss';
      })
    | null
  >(null);
  const [notice, setNotice] = useState<'retry' | 'resolve' | 'dismiss' | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<NonNullable<typeof action> | null>(null);
  const reviewRows = useMemo(() => (unconfirmed ? [unconfirmed.row] : []), [unconfirmed]);
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
    setHistory(null);
    setExpanded({});
    setAllHistory(false);
    setAction(null);
    setNotice(null);
    savedTrigger.current = null;
  }, []);
  const criteria = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(channel ? { channel } : {}),
    ...(severity ? { severity } : {}),
  }).toString();
  const queue = useOperationalQueue(
    '/api/admin/failed-notifications',
    criteria,
    offset,
    isDeadLetterRow,
    clearPrivate
  );
  const { access, loading, error } = queue;
  const rows = queue.data?.rows ?? [],
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
    queue.refresh();
  }
  const historyMode = historyQueries?.query.filters.mode;
  const historyId = historyQueries?.query.filters.notificationId || '';
  const historyChannel = historyQueries?.query.filters.channel || '';
  const historyEvent = rows.find(
    (row) => row.outboxId === historyId && row.channel === historyChannel
  )?.eventKey;
  const historyTarget = useMemo(
    () =>
      historyMode === 'target'
        ? { outboxId: historyId, channel: historyChannel, eventKey: historyEvent ?? historyId }
        : undefined,
    [historyMode, historyId, historyChannel, historyEvent]
  );
  const closeHistory = () => {
    if (historyQueries) historyQueries.setQuery({ filters: { mode: '' } });
    else {
      setHistory(null);
      setAllHistory(false);
    }
  };
  const actionScope = `${criteria}:${offset}`;
  const previousCriteria = useRef(actionScope);
  if (previousCriteria.current !== actionScope) {
    previousCriteria.current = actionScope;
    actionGeneration.current++;
  }
  const receiptGeneration = actionGeneration.current;
  useEffect(
    () => () => {
      actionGeneration.current++;
    },
    []
  );
  const basis = (row: DeadLetterRow) =>
    JSON.stringify([
      row.id,
      row.outboxId,
      row.jobId,
      row.channel,
      row.eventKey,
      row.recipientKey,
      row.severity,
      row.status,
      row.cause,
      row.attempts,
      row.maxAttempts,
    ]);
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
  }, [criteria, offset]);
  useEffect(() => {
    if (!queue.data || loading || error || unconfirmed) return;
    if (action && !queue.data.rows.some((row) => basis(row) === basis(action.row))) {
      ++actionGeneration.current;
      owned.current = false;
      setAction(null);
    }
    const latest = history && queue.data.rows.find((row) => row.id === history.id);
    if (latest && (latest.outboxId !== history?.outboxId || latest.channel !== history?.channel))
      setHistory(null);
  }, [queue.data, loading, error, action, history, unconfirmed]);
  useEffect(() => {
    if (access.data && !access.data.canRetry && !unconfirmed) {
      ++actionGeneration.current;
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
        {t('admin.jobs.accessRetry', uiLocale)}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={loading || !queue.canView}
        onClick={queue.retry}
      >
        {t('admin.jobs.queueRetry', uiLocale)}
      </Button>
      {(error || access.error) && <p role="alert">{label('loadFailed')}</p>}
    </div>
  );
  function act(row: DeadLetterRow, kind: 'retry' | 'resolve' | 'dismiss') {
    if (!queue.canRetry || owned.current || row.status !== 'open') return;
    owned.current = true;
    ++actionGeneration.current;
    savedTrigger.current = null;
    setNotice(null);
    setAction({
      row: structuredClone(row),
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      kind,
      title: label(kind),
      description: `${label(`${kind}Confirm`)} ${row.eventKey} · ${channelLabel(row.channel, uiLocale)} · ${row.recipientKey ?? ''}`,
      path: `/api/admin/failed-notifications/${row.id}/${kind}`,
      method: 'POST',
      successStatus: 200,
      conflictMessage: label('conflict'),
      forbiddenMessage: label('accessDenied'),
    });
  }

  return (
    <section className="space-y-3" dir={uiLocale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{label('title')}</h2>
        {queue.canView && (
          <Button
            variant="outline"
            onClick={() =>
              historyQueries
                ? historyQueries.setQuery({
                    filters: {
                      mode: 'all',
                      ...(historyMode === 'target'
                        ? { notificationId: '', channel: '', status: '' }
                        : {}),
                    },
                    page: 1,
                  })
                : setAllHistory(true)
            }
          >
            {t('admin.notifications.history.browse', uiLocale)}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={pending || !!unconfirmed || loading || access.loading}
          ref={refreshButton}
          onClick={queue.refresh}
        >
          {t('admin.jobs.refresh', uiLocale)}
        </Button>
      </div>
      {notice && <p role="status">{label(`${notice}Notice`)}</p>}
      <ListPage>
        <ListPage.Toolbar>
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <label htmlFor={`${filterId}-status`}>{label('status')}</label>
              <select
                id={`${filterId}-status`}
                disabled={locked}
                className="block rounded border p-2"
                value={status}
                onChange={(e) => {
                  if (queries) queries.setQuery({ filters: { status: e.target.value || 'all' } });
                  else {
                    setStatus(e.target.value);
                    setOffset(0);
                  }
                }}
              >
                <option value="">{label('all')}</option>
                {(['open', 'retried', 'resolved', 'dismissed'] as const).map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value, uiLocale)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${filterId}-channel`}>{label('channel')}</label>
              <select
                id={`${filterId}-channel`}
                disabled={locked}
                className="block rounded border p-2"
                value={channel}
                onChange={(e) => {
                  if (queries) queries.setQuery({ filters: { channel: e.target.value } });
                  else {
                    setChannel(e.target.value);
                    setOffset(0);
                  }
                }}
              >
                <option value="">{label('all')}</option>
                {(['in_app', 'email', 'sms'] as const).map((value) => (
                  <option key={value} value={value}>
                    {channelLabel(value, uiLocale)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${filterId}-severity`}>{label('severity')}</label>
              <select
                id={`${filterId}-severity`}
                disabled={locked}
                className="block rounded border p-2"
                value={severity}
                onChange={(e) => {
                  if (queries) queries.setQuery({ filters: { severity: e.target.value } });
                  else {
                    setSeverity(e.target.value);
                    setOffset(0);
                  }
                }}
              >
                <option value="">{label('all')}</option>
                <option value="error">{label('severityError')}</option>
                <option value="critical">{label('severityCritical')}</option>
              </select>
            </div>
          </div>
        </ListPage.Toolbar>
        {queue.denied && <p role="alert">{label('accessDenied')}</p>}
        <ListPage.Content
          loading={loading || access.loading}
          error={error || access.error}
          retainContent={queue.data !== null}
          empty={queue.ready && !rows.length}
          emptyView={<p>{label('empty')}</p>}
          loadingView={<p role="status">{t('admin.notifications.loading', uiLocale)}</p>}
          errorView={
            <div role="alert">
              <p>{label('loadFailed')}</p>
              <Button onClick={queue.refresh}>{t('admin.jobs.reload', uiLocale)}</Button>
            </div>
          }
        >
          {queue.data && (
            <OperationalQueueTable
              locale={uiLocale}
              rows={rows}
              caption={label('title')}
              scrollLabel={label('table')}
              loading={loading}
              emptyMessage={label('empty')}
              nameHeader={label('eventKey')}
              renderName={(row) => (
                <>
                  <span className="font-mono text-xs">
                    <TextCell value={row.eventKey} />
                  </span>
                </>
              )}

              fields={[
                {
                  id: 'channel',
                  label: label('channel'),
                  render: (row) => <>{channelLabel(row.channel, uiLocale)}</>,
                },
                {
                  id: 'severity',
                  label: label('severity'),
                  render: (row) => (
                    <>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          row.severity === 'critical'
                            ? 'bg-danger-soft text-destructive'
                            : 'bg-warning-soft text-warning'
                        }`}
                      >
                        {row.severity === 'critical'
                          ? t('admin.notifications.deadLetter.severityCritical', uiLocale)
                          : t('admin.notifications.deadLetter.severityError', uiLocale)}
                      </span>
                      {row.status !== 'open' && (
                        <span className="block text-xs text-muted-foreground mt-1">
                          {statusLabel(row.status, uiLocale)}
                        </span>
                      )}
                    </>
                  ),
                },
                {
                  id: 'cause',
                  label: label('cause'),
                  render: (row) => (
                    <div className="max-w-md [overflow-wrap:anywhere]">
                      <TextCell value={row.cause ?? '—'} />
                      <QueueRecordDetails
                        open={!!expanded[row.id]}
                        onToggle={() => toggleDetails(row.id)}
                        label={label('details')}
                      >
                        <p>
                          {label('recipient')}: <bdi>{row.recipientKey ?? '—'}</bdi>
                        </p>
                        {row.resolvedById && (
                          <p>
                            {label('actedBy')}: <bdi>{row.resolvedById}</bdi>
                          </p>
                        )}
                        <pre
                          dir="ltr"
                          className="max-w-sm overflow-auto whitespace-pre-wrap break-words"
                        >
                          {JSON.stringify(row.data, null, 2)}
                        </pre>
                        <Button
                          variant="outline"
                          onClick={() =>
                            historyQueries
                              ? historyQueries.setQuery({
                                  filters: {
                                    mode: 'target',
                                    notificationId: row.outboxId,
                                    channel: row.channel,
                                    status: '',
                                  },
                                  page: 1,
                                })
                              : setHistory(row)
                          }
                        >
                          {t('admin.notifications.history.title', uiLocale)}
                        </Button>
                      </QueueRecordDetails>
                    </div>
                  ),
                },
                {
                  id: 'attempts',
                  label: label('attempts'),
                  render: (row) => (
                    <bdi dir="ltr" className="whitespace-nowrap">
                      {numbers.number(row.attempts)}/{numbers.number(row.maxAttempts)}
                    </bdi>
                  ),
                },
                {
                  id: 'date',
                  label: label('date'),
                  render: (row) => (
                    <>
                      <DateCell value={row.createdAt} format={(stamp) => time.format(stamp)} />
                    </>
                  ),
                },
              ]}
              actionHeader={label('actions')}
              renderActions={(row) => (
                <>
                  {row.status === 'open' && access.data?.canRetry ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => act(row, 'retry')}
                        disabled={action !== null || locked || !queue.canRetry}
                        aria-label={`${t('admin.notifications.deadLetter.retry', uiLocale)} ${row.eventKey}`}
                      >
                        {t('admin.notifications.deadLetter.retry', uiLocale)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => act(row, 'resolve')}
                        disabled={action !== null || locked || !queue.canRetry}
                        aria-label={`${t('admin.notifications.deadLetter.resolve', uiLocale)} ${row.eventKey}`}
                      >
                        {t('admin.notifications.deadLetter.resolve', uiLocale)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => act(row, 'dismiss')}
                        disabled={action !== null || locked || !queue.canRetry}
                        aria-label={`${t('admin.notifications.deadLetter.dismiss', uiLocale)} ${row.eventKey}`}
                      >
                        {t('admin.notifications.deadLetter.dismiss', uiLocale)}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </>
              )}
            />
          )}
        </ListPage.Content>
        {queue.canView && (
          <nav aria-label={label('pagination')} className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={locked || !queue.canView || loading || error || offset === 0}
              onClick={() =>
                queries
                  ? queries.setQuery({ page: Math.max(1, queries.query.page - 1) })
                  : setOffset((v) => Math.max(0, v - 25))
              }
            >
              {t('admin.jobs.previous', uiLocale)}
            </Button>
            <span>{numbers.number((queue.data?.offset ?? offset) / 25 + 1)}</span>
            <Button
              variant="outline"
              disabled={
                locked || !queue.canView || loading || error || !hasMore || offset >= 1_000_000
              }
              onClick={() =>
                queries
                  ? queries.setQuery({ page: queries.query.page + 1 })
                  : setOffset((v) => v + 25)
              }
            >
              {t('admin.jobs.next', uiLocale)}
            </Button>
          </nav>
        )}
      </ListPage>
      {historyQueries && historyMode && queue.canView && (
        <NotificationDeliveryHistory
          locale={uiLocale}
          target={historyTarget}
          queries={historyQueries}
          onClose={closeHistory}
        />
      )}
      {!historyQueries && allHistory && queue.canView && (
        <NotificationDeliveryHistory locale={uiLocale} onClose={() => setAllHistory(false)} />
      )}
      {!historyQueries && history && queue.canView && (
        <NotificationDeliveryHistory
          key={history.id}
          target={history}
          locale={uiLocale}
          onClose={() => setHistory(null)}
        />
      )}
      {unconfirmed && !queue.denied && (
        <OperationalCommandReview
          locale={uiLocale}
          endpoint="/api/admin/failed-notifications"
          rows={reviewRows}
          validate={isDeadLetterRow}
          identity={deadLetterIdentity}
          onDenied={queue.deny}
          onReviewed={returnToQueue}
          renderRecord={(row, available) => (
            <>
              <p className="font-semibold">
                {row.eventKey} · {channelLabel(row.channel, uiLocale)}
              </p>
              {available && (
                <p>
                  {statusLabel(row.status, uiLocale)} ·{' '}
                  <bdi dir="ltr">
                    {numbers.number(row.attempts)} / {numbers.number(row.maxAttempts)}
                  </bdi>
                </p>
              )}
              <p className="text-muted-foreground">{row.recipientKey}</p>
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
            const expectedStatus = { retry: 'retried', resolve: 'resolved', dismiss: 'dismissed' }[
              action.kind
            ];
            if (
              !isDeadLetterRow(result) ||
              result.id !== action.row.id ||
              result.outboxId !== action.row.outboxId ||
              result.jobId !== action.row.jobId ||
              result.channel !== action.row.channel ||
              result.status !== expectedStatus
            )
              throw new Error('Invalid action acknowledgment');
            setNotice(action.kind);
            savedTrigger.current = action.trigger;
            queue.refresh();
          }}
        />
      )}
    </section>
  );
}

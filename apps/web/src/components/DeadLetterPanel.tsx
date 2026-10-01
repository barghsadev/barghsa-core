import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useState, useEffect, useId, useRef } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { Button, ListPage, ScrollArea } from '@barghsa/ui';
import type { Locale } from '@barghsa/i18n/app';
import { NotificationDeliveryHistory } from './NotificationDeliveryHistory.js';

import { useOperationalQueue } from '../hooks/useOperationalQueue.js';
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

export default function DeadLetterPanel({ uiLocale }: { uiLocale: Locale }) {
  const time = useAccountTime(uiLocale);
  const numbers = useNumberFormatting(uiLocale);
  const filterId = useId();
  const label = (key: string) => t(`admin.notifications.deadLetter.${key}`, uiLocale);
  const [status, setStatus] = useState('open');
  const [channel, setChannel] = useState('');
  const [severity, setSeverity] = useState('');
  const [offset, setOffset] = useState(0);
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
  const savedTrigger = useRef<HTMLElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const clearPrivate = useCallback(() => {
    setHistory(null);
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
  const previousCriteria = useRef(criteria);
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
    if (previousCriteria.current === criteria) return;
    previousCriteria.current = criteria;
    setAction(null);
    setNotice(null);
    savedTrigger.current = null;
  }, [criteria]);
  useEffect(() => {
    if (!queue.data || loading || error) return;
    if (action && !queue.data.rows.some((row) => basis(row) === basis(action.row))) setAction(null);
    const latest = history && queue.data.rows.find((row) => row.id === history.id);
    if (latest && (latest.outboxId !== history?.outboxId || latest.channel !== history?.channel))
      setHistory(null);
  }, [queue.data, loading, error, action, history]);
  useEffect(() => {
    if (access.data && !access.data.canRetry) setAction(null);
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
    if (!queue.canRetry || row.status !== 'open') return;
    savedTrigger.current = null;
    setNotice(null);
    setAction({
      row,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      kind,
      title: label(kind),
      description: `${label(`${kind}Confirm`)} ${row.eventKey} · ${channelLabel(row.channel, uiLocale)} · ${row.recipientKey ?? ''}`,
      path: `/api/admin/failed-notifications/${row.id}/${kind}`,
      method: 'POST',
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
          <Button variant="outline" onClick={() => setAllHistory(true)}>
            {t('admin.notifications.history.browse', uiLocale)}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={loading || access.loading}
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
                className="block rounded border p-2"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setOffset(0);
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
                className="block rounded border p-2"
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value);
                  setOffset(0);
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
                className="block rounded border p-2"
                value={severity}
                onChange={(e) => {
                  setSeverity(e.target.value);
                  setOffset(0);
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
            <ScrollArea
              scrollbarOrientation="horizontal"
              className="min-w-0 bg-card text-card-foreground rounded-lg border border-border"
            >
              <table
                className="w-full min-w-[60rem] divide-y divide-border text-sm"
                aria-busy={loading}
                aria-label={t('admin.notifications.deadLetter.title', uiLocale)}
              >
                <caption className="sr-only">
                  {t('admin.notifications.deadLetter.title', uiLocale)}
                </caption>
                <thead className="bg-muted/40 text-start">
                  <tr>
                    <th className="px-4 py-2 font-medium text-muted-foreground">
                      {t('admin.notifications.deadLetter.eventKey', uiLocale)}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground">
                      {t('admin.notifications.deadLetter.channel', uiLocale)}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground">
                      {t('admin.notifications.deadLetter.severity', uiLocale)}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground">
                      {t('admin.notifications.deadLetter.cause', uiLocale)}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground">
                      {t('admin.notifications.deadLetter.attempts', uiLocale)}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground">
                      {t('admin.notifications.deadLetter.date', uiLocale)}
                    </th>
                    <th className="px-4 py-2 font-medium text-muted-foreground">
                      {t('admin.notifications.deadLetter.actions', uiLocale)}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                        {row.eventKey}
                      </td>
                      <td className="px-4 py-3">{channelLabel(row.channel, uiLocale)}</td>
                      <td className="px-4 py-3">
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
                      </td>
                      <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                        {row.cause ?? '—'}
                        <details className="mt-2 font-sans" dir={uiLocale === 'fa' ? 'rtl' : 'ltr'}>
                          <summary className="cursor-pointer">{label('details')}</summary>
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
                          <Button variant="outline" onClick={() => setHistory(row)}>
                            {t('admin.notifications.history.title', uiLocale)}
                          </Button>
                        </details>
                      </td>
                      <td className="px-4 py-3">
                        {numbers.number(row.attempts)}/{numbers.number(row.maxAttempts)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {time.format(row.createdAt)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.status === 'open' && access.data?.canRetry ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => act(row, 'retry')}
                              disabled={action !== null || !queue.canRetry}
                              aria-label={`${t('admin.notifications.deadLetter.retry', uiLocale)} ${row.eventKey}`}
                            >
                              {t('admin.notifications.deadLetter.retry', uiLocale)}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => act(row, 'resolve')}
                              disabled={action !== null || !queue.canRetry}
                              aria-label={`${t('admin.notifications.deadLetter.resolve', uiLocale)} ${row.eventKey}`}
                            >
                              {t('admin.notifications.deadLetter.resolve', uiLocale)}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => act(row, 'dismiss')}
                              disabled={action !== null || !queue.canRetry}
                              aria-label={`${t('admin.notifications.deadLetter.dismiss', uiLocale)} ${row.eventKey}`}
                            >
                              {t('admin.notifications.deadLetter.dismiss', uiLocale)}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </ListPage.Content>
        {queue.canView && (
          <nav aria-label={label('pagination')} className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={!queue.canView || loading || error || offset === 0}
              onClick={() => setOffset((v) => Math.max(0, v - 25))}
            >
              {t('admin.jobs.previous', uiLocale)}
            </Button>
            <span>{numbers.number((queue.data?.offset ?? offset) / 25 + 1)}</span>
            <Button
              variant="outline"
              disabled={!queue.canView || loading || error || !hasMore}
              onClick={() => setOffset((v) => v + 25)}
            >
              {t('admin.jobs.next', uiLocale)}
            </Button>
          </nav>
        )}
      </ListPage>
      {allHistory && queue.canView && (
        <NotificationDeliveryHistory locale={uiLocale} onClose={() => setAllHistory(false)} />
      )}
      {history && queue.canView && (
        <NotificationDeliveryHistory
          key={history.id}
          target={history}
          locale={uiLocale}
          onClose={() => setHistory(null)}
        />
      )}
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

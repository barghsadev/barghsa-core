import { useAccountTime } from '../hooks/useAccountTime.js';
import { useState, useEffect, useId } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { Button } from '@barghsa/ui';
import type { Locale } from '@barghsa/i18n';

/**
 * Admin dead-letter queue panel (E-05, T-05.01.06).
 *
 * Lists dead-lettered notification deliveries written by the outbox worker
 * when a job exhausts its retry budget, and exposes the three triage actions:
 * Retry (re-queue with the same idempotency key), Resolve (mark final), and
 * Dismiss (acknowledge/remove from the active view).
 *
 * Reads /api/admin/notifications/dead-letters and posts to the per-record
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
  const filterId = useId();
  const label = (key: string) => t(`admin.notifications.deadLetter.${key}`, uiLocale);
  const [rows, setRows] = useState<DeadLetterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState('open');
  const [channel, setChannel] = useState('');
  const [severity, setSeverity] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [access, setAccess] = useState<{ canView: boolean; canRetry: boolean } | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [notice, setNotice] = useState<'retry' | 'resolve' | 'dismiss' | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const accessResponse = await fetch('/api/admin/failed-notifications/access', {
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
          setRows([]);
          setHasMore(false);
          return;
        }
        const query = new URLSearchParams({
          limit: '26',
          offset: String(offset),
          ...(status ? { status } : {}),
          ...(channel ? { channel } : {}),
          ...(severity ? { severity } : {}),
        });
        const response = await fetch(`/api/admin/failed-notifications?${query}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unavailable');
        const result = (await response.json()) as DeadLetterRow[];
        if (!Array.isArray(result)) throw new Error('Invalid response');
        if (!controller.signal.aborted) {
          setRows(result.slice(0, 25));
          setHasMore(result.length > 25);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [status, channel, severity, offset, revision]);
  function act(row: DeadLetterRow, kind: 'retry' | 'resolve' | 'dismiss') {
    setNotice(null);
    setAction({
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
        <Button variant="outline" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
          {t('admin.jobs.refresh', uiLocale)}
        </Button>
      </div>
      {notice && <p role="status">{label(`${notice}Notice`)}</p>}
      {access?.canView && (
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
      )}
      {error && (
        <div role="alert">
          <p>{label('loadFailed')}</p>
          <Button onClick={() => setRevision((v) => v + 1)}>
            {t('admin.jobs.reload', uiLocale)}
          </Button>
        </div>
      )}
      {!loading && !error && !access?.canView && <p role="alert">{label('accessDenied')}</p>}
      {loading ? (
        <div role="status" className="p-4 text-gray-500">
          {t('admin.notifications.loading', uiLocale)}
        </div>
      ) : error || !access?.canView ? null : rows.length === 0 ? (
        <div className="p-4 text-gray-500">
          {t('admin.notifications.deadLetter.empty', uiLocale)}
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
          <table
            className="min-w-full divide-y divide-gray-200 text-sm"
            aria-label={t('admin.notifications.deadLetter.title', uiLocale)}
          >
            <caption className="sr-only">
              {t('admin.notifications.deadLetter.title', uiLocale)}
            </caption>
            <thead className="bg-gray-50 text-start">
              <tr>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.eventKey', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.channel', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.severity', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.cause', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.attempts', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.date', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.actions', uiLocale)}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
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
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {row.severity === 'critical'
                        ? t('admin.notifications.deadLetter.severityCritical', uiLocale)
                        : t('admin.notifications.deadLetter.severityError', uiLocale)}
                    </span>
                    {row.status !== 'open' && (
                      <span className="block text-xs text-gray-400 mt-1">
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
                    </details>
                  </td>
                  <td className="px-4 py-3">
                    {new Intl.NumberFormat(uiLocale).format(row.attempts)}/
                    {new Intl.NumberFormat(uiLocale).format(row.maxAttempts)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{time.format(row.createdAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.status === 'open' && access?.canRetry ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => act(row, 'retry')}
                          disabled={action !== null}
                          aria-label={`${t('admin.notifications.deadLetter.retry', uiLocale)} ${row.eventKey}`}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          {t('admin.notifications.deadLetter.retry', uiLocale)}
                        </button>
                        <button
                          onClick={() => act(row, 'resolve')}
                          disabled={action !== null}
                          aria-label={`${t('admin.notifications.deadLetter.resolve', uiLocale)} ${row.eventKey}`}
                          className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                        >
                          {t('admin.notifications.deadLetter.resolve', uiLocale)}
                        </button>
                        <button
                          onClick={() => act(row, 'dismiss')}
                          disabled={action !== null}
                          aria-label={`${t('admin.notifications.deadLetter.dismiss', uiLocale)} ${row.eventKey}`}
                          className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {t('admin.notifications.deadLetter.dismiss', uiLocale)}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {access?.canView && !error && (
        <nav aria-label={label('pagination')} className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={loading || offset === 0}
            onClick={() => setOffset((v) => Math.max(0, v - 25))}
          >
            {t('admin.jobs.previous', uiLocale)}
          </Button>
          <span>{new Intl.NumberFormat(uiLocale).format(offset / 25 + 1)}</span>
          <Button
            variant="outline"
            disabled={loading || !hasMore}
            onClick={() => setOffset((v) => v + 25)}
          >
            {t('admin.jobs.next', uiLocale)}
          </Button>
        </nav>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setNotice(
              action.path.endsWith('/retry')
                ? 'retry'
                : action.path.endsWith('/resolve')
                  ? 'resolve'
                  : 'dismiss'
            );
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}

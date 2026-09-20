import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import type { Locale } from '@barghsa/i18n/app';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface DeliveryAttempt {
  id: string;
  notificationId: string;
  channel: string;
  status: 'delivered' | 'failed' | 'sending' | 'unknown';
  attemptNumber: number;
  providerRef: string | null;
  latencyMs: number | null;
  errorCategory: string | null;
  errorDetail: string | null;
  createdAt: string;
}
interface Target {
  outboxId: string;
  channel: string;
  eventKey: string;
}

interface Filters {
  notificationId: string;
  channel: string;
  status: string;
}
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function isAttempt(value: unknown, filters: Filters): value is DeliveryAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    UUID.test(row.id) &&
    typeof row.notificationId === 'string' &&
    UUID.test(row.notificationId) &&
    (!filters.notificationId ||
      row.notificationId.toLowerCase() === filters.notificationId.toLowerCase()) &&
    typeof row.channel === 'string' &&
    ['in_app', 'email', 'sms'].includes(row.channel) &&
    (!filters.channel || row.channel === filters.channel) &&
    (!filters.status || row.status === filters.status) &&
    typeof row.status === 'string' &&
    ['delivered', 'failed', 'sending', 'unknown'].includes(row.status) &&
    Number.isSafeInteger(row.attemptNumber) &&
    Number(row.attemptNumber) > 0 &&
    (row.latencyMs === null ||
      (Number.isSafeInteger(row.latencyMs) && Number(row.latencyMs) >= 0)) &&
    [row.providerRef, row.errorCategory, row.errorDetail].every(
      (item) => item === null || typeof item === 'string'
    ) &&
    typeof row.createdAt === 'string' &&
    Number.isFinite(Date.parse(row.createdAt))
  );
}

export function NotificationDeliveryHistory({
  target,
  locale,
  onClose,
}: {
  target?: Target;
  locale: Locale;
  onClose: () => void;
}) {
  const label = (key: string) => t(`admin.notifications.history.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const time = useAccountTime(locale);
  const [rows, setRows] = useState<DeliveryAttempt[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState<Filters>({ notificationId: '', channel: '', status: '' });
  const [filters, setFilters] = useState<Filters>(draft);
  const channelLabel = (channel: string) =>
    t(
      `admin.notifications.deadLetter.channel${channel === 'email' ? 'Email' : channel === 'sms' ? 'Sms' : 'InApp'}`,
      locale
    );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setRows([]);
    setHasMore(false);
    void (async () => {
      try {
        const applied = target
          ? { notificationId: target.outboxId, channel: target.channel, status: '' }
          : filters;
        const query = new URLSearchParams({
          limit: '26',
          offset: String(offset),
        });
        for (const [key, value] of Object.entries(applied)) if (value) query.set(key, value);
        const response = await fetch(`/api/admin/notifications/delivery-logs?${query}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('History unavailable');
        const result: unknown = await response.json();
        if (
          !Array.isArray(result) ||
          result.length > 26 ||
          !result.every((item): item is DeliveryAttempt => isAttempt(item, applied)) ||
          new Set(result.map((item) => item.id)).size !== result.length
        )
          throw new Error('Invalid history');
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
  }, [target, filters, offset, revision]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-4xl max-h-[85vh] overflow-y-auto"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle>{label('title')}</DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                <bdi>{target.eventKey}</bdi> · {channelLabel(target.channel)}
              </>
            ) : (
              label('allDescription')
            )}
          </DialogDescription>
        </DialogHeader>
        {!target && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters({ ...draft, notificationId: draft.notificationId.trim() });
              setOffset(0);
            }}
          >
            <label className="min-w-0 flex-1 space-y-1">
              {label('notificationId')}
              <Input
                dir="ltr"
                value={draft.notificationId}
                pattern={UUID.source.slice(1, -1)}
                onChange={(event) =>
                  setDraft({ ...draft, notificationId: event.target.value.trim() })
                }
              />
            </label>
            <label className="space-y-1">
              {label('channel')}
              <select
                className="block rounded border p-2"
                value={draft.channel}
                onChange={(event) => setDraft({ ...draft, channel: event.target.value })}
              >
                <option value="">{label('all')}</option>
                {['in_app', 'email', 'sms'].map((channel) => (
                  <option key={channel} value={channel}>
                    {channelLabel(channel)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              {label('status')}
              <select
                className="block rounded border p-2"
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value })}
              >
                <option value="">{label('all')}</option>
                {['delivered', 'failed', 'sending', 'unknown'].map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">{label('search')}</Button>
          </form>
        )}
        {time.notice}
        <p className="text-sm">{label('attemptHelp')}</p>
        {loading ? (
          <p role="status">{t('admin.notifications.loading', locale)}</p>
        ) : error ? (
          <div role="alert">
            <p>{label('loadFailed')}</p>
            <Button onClick={() => setRevision((value) => value + 1)}>
              {t('admin.jobs.reload', locale)}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p>{label('empty')}</p>
        ) : (
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll this region.
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label('title')}>
            <table className="w-full text-sm text-start" aria-label={label('title')}>
              <thead>
                <tr>
                  {!target && (
                    <>
                      <th className="border-b p-2 text-start">{label('notificationId')}</th>
                      <th className="border-b p-2 text-start">{label('channel')}</th>
                    </>
                  )}
                  {['attempt', 'date', 'status', 'receipt', 'latency', 'error'].map((key) => (
                    <th className="border-b p-2 text-start" key={key}>
                      {label(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {!target && (
                      <>
                        <td className="border-b p-2">
                          <bdi className="break-all">{row.notificationId}</bdi>
                        </td>
                        <td className="border-b p-2">{channelLabel(row.channel)}</td>
                      </>
                    )}
                    <td className="border-b p-2">{numbers.number(row.attemptNumber)}</td>
                    <td className="border-b p-2 whitespace-nowrap">{time.format(row.createdAt)}</td>
                    <td className="border-b p-2">{label(row.status)}</td>
                    <td className="border-b p-2">
                      <bdi className="break-all">{row.providerRef ?? '—'}</bdi>
                    </td>
                    <td className="border-b p-2">
                      {row.latencyMs === null ? '—' : numbers.number(row.latencyMs)}
                    </td>
                    <td className="border-b p-2">
                      <bdi className="break-words">{row.errorCategory ?? '—'}</bdi>
                      {row.errorDetail && (
                        <p className="break-words">
                          <bdi>{row.errorDetail}</bdi>
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!error && (
          <nav aria-label={label('pagination')} className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={loading || offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - 25))}
            >
              {t('admin.jobs.previous', locale)}
            </Button>
            <span>{numbers.number(offset / 25 + 1)}</span>
            <Button
              variant="outline"
              disabled={loading || !hasMore}
              onClick={() => setOffset((value) => value + 25)}
            >
              {t('admin.jobs.next', locale)}
            </Button>
          </nav>
        )}
      </DialogContent>
    </Dialog>
  );
}

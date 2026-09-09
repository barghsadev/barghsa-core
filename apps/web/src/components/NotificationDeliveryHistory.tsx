import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import type { Locale } from '@barghsa/i18n/app';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface DeliveryAttempt {
  id: string;
  notificationId: string;
  channel: string;
  status: 'delivered' | 'failed';
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

function isAttempt(value: unknown, target: Target): value is DeliveryAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id) &&
    row.notificationId === target.outboxId &&
    row.channel === target.channel &&
    (row.status === 'delivered' || row.status === 'failed') &&
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
  target: Target;
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
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setRows([]);
    setHasMore(false);
    void (async () => {
      try {
        const query = new URLSearchParams({
          notificationId: target.outboxId,
          channel: target.channel,
          limit: '26',
          offset: String(offset),
        });
        const response = await fetch(`/api/admin/notifications/delivery-logs?${query}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('History unavailable');
        const result: unknown = await response.json();
        if (
          !Array.isArray(result) ||
          result.length > 26 ||
          !result.every((item): item is DeliveryAttempt => isAttempt(item, target)) ||
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
  }, [target, offset, revision]);

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
            <bdi>{target.eventKey}</bdi> ·{' '}
            {t(
              `admin.notifications.deadLetter.channel${target.channel === 'email' ? 'Email' : target.channel === 'sms' ? 'Sms' : 'InApp'}`,
              locale
            )}
          </DialogDescription>
        </DialogHeader>
        {time.notice}
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

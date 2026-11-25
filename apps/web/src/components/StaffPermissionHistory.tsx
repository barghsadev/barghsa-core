import { readWithDeadline, ServerQueryError } from '../lib/server-query-client.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useEffect, useRef, useState } from 'react';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/workspace';
import { LoadingStatus, Button, type DateRangeValue } from '@barghsa/ui';
import { XIcon } from 'lucide-react';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';
import { useHistoryFilterDraft } from '../hooks/useHistoryFilterDraft.js';
import { HistoryDateFilter } from './HistoryDateFilter.js';
import { HistoryFilterPanel } from './HistoryFilterPanel.js';

interface Event {
  id: string;
  targetUserId: string;
  targetUsername: string | null;
  actorUserId: string;
  actorUsername: string | null;
  addedRoles: { roleId: string; roleName: string }[];
  removedRoles: { roleId: string; roleName: string }[];
  reason: string | null;
  createdAt: string;
}
function isHistory(value: unknown, targetId?: string): value is { items: Event[]; total: number } {
  if (!value || typeof value !== 'object') return false;
  const { items, total } = value as Record<string, unknown>;
  const roles = (rows: unknown) =>
    Array.isArray(rows) &&
    rows.every((row) => row && typeof row.roleId === 'string' && typeof row.roleName === 'string');
  const nullableText = (entry: unknown) => entry === null || typeof entry === 'string';
  return (
    typeof total === 'number' &&
    Number.isSafeInteger(total) &&
    total >= 0 &&
    Array.isArray(items) &&
    items.length <= 25 &&
    items.every(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.targetUserId === 'string' &&
        (!targetId || entry.targetUserId === targetId) &&
        nullableText(entry.targetUsername) &&
        typeof entry.actorUserId === 'string' &&
        nullableText(entry.actorUsername) &&
        nullableText(entry.reason) &&
        typeof entry.createdAt === 'string' &&
        Number.isFinite(Date.parse(entry.createdAt)) &&
        roles(entry.addedRoles) &&
        roles(entry.removedRoles)
    )
  );
}

export function StaffPermissionHistory({
  target,
  onClose,
  onDenied,
}: {
  target: { userId: string; username: string } | null;
  onClose: () => void;
  onDenied: () => void;
}) {
  const zone = useTimezone();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.staff.audit.${key}`, locale);
  const [filters, setFilters] = useState<DateRangeValue>({});
  const [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [data, setData] = useState<{ items: Event[]; total: number }>({ items: [], total: 0 });
  const notifyDenied = useRef(onDenied);
  notifyDenied.current = onDenied;
  const applyRange = (range: DateRangeValue) => {
    setFilters(range);
    setOffset(0);
  };
  const applied = { query: { q: '' }, statuses: [], dateRange: filters };
  const draft = useHistoryFilterDraft(applied, ({ dateRange }) => {
    if (zone.status === 'ready') applyRange(dateRange);
  });
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const query = new URLSearchParams({
      limit: '25',
      offset: String(offset),
      ...(target ? { userId: target.userId } : {}),
    });
    if (filters.from) query.set('from', filters.from);
    // The audit endpoint uses an inclusive upper bound.
    if (filters.to) query.set('to', new Date(Date.parse(filters.to) - 1).toISOString());
    void readWithDeadline(controller.signal, async (signal) => {
      const response = await fetch(`/api/admin/staff/audit?${query}`, { signal });
      if (!response.ok) throw new ServerQueryError(response.status);
      const result: unknown = await response.json();
      if (!isHistory(result, target?.userId)) throw new Error('Invalid staff history');
      return result;
    })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(true);
        if (failure instanceof ServerQueryError && [401, 403].includes(failure.status)) {
          setData({ items: [], total: 0 });
          notifyDenied.current();
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, offset, revision, target]);
  const roleName = (role: { roleId: string; roleName: string }) => {
    const key = `admin.staff.role.${role.roleId}.name`,
      value = t(key, locale);
    return value === key ? role.roleName : value;
  };
  const dateLabel = appText('historyDates.preset', locale);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    timeZone: zone.timezone,
    dateStyle: 'medium',
  });
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" aria-label={label('title')}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{label('title')}</h2>
          {target && (
            <p className="mt-1 text-sm break-words text-muted-foreground">
              <bdi>{target.username}</bdi>
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label('close')}
          title={label('close')}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </header>
      <HistoryFilterPanel
        {...applied}
        dateLabel={dateLabel}
        formatDate={(value) => dateFormat.format(new Date(value))}
        onOpen={draft.begin}
        onApply={draft.apply}
        onClear={() => applyRange({})}
        onRemoveFilter={() => applyRange({})}
      >
        <HistoryDateFilter
          value={draft.draft.dateRange}
          onChange={draft.setDateRange}
          locale={locale}
          time={zone}
          inline
        />
        {zone.status === 'ready' && (
          <p className="text-sm text-muted-foreground">
            {label('timezone').replace('{timezone}', zone.timezone)}
          </p>
        )}
      </HistoryFilterPanel>
      {loading || zone.status === 'loading' ? (
        <LoadingStatus>{label('loading')}</LoadingStatus>
      ) : error || zone.status === 'error' ? (
        <div role="alert">
          {label('error')}{' '}
          <Button
            variant="outline"
            onClick={() => {
              setRevision((value) => value + 1);
              if (zone.status === 'error') zone.retry();
            }}
          >
            {label('retry')}
          </Button>
        </div>
      ) : (
        <>
          {!data.items.length && <p role="status">{label('empty')}</p>}
          <ol className="space-y-3">
            {data.items.map((event) => (
              <li key={event.id} className="space-y-2 border-s-2 ps-4 py-2">
                <div className="font-medium">
                  <bdi>{event.targetUsername ?? event.targetUserId}</bdi>
                </div>
                <p className="text-sm">
                  {label('by')} <bdi>{event.actorUsername ?? event.actorUserId}</bdi> ·{' '}
                  <time dateTime={event.createdAt}>
                    {new Intl.DateTimeFormat(locale, {
                      timeZone: zone.timezone,
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(event.createdAt))}
                  </time>
                </p>
                {event.addedRoles.length > 0 && (
                  <p>
                    {label('added')}:{' '}
                    {event.addedRoles.map(roleName).join(locale === 'fa' ? '، ' : ', ')}
                  </p>
                )}
                {event.removedRoles.length > 0 && (
                  <p>
                    {label('removed')}:{' '}
                    {event.removedRoles.map(roleName).join(locale === 'fa' ? '، ' : ', ')}
                  </p>
                )}
                {!event.addedRoles.length && !event.removedRoles.length && (
                  <p>{label('unchanged')}</p>
                )}
                {event.reason && (
                  <p className="text-sm">
                    {label('reason')}: {event.reason}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <nav className="flex flex-wrap items-center gap-3" aria-label={label('pages')}>
            <Button
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 25))}
            >
              {label('previous')}
            </Button>
            <span>{label('total').replace('{count}', numbers.number(data.total))}</span>
            <Button
              variant="outline"
              disabled={offset + 25 >= data.total}
              onClick={() => setOffset(offset + 25)}
            >
              {label('next')}
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}

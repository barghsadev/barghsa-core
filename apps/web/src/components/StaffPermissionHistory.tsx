import { readWithDeadline } from '../lib/server-query-client.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useEffect, useState } from 'react';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { LoadingStatus, Button, DatePicker, datePickerDayBounds, Label } from '@barghsa/ui';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';

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
}: {
  target: { userId: string; username: string } | null;
  onClose: () => void;
}) {
  const zone = useTimezone();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.staff.audit.${key}`, locale);
  const [from, setFrom] = useState<Date>(),
    [to, setTo] = useState<Date>();
  const [filters, setFilters] = useState<{ from?: string; to?: string }>({});
  const [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [data, setData] = useState<{ items: Event[]; total: number }>({ items: [], total: 0 });
  const invalid = !!from && !!to && from.getTime() > to.getTime();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const query = new URLSearchParams({
      ...filters,
      limit: '25',
      offset: String(offset),
      ...(target ? { userId: target.userId } : {}),
    });
    void readWithDeadline(controller.signal, async (signal) => {
      const response = await fetch(`/api/admin/staff/audit?${query}`, { signal });
      if (!response.ok) throw new Error('Unavailable');
      const result: unknown = await response.json();
      if (!isHistory(result, target?.userId)) throw new Error('Invalid staff history');
      return result;
    })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
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
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4" aria-label={label('title')}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {label('title')}
          {target && (
            <>
              : <bdi>{target.username}</bdi>
            </>
          )}
        </h2>
        <Button variant="outline" onClick={onClose}>
          {label('close')}
        </Button>
      </header>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid || zone.status !== 'ready') return;
          const next: { from?: string; to?: string } = {};
          if (from) {
            const { start } = datePickerDayBounds(from, zone.timezone);
            next.from = start.toISOString();
          }
          if (to) {
            const { end } = datePickerDayBounds(to, zone.timezone);
            next.to = end.toISOString();
          }
          setOffset(0);
          setFilters(next);
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="staff-audit-from">{label('from')}</Label>
            <DatePicker
              id="staff-audit-from"
              label={label('from')}
              placeholder={label('from')}
              locale={locale}
              timezone={zone.timezone}
              disabled={zone.status !== 'ready'}
              {...(from ? { value: from } : {})}
              onChange={setFrom}
            />
          </div>
          <div>
            <Label htmlFor="staff-audit-to">{label('to')}</Label>
            <DatePicker
              id="staff-audit-to"
              label={label('to')}
              placeholder={label('to')}
              locale={locale}
              timezone={zone.timezone}
              disabled={zone.status !== 'ready'}
              {...(to ? { value: to } : {})}
              onChange={setTo}
            />
          </div>
          <Button type="submit" disabled={invalid || zone.status !== 'ready'}>
            {label('apply')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setFrom(undefined);
              setTo(undefined);
              setFilters({});
              setOffset(0);
            }}
          >
            {label('clear')}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {zone.status === 'ready' && label('timezone').replace('{timezone}', zone.timezone)}
        </p>
        {invalid && <p role="alert">{label('invalidRange')}</p>}
      </form>
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
          {!data.items.length && <p>{label('empty')}</p>}
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
          <nav className="flex items-center gap-3" aria-label={label('pages')}>
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

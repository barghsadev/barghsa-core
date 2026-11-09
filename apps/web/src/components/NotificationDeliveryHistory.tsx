import { useCompactRecords } from '../hooks/useCompactRecords.js';
import { RecordFields } from './RecordFields.js';
import type { HistoryColumn } from './HistoryTable.js';
import { useEffect, useId, useRef, useState } from 'react';
import {
  LoadingStatus,
  Button,
  CardListView,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import type { Locale } from '@barghsa/i18n/app';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useServerListQuery } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { ServerQueryError } from '../lib/server-query-client.js';

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
  onDenied,
  queries,
}: {
  target?: Target | undefined;
  locale: Locale;
  onClose: () => void;
  onDenied?: () => void;
  queries?: ListQueryBinding | undefined;
}) {
  const compact = useCompactRecords();
  const label = (key: string) => t(`admin.notifications.history.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const time = useAccountTime(locale);
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const reader = useId();
  const notifyDenied = useRef(onDenied);
  notifyDenied.current = onDenied;
  const [localOffset, setOffset] = useState(0);
  const offset = queries ? (queries.query.page - 1) * 25 : localOffset;
  const [revision, setRevision] = useState(0);
  const [localFilters, setFilters] = useState<Filters>({
    notificationId: '',
    channel: '',
    status: '',
  });
  const notificationId =
    target?.outboxId ??
    (queries ? queries.query.filters.notificationId || '' : localFilters.notificationId);
  const channel =
    target?.channel ?? (queries ? queries.query.filters.channel || '' : localFilters.channel);
  const status = target ? '' : queries ? queries.query.filters.status || '' : localFilters.status;
  const [draft, setDraft] = useState<Filters>({ notificationId, channel, status });
  useEffect(() => {
    setDraft({ notificationId, channel, status });
  }, [notificationId, channel, status]);
  const channelLabel = (channel: string) =>
    t(
      `admin.notifications.deadLetter.channel${channel === 'email' ? 'Email' : channel === 'sms' ? 'Sms' : 'InApp'}`,
      locale
    );
  const applied = { notificationId, channel, status };
  const params = new URLSearchParams({ limit: '26', offset: String(offset) });
  for (const [key, value] of Object.entries(applied)) if (value) params.set(key, value);
  const path = '/api/admin/notifications/delivery-logs';
  const keyParams = new URLSearchParams(params);
  keyParams.set('endpoint', path);
  keyParams.set('reader', reader);
  const delivery = useServerListQuery({
    queryKey: queryKeys.notifications.list(
      { context: 'staff', ownerId: accountId ?? reader, accountId, revision: profileRevision },
      keyParams,
      revision
    ),
    manual: true,
    read: async (signal) => {
      const response = await fetch(`${path}?${params}`, { signal });
      if (!response.ok) throw new ServerQueryError(response.status);
      const result: unknown = await response.json();
      if (
        !Array.isArray(result) ||
        result.length > 26 ||
        !result.every((item): item is DeliveryAttempt => isAttempt(item, applied)) ||
        new Set(result.map((item) => item.id)).size !== result.length
      )
        throw new Error('Invalid history');
      return result;
    },
  });
  const loading = delivery.isPending || delivery.isFetching;
  const error = delivery.isError;
  const forbidden =
    delivery.error instanceof ServerQueryError && [401, 403].includes(delivery.error.status);
  useEffect(() => {
    if (forbidden) notifyDenied.current?.();
  }, [forbidden]);
  const rows = delivery.data?.slice(0, 25) ?? [];
  const hasMore = (delivery.data?.length ?? 0) > 25;
  const columns: HistoryColumn<DeliveryAttempt>[] = [
    ...(!target
      ? [
          {
            id: 'notificationId',
            label: label('notificationId'),
            render: (row: DeliveryAttempt) => <bdi className="break-all">{row.notificationId}</bdi>,
          },
          {
            id: 'channel',
            label: label('channel'),
            render: (row: DeliveryAttempt) => channelLabel(row.channel),
          },
        ]
      : []),
    { id: 'attempt', label: label('attempt'), render: (row) => numbers.number(row.attemptNumber) },
    {
      id: 'date',
      label: label('date'),
      render: (row) => <time dateTime={row.createdAt}>{time.format(row.createdAt)}</time>,
    },
    { id: 'status', label: label('status'), render: (row) => label(row.status) },
    {
      id: 'receipt',
      label: label('receipt'),
      render: (row) => <bdi className="break-all">{row.providerRef ?? '—'}</bdi>,
    },
    {
      id: 'latency',
      label: label('latency'),
      render: (row) => (row.latencyMs === null ? '—' : numbers.number(row.latencyMs)),
    },
    {
      id: 'error',
      label: label('error'),
      render: (row) => (
        <>
          <bdi className="break-words">{row.errorCategory ?? '—'}</bdi>
          {row.errorDetail && (
            <p className="break-words">
              <bdi>{row.errorDetail}</bdi>
            </p>
          )}
        </>
      ),
    },
  ];

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
              const filters = { ...draft, notificationId: draft.notificationId.trim() };
              if (
                filters.notificationId === notificationId &&
                filters.channel === channel &&
                filters.status === status &&
                offset === 0
              )
                setRevision((value) => value + 1);
              if (queries) queries.setQuery({ filters: { ...filters }, page: 1 });
              else {
                setFilters(filters);
                setOffset(0);
              }
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
        {loading && rows.length > 0 && (
          <LoadingStatus>{t('admin.notifications.loading', locale)}</LoadingStatus>
        )}
        {loading && rows.length === 0 ? (
          <LoadingStatus>{t('admin.notifications.loading', locale)}</LoadingStatus>
        ) : error ? (
          <div role="alert">
            <p>{label('loadFailed')}</p>
            <Button onClick={() => setRevision((value) => value + 1)}>
              {t('admin.jobs.reload', locale)}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p role="status">{label('empty')}</p>
        ) : compact ? (
          <CardListView
            data={rows}
            keyExtractor={(row) => row.id}
            label={label('title')}
            locale={locale}
            renderCard={(row) => <RecordFields item={row} columns={columns} />}
          />
        ) : (
          <div
            className="overflow-x-auto"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll this region.
            tabIndex={0}
            role="region"
            aria-label={label('title')}
            aria-busy={loading}
          >
            <table className="w-full text-start text-sm">
              <caption className="sr-only">{label('title')}</caption>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th scope="col" className="border-b p-2 text-start" key={column.id}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((column) => (
                      <td key={column.id} className="border-b p-2">
                        {column.render(row)}
                      </td>
                    ))}
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
              onClick={() =>
                queries
                  ? queries.setQuery({ page: Math.max(1, queries.query.page - 1) })
                  : setOffset((value) => Math.max(0, value - 25))
              }
            >
              {t('admin.jobs.previous', locale)}
            </Button>
            <span>{numbers.number(offset / 25 + 1)}</span>
            <Button
              variant="outline"
              disabled={
                loading || !hasMore || (queries !== undefined && queries.query.page >= 1_000_000)
              }
              onClick={() =>
                queries
                  ? queries.setQuery({ page: queries.query.page + 1 })
                  : setOffset((value) => value + 25)
              }
            >
              {t('admin.jobs.next', locale)}
            </Button>
          </nav>
        )}
      </DialogContent>
    </Dialog>
  );
}

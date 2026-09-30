import { useListView } from '../hooks/useListView.js';
import { HistoryTable, type HistoryColumn } from '../components/HistoryTable.js';
import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import { HistoryListControls } from '../components/HistoryListControls.js';
import { DEFAULT_HISTORY_SORT, type HistoryQuery } from '@barghsa/shared/validation';
import { HistoryDateFilter } from '../components/HistoryDateFilter.js';
import type { DateRangeFilterValue } from '@barghsa/shared/validation';
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { StatusFilter, StatusBadge, ListViewToggle } from '@barghsa/ui';
import { SOLAR_REQUEST_STATUSES } from '@barghsa/shared/validation';
import { useCursorHistory } from '../hooks/useCursorHistory.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { statusFilterTone } from '../lib/status-filter-tone.js';
import { tSolar } from '@barghsa/i18n/solar';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { solarNextAction } from '../lib/solar-next-action.js';

interface RequestRow {
  id: string;
  status: string;
  building_type: string;
  grid_type: string;
  submitted_at: string;
  contract_id: string | null;
  contract_published: boolean;
  initial_invoice_id: string | null;
  initial_invoice_state: string | null;
}

export function SolarRequestsPage({
  statuses = [],
  onStatusesChange,
  dateRange = {},
  onDateRangeChange,
  query = { q: '', sort: DEFAULT_HISTORY_SORT },
  onQueryChange,
  onClearFilters,
  onRemoveFilter,
}: {
  statuses?: readonly string[];
  onStatusesChange?: (statuses: string[]) => void;
  dateRange?: DateRangeFilterValue;
  onDateRangeChange?: (range: DateRangeFilterValue) => void;
  query?: HistoryQuery;
  onQueryChange?: (query: HistoryQuery) => void;
  onClearFilters?: () => void;
  onRemoveFilter?: (key: HistoryFilterKey, value?: string) => void;
}) {
  const { view, setView } = useListView('solar-requests');
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const statusOptions: Parameters<typeof StatusFilter>[0]['options'] = SOLAR_REQUEST_STATUSES.map(
    (value) => ({
      value,
      label: copy(`status_${value}`),
      tone: statusFilterTone(value),
    })
  );
  const statusesKey = statuses.join(',');
  const rangeKey = `${dateRange.from ?? ''}:${dateRange.to ?? ''}`;
  const {
    items: rows,
    before,
    nextBefore,
    acceptPage,
    loadMore,
  } = useCursorHistory<RequestRow>(`${statusesKey}:${rangeKey}:${query.q}:${query.sort}`);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const profileResponse = await fetch('/api/profiles', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!profileResponse.ok) throw new Error('profile');
        const profile = (await profileResponse.json()) as { activeProfileId: string | null };
        if (!profile.activeProfileId) {
          if (!controller.signal.aborted) acceptPage([], null);
          return;
        }
        const params = new URLSearchParams({ profileId: profile.activeProfileId });
        if (before) params.set('before', before);
        if (statusesKey) params.set('statuses', statusesKey);
        if (dateRange.from) params.set('from', dateRange.from);
        if (dateRange.to) params.set('to', dateRange.to);
        if (query.q) params.set('q', query.q);
        if (query.sort !== DEFAULT_HISTORY_SORT) params.set('sort', query.sort);
        const response = await fetch(`/api/solar/requests?${params}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('requests');
        const result = (await response.json()) as {
          requests: RequestRow[];
          nextBefore: string | null;
        };
        if (!controller.signal.aborted) {
          acceptPage(result.requests, result.nextBefore);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [
    before,
    revision,
    statusesKey,
    dateRange.from,
    dateRange.to,
    query.q,
    query.sort,
    acceptPage,
  ]);
  const columns: HistoryColumn<RequestRow>[] = [
    {
      id: 'reference',
      label: t('historySearch.reference', locale),
      render: (row) => (
        <Link
          to="/solar/requests/$requestId"
          params={{ requestId: row.id }}
          className="text-primary underline underline-offset-4"
        >
          <bdi dir="ltr" className="break-all">
            {row.id}
          </bdi>
        </Link>
      ),
    },
    {
      id: 'type',
      label: t('historyView.type', locale),
      render: (row) => copy(row.building_type === 'non_household' ? 'nonHousehold' : 'building'),
    },
    {
      id: 'connection',
      label: copy('gridType'),
      render: (row) => copy(row.grid_type === 'off_grid' ? 'offGrid' : 'onGrid'),
    },
    {
      id: 'status',
      label: copy('status'),
      render: (row) => (
        <StatusBadge label={copy(`status_${row.status}`)} tone={statusFilterTone(row.status)} />
      ),
    },
    {
      id: 'action',
      label: t('workflow.nextAction', locale),
      render: (row) => {
        const action = solarNextAction(row, locale);
        const href = action.href?.startsWith('#')
          ? `/solar/requests/${encodeURIComponent(row.id)}${action.href}`
          : action.href;
        return (
          <div className="min-w-44 space-y-1">
            {href ? (
              <a href={href} className="text-primary underline underline-offset-4">
                {action.text}
              </a>
            ) : (
              <p>{action.text}</p>
            )}
            <p className="text-muted-foreground">
              {t('workflow.owner', locale)}: {t(`workflow.owner.${action.owner}`, locale)}
            </p>
          </div>
        );
      },
    },
    {
      id: 'submitted',
      label: t('historyView.submitted', locale),
      render: (row) => (
        <time dateTime={row.submitted_at}>
          {time.format(row.submitted_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </time>
      ),
    },
  ];
  return (
    <main
      className={`mx-auto w-full min-w-0 space-y-5 px-4 py-8 ${view === 'table' ? 'max-w-7xl' : 'max-w-3xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-3xl font-semibold">{copy('myRequests')}</h1>
      <Link
        to="/solar/requests/new"
        className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground"
      >
        {copy('submit')}
      </Link>
      {time.notice}
      <ListViewToggle
        value={view}
        onChange={setView}
        labels={{
          group: t('historyView.group', locale),
          table: t('historyView.table', locale),
          card: t('historyView.card', locale),
        }}
      />
      <HistoryFilterPanel
        query={query}
        statuses={statuses}
        dateRange={dateRange}
        onClear={onClearFilters}
        onRemoveFilter={onRemoveFilter}
        statusOptions={statusOptions}
        formatDate={(value) => time.format(value, { dateStyle: 'medium', timeStyle: 'short' })}
      >
        {onQueryChange && (
          <HistoryListControls
            value={query}
            onChange={onQueryChange}
            locale={locale}
            domain="solar"
          />
        )}
        {onDateRangeChange && (
          <HistoryDateFilter
            value={dateRange}
            onChange={onDateRangeChange}
            locale={locale}
            time={time}
          />
        )}
        {onStatusesChange && (
          <StatusFilter
            label={copy('filterStatus')}
            clearLabel={copy('clearFilters')}
            countLabel={numbers.number(statuses.length)}
            value={statuses}
            onChange={onStatusesChange}
            options={statusOptions}
          />
        )}
      </HistoryFilterPanel>
      {loading && <p role="status">{copy('loading')}</p>}
      {error && <p role="alert">{copy('notFound')}</p>}
      {error && (
        <button
          type="button"
          className="text-primary underline"
          onClick={() => setRevision((n) => n + 1)}
        >
          {copy('retry')}
        </button>
      )}
      {!loading && !error && !rows.length && (
        <p>
          {dateRange.from || dateRange.to || query.q
            ? t('historyDates.empty', locale)
            : copy(statuses.length ? 'filteredEmpty' : 'none')}
        </p>
      )}
      {view === 'table' && rows.length ? (
        <HistoryTable
          caption={copy('myRequests')}
          items={rows}
          columns={columns}
          rowKey={(row) => row.id}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const action = solarNextAction(row, locale);
            return (
              <li key={row.id}>
                <Link
                  to="/solar/requests/$requestId"
                  params={{ requestId: row.id }}
                  className="block rounded-xl border p-4 hover:border-primary"
                >
                  <span className="font-medium">
                    {copy(row.building_type === 'non_household' ? 'nonHousehold' : 'building')}
                  </span>
                  <span className="ms-3 text-muted-foreground">
                    {copy(row.grid_type === 'off_grid' ? 'offGrid' : 'onGrid')}
                  </span>
                  <span className="mt-2 block text-sm">
                    {copy('status')}: {copy(`status_${row.status}`)}
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    {t('workflow.nextAction', locale)}: {action.text}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {t('workflow.owner', locale)}: {t(`workflow.owner.${action.owner}`, locale)}
                  </span>
                  <span className="block break-all text-xs text-muted-foreground">
                    {t('historySearch.reference', locale)}: <bdi>{row.id}</bdi>
                  </span>
                  <time className="text-sm text-muted-foreground" dateTime={row.submitted_at}>
                    {time.format(row.submitted_at, {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {nextBefore && !error && (
        <button
          type="button"
          className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          disabled={loading}
          onClick={loadMore}
        >
          {copy('moreRequests')}
        </button>
      )}
    </main>
  );
}

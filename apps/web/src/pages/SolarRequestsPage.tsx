import { ListPage, Button, PageHeader, buttonVariants } from '@barghsa/ui';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { Plus } from 'lucide-react';
import {
  useHistoryFilterDraft,
  type HistoryFilterSelection,
} from '../hooks/useHistoryFilterDraft.js';
import { useListView } from '../hooks/useListView.js';
import { HistoryTable, type HistoryColumn } from '../components/HistoryTable.js';
import type { HistoryFilterKey } from '../lib/history-filter-state.js';
import { HistoryFilterPanel } from '../components/HistoryFilterPanel.js';
import { HistoryListControls } from '../components/HistoryListControls.js';
import { DEFAULT_HISTORY_SORT, type HistoryQuery } from '@barghsa/shared/validation';
import { HistoryDateFilter } from '../components/HistoryDateFilter.js';
import type { DateRangeFilterValue } from '@barghsa/shared/validation';
import { Link } from '@tanstack/react-router';
import { StatusFilter, StatusBadge, ListViewToggle } from '@barghsa/ui';
import { SOLAR_REQUEST_STATUSES } from '@barghsa/shared/validation';
import { useCustomerServiceHistory } from '../hooks/useCustomerServiceHistory.js';
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

const identifyHistoryRow = (row: RequestRow) => row.id;

export function SolarRequestsPage({
  statuses = [],
  onStatusesChange,
  dateRange = {},
  onDateRangeChange,
  query = { q: '', sort: DEFAULT_HISTORY_SORT },
  onQueryChange,
  onClearFilters,
  onApplyFilters,
  onRemoveFilter,
}: {
  statuses?: readonly string[];
  onStatusesChange?: (statuses: string[]) => void;
  dateRange?: DateRangeFilterValue;
  onDateRangeChange?: (range: DateRangeFilterValue) => void;
  query?: HistoryQuery;
  onQueryChange?: (query: HistoryQuery) => void;
  onClearFilters?: () => void;
  onApplyFilters?: (selection: HistoryFilterSelection<HistoryQuery>) => void;
  onRemoveFilter?: (key: HistoryFilterKey, value?: string) => void;
}) {
  const filterDraft = useHistoryFilterDraft({ query, statuses, dateRange }, onApplyFilters);
  const filterQuery = onApplyFilters ? filterDraft.draft.query : query;
  const filterStatuses = onApplyFilters ? filterDraft.draft.statuses : statuses;
  const filterDateRange = onApplyFilters ? filterDraft.draft.dateRange : dateRange;
  const onDraftQueryChange = onApplyFilters ? filterDraft.setQuery : onQueryChange;
  const onDraftStatusesChange = onApplyFilters ? filterDraft.setStatuses : onStatusesChange;
  const onDraftDateRangeChange = onApplyFilters ? filterDraft.setDateRange : onDateRangeChange;

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
  const params = new URLSearchParams();
  if (statusesKey) params.set('statuses', statusesKey);
  if (dateRange.from) params.set('from', dateRange.from);
  if (dateRange.to) params.set('to', dateRange.to);
  if (query.q) params.set('q', query.q);
  if (query.sort !== DEFAULT_HISTORY_SORT) params.set('sort', query.sort);
  const history = useCustomerServiceHistory<RequestRow>({
    resource: 'solar',
    endpoint: '/api/solar/requests',
    profileEndpoint: '/api/profiles',
    query: params.toString(),
    itemsKey: 'requests',
    identify: identifyHistoryRow,
  });
  const { items: rows, nextBefore, loadMore, loading } = history;
  const error = !!history.error;

  const identity = (row: RequestRow) => (
    <div className="min-w-0 space-y-1">
      <Link
        to="/solar/requests/$requestId"
        params={{ requestId: row.id }}
        className="touch-action font-semibold text-primary hover:underline underline-offset-4"
      >
        {copy(row.building_type === 'non_household' ? 'nonHousehold' : 'building')}
      </Link>
      <p className="text-sm font-normal text-muted-foreground">
        {copy(row.grid_type === 'off_grid' ? 'offGrid' : 'onGrid')}
      </p>
      <p className="text-xs font-normal text-muted-foreground">
        <bdi className="wrap-anywhere">{row.id}</bdi>
      </p>
    </div>
  );
  const status = (row: RequestRow) => (
    <StatusBadge label={copy(`status_${row.status}`)} tone={statusFilterTone(row.status)} />
  );
  const submitted = (row: RequestRow) => (
    <time dateTime={row.submitted_at}>
      {time.format(row.submitted_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}
    </time>
  );
  const nextStep = (row: RequestRow) => {
    const action = solarNextAction(row, locale);
    const href = action.href?.startsWith('#')
      ? `/solar/requests/${encodeURIComponent(row.id)}${action.href}`
      : action.href;
    return (
      <div className="min-w-32 space-y-1 text-start">
        {href ? (
          <a
            href={href}
            className="touch-action font-medium text-primary hover:underline underline-offset-4"
          >
            {action.text}
          </a>
        ) : (
          <span className="text-muted-foreground">{action.text}</span>
        )}
        {action.owner !== 'none' && (
          <p className="text-xs text-muted-foreground">
            {t('workflow.owner', locale)}: {t(`workflow.owner.${action.owner}`, locale)}
          </p>
        )}
      </div>
    );
  };
  const columns: (HistoryColumn<RequestRow> & { label: string })[] = [
    { id: 'reference', label: t('historyView.type', locale), render: identity },
    { id: 'status', label: copy('status'), render: status },
    { id: 'submitted', label: t('historyView.submitted', locale), render: submitted },
    { id: 'action', actions: true, label: t('workflow.nextAction', locale), render: nextStep },
  ];
  return (
    <div
      className="mx-auto w-full max-w-5xl min-w-0 space-y-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <PageHeader
        title={copy('myRequests')}
        actions={
          <Link to="/solar/requests/new" className={buttonVariants()}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {copy('submit')}
          </Link>
        }
      />
      {time.notice}
      <ListPage>
        <ListPage.Toolbar
          className="rounded-xl border bg-card p-3"
          filters={
            <HistoryFilterPanel
              query={query}
              statuses={statuses}
              dateRange={dateRange}
              onClear={onClearFilters}
              onOpen={filterDraft.begin}
              onApply={onApplyFilters ? filterDraft.apply : undefined}
              onRemoveFilter={onRemoveFilter}
              statusOptions={statusOptions}
              formatDate={(value) =>
                time.format(value, { dateStyle: 'medium', timeStyle: 'short' })
              }
            >
              {onDraftQueryChange && (
                <HistoryListControls
                  value={filterQuery}
                  onChange={onDraftQueryChange}
                  locale={locale}
                  domain="solar"
                />
              )}
              {onDraftDateRangeChange && (
                <HistoryDateFilter
                  value={filterDateRange}
                  onChange={onDraftDateRangeChange}
                  locale={locale}
                  time={time}
                />
              )}
              {onDraftStatusesChange && (
                <StatusFilter
                  label={copy('filterStatus')}
                  clearLabel={copy('clearFilters')}
                  countLabel={numbers.number(filterStatuses.length)}
                  value={filterStatuses}
                  onChange={onDraftStatusesChange}
                  options={statusOptions}
                />
              )}
            </HistoryFilterPanel>
          }
          actions={
            <ListViewToggle
              value={view}
              onChange={setView}
              labels={{
                group: t('historyView.group', locale),
                table: t('historyView.table', locale),
                card: t('historyView.card', locale),
              }}
            />
          }
        />
        <ListPage.Content
          loading={loading}
          error={error}
          empty={rows.length === 0}
          retainContent={rows.length > 0}
          loadingView={
            rows.length ? (
              <p role="status" className="sr-only">
                {copy('loading')}
              </p>
            ) : (
              <RecordListSkeleton
                label={copy('loading')}
                view={view}
                headings={columns.map((column) => column.label)}
              />
            )
          }
          errorView={
            <div className="space-y-2">
              <p role="alert">
                {history.error === 'denied'
                  ? t('historyPagination.accessDenied', locale)
                  : copy('requestsLoadError')}
              </p>
              <Button variant="outline" onClick={history.retry}>
                {copy('retry')}
              </Button>
            </div>
          }
          emptyView={
            <p>
              {dateRange.from || dateRange.to || query.q
                ? t('historyDates.empty', locale)
                : copy(statuses.length ? 'filteredEmpty' : 'none')}
            </p>
          }
        >
          {view === 'table' && rows.length ? (
            <HistoryTable
              caption={copy('myRequests')}
              items={rows}
              columns={columns}
              rowKey={(row) => row.id}
            />
          ) : (
            <ul className="grid gap-3">
              {rows.map((row) => (
                <li key={row.id} className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
                  {identity(row)}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    {status(row)}
                    <span>
                      {t('historyView.submitted', locale)} {submitted(row)}
                    </span>
                  </div>
                  <div className="border-t pt-3 text-sm">{nextStep(row)}</div>
                </li>
              ))}
            </ul>
          )}
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          hasMore={!!nextBefore && !error}
          loading={loading}
          onNext={loadMore}
          label={t('historyPagination.label', locale)}
          nextLabel={copy('moreRequests')}
        />
      </ListPage>
    </div>
  );
}

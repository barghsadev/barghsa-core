import {
  Ban as TableBanIcon,
  CheckCircle as TableCheckCircleIcon,
  MapPin as TableMapPinIcon,
  Pencil as TablePencilIcon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  LoadingStatus,
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  ListPage,
  ListRefreshButton,
  ListSearchInput,
  NativeSelect,
} from '@barghsa/ui';
import { geographyText, type GeographyTextKey } from '@barghsa/i18n/geography';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { listProvinces } from '../lib/geography-api.js';
import { GeographyRecordTable } from '../components/GeographyRecordTable.js';
import { CitiesPanel } from './AdminCitiesPanel.js';
import { GeographyDialog, type GeographyModal } from './AdminGeographyDialog.js';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { geographyBasis, useGeographyList } from '../hooks/useGeographyList.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
export default function AdminGeographyPage({
  query,
  routeSearch,
}: {
  query?: ListQueryBinding;
  routeSearch?: Record<string, unknown>;
} = {}) {
  const locale = useLocale();
  const t = (key: GeographyTextKey) => geographyText(key, locale);
  const { number } = useNumberFormatting(locale);
  const [localExpanded, setLocalExpanded] = useState<string | null>(null);
  const [localPage, setLocalPage] = useState(1);
  const [localSearch, setLocalSearch] = useState('');
  const [localSearchInput, setLocalSearchInput] = useState('');
  const [localStatus, setLocalStatus] = useState('');
  const queryRef = useRef(query);
  queryRef.current = query;
  const expanded = localExpanded;
  const page = query?.query.page ?? localPage;
  const search = query?.query.search ?? localSearch;
  const searchInput = query?.searchInput ?? localSearchInput;
  const status = query?.query.filters.status ?? localStatus;
  const setPage = useCallback((next: number | ((value: number) => number), replace = false) => {
    if (queryRef.current) {
      const value = typeof next === 'function' ? next(queryRef.current.query.page) : next;
      queryRef.current.setQuery({ page: value }, replace);
    } else setLocalPage(next);
  }, []);
  const repairPage = useCallback((value: number) => setPage(value, true), [setPage]);
  const [modal, setModal] = useState<GeographyModal | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const savedTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (query) return;
    if (searchInput === search) return;
    const timer = setTimeout(() => {
      setLocalSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, search, query, setPage]);
  const clearPrivate = useCallback(() => {
    savedTrigger.current = null;
    setLocalExpanded(null);
    setModal(null);
    setLocalSearchInput('');
    setLocalSearch('');
    setLocalStatus('');
    setLocalPage(1);
    queryRef.current?.clear();
  }, []);
  const scope = useCatalogueScope(clearPrivate);
  const load = useCallback(
    async (requestedPage: number, signal: AbortSignal) => {
      const result = await listProvinces({ search, status, page: requestedPage }, signal);
      return { rows: result.provinces, total: result.total };
    },
    [search, status]
  );
  const criteria = JSON.stringify([search, status]);
  const list = useGeographyList(scope, criteria, page, load, repairPage);
  const provinces = list.data?.rows ?? [],
    total = list.data?.total ?? 0,
    loading = list.loading,
    error = list.error;
  const ready = !scope.denied && !!list.data && !loading && !error;
  const modalPage = useRef(1),
    acceptedCriteria = useRef(criteria);
  useEffect(() => {
    if (acceptedCriteria.current === criteria) return;
    savedTrigger.current = null;
    acceptedCriteria.current = criteria;
    setLocalExpanded(null);
    setModal(null);
  }, [criteria]);
  useEffect(() => {
    if (!list.data || loading || error) return;
    if (expanded && !list.data.rows.some((row) => row.id === expanded)) setLocalExpanded(null);
    if (modal?.province && list.acceptedPage === modalPage.current) {
      const next = list.data.rows.find((row) => row.id === modal.province?.id);
      if (!next || geographyBasis(next) !== geographyBasis(modal.province)) setModal(null);
    }
  }, [list.data, list.acceptedPage, loading, error, expanded, modal]);
  useEffect(() => {
    if (!ready || modal || !savedTrigger.current) return;
    const target = savedTrigger.current;
    const frame = requestAnimationFrame(() => {
      if (savedTrigger.current !== target) return;
      savedTrigger.current = null;
      if (target.isConnected) target.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, modal]);
  function openModal(value: GeographyModal) {
    if (!ready) return;
    savedTrigger.current = null;
    modalPage.current = list.acceptedPage;
    setModal(value);
  }
  function refresh() {
    if (scope.denied) scope.recover();
    else list.retry();
  }
  const recovery = (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={loading} onClick={refresh}>
        {t('provinceRetry')}
      </Button>
      {error && <p role="alert">{t('requestFailed')}</p>}
    </div>
  );
  const expandedProvince = provinces.find((province) => province.id === expanded);
  const totalPages = Math.max(1, Math.ceil(total / 20));
  return (
    <section
      className="flex flex-col gap-4 text-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      aria-labelledby="province-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 ref={heading} tabIndex={-1} id="province-heading" className="text-2xl font-bold">
          {t('title')}
        </h1>
        <div className="flex flex-wrap gap-2">
          {routeSearch && ready ? (
            <Link
              className={buttonVariants({ className: 'min-h-11' })}
              to="/admin/geography/provinces/$provinceId/{-$action}"
              params={{ provinceId: 'new' }}
              search={routeSearch}
            >
              {t('add')}
            </Link>
          ) : (
            <Button
              disabled={!ready}
              onClick={(event) =>
                openModal({ kind: 'add', province: null, trigger: event.currentTarget })
              }
            >
              {t('add')}
            </Button>
          )}
        </div>
      </header>
      <ListPage>
        <ListPage.Toolbar
          search={
            <ListSearchInput
              label={t('search')}
              value={searchInput}
              onChange={(event) =>
                query
                  ? query.setSearchInput(event.target.value)
                  : setLocalSearchInput(event.target.value)
              }
            />
          }
          sort={
            <NativeSelect
              aria-label={t('filterStatus')}
              value={status}
              onChange={(event) => {
                if (query) query.setQuery({ filters: { status: event.target.value } });
                else {
                  setLocalStatus(event.target.value);
                  setPage(1);
                }
              }}
            >
              <option value="">{t('all')}</option>
              <option value="active">{t('active')}</option>
              <option value="inactive">{t('inactive')}</option>
            </NativeSelect>
          }
          refresh={
            <ListRefreshButton label={t('refresh')} refreshing={loading} onClick={refresh} />
          }
        />
        {scope.denied && <p role="alert">{t('denied')}</p>}
        <ListPage.Content
          loading={loading}
          error={error}
          empty={false}
          emptyView={null}
          retainContent={list.data !== null}
          loadingView={<LoadingStatus>{t('loading')}</LoadingStatus>}
          errorView={
            <Alert role="alert" variant="destructive">
              <AlertDescription>
                {t('requestFailed')}
                <Button variant="outline" onClick={list.retry}>
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          }
        >
          {!scope.denied && list.data !== null && (
            <>
              <GeographyRecordTable
                rows={provinces}
                caption={t('title')}
                emptyMessage={t('empty')}
                tableClassName="min-w-[42rem]"
                loading={loading}
                error={error}
                {...(routeSearch && ready
                  ? {
                      renderName: (province, name) => (
                        <Link
                          to="/admin/geography/provinces/$provinceId/{-$action}"
                          params={{ provinceId: province.id }}
                          search={routeSearch}
                          className="font-semibold text-primary underline-offset-4 hover:underline"
                        >
                          {name}
                        </Link>
                      ),
                    }
                  : {})}
                renderActions={(province) => (
                  <div className="flex flex-wrap gap-2">
                    {routeSearch ? (
                      <>
                        {ready && (
                          <>
                            <Link
                              className={buttonVariants({
                                variant: 'outline',
                                className: 'min-h-11',
                              })}
                              to="/admin/geography/provinces/$provinceId/{-$action}"
                              params={{ provinceId: province.id }}
                              search={routeSearch}
                              data-table-action-tooltip={t('cities')}
                            >
                              <TableActionIcon icon={TableMapPinIcon}>
                                {t('cities')}
                              </TableActionIcon>
                            </Link>
                            <Link
                              className={buttonVariants({
                                variant: 'outline',
                                className: 'min-h-11',
                              })}
                              to="/admin/geography/provinces/$provinceId/{-$action}"
                              params={{ provinceId: province.id, action: 'edit' }}
                              search={routeSearch}
                              data-table-action-tooltip={t('edit')}
                            >
                              <TableActionIcon icon={TablePencilIcon}>{t('edit')}</TableActionIcon>
                            </Link>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          data-city-disclosure={province.id}
                          aria-expanded={expanded === province.id}
                          aria-controls={
                            expanded === province.id ? `cities-${province.id}` : undefined
                          }
                          onClick={() =>
                            setLocalExpanded(expanded === province.id ? null : province.id)
                          }
                          data-table-action-tooltip={t('cities')}
                        >
                          <TableActionIcon icon={TableMapPinIcon}>{t('cities')}</TableActionIcon>
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!ready}
                          onClick={(event) =>
                            openModal({ kind: 'edit', province, trigger: event.currentTarget })
                          }
                          data-table-action-tooltip={t('edit')}
                        >
                          <TableActionIcon icon={TablePencilIcon}>{t('edit')}</TableActionIcon>
                        </Button>
                      </>
                    )}
                    {(!routeSearch || province.status === 'active') && (
                      <Button
                        variant="outline"
                        disabled={!ready}
                        onClick={(event) =>
                          openModal({
                            kind: province.status === 'active' ? 'deactivate' : 'edit',
                            province,
                            trigger: event.currentTarget,
                          })
                        }
                        data-table-action-tooltip={t(
                          province.status === 'active' ? 'deactivate' : 'activate'
                        )}
                      >
                        <TableActionIcon
                          icon={province.status === 'active' ? TableBanIcon : TableCheckCircleIcon}
                        >
                          {t(province.status === 'active' ? 'deactivate' : 'activate')}
                        </TableActionIcon>
                      </Button>
                    )}
                  </div>
                )}
              />
              {expandedProvince && (
                <div className="rounded-lg border bg-card p-4">
                  <CitiesPanel
                    key={expandedProvince.id}
                    province={expandedProvince}
                    scope={scope}
                    parentReady={ready}
                    parentRecovery={recovery}
                    onClose={() => {
                      setLocalExpanded(null);
                      const trigger = Array.from(
                        document.querySelectorAll<HTMLButtonElement>('button[data-city-disclosure]')
                      ).find(
                        (button) =>
                          button.dataset.cityDisclosure === expandedProvince.id &&
                          button.getClientRects().length > 0
                      );
                      trigger?.focus();
                    }}
                  />
                </div>
              )}
            </>
          )}
        </ListPage.Content>
        {totalPages > 1 && (
          <nav
            aria-label={t('title')}
            className="flex flex-wrap items-center justify-between gap-4"
          >
            <p>
              {t('range')
                .replace('{from}', number((list.acceptedPage - 1) * 20 + 1))
                .replace('{to}', number(Math.min(list.acceptedPage * 20, total)))
                .replace('{total}', number(total))}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={loading || page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                {t('previous')}
              </Button>
              <Button
                variant="outline"
                disabled={loading || page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                {t('next')}
              </Button>
            </div>
          </nav>
        )}
      </ListPage>
      {modal && (
        <GeographyDialog
          key={`${modal.kind}:${modal.province?.id ?? 'new'}`}
          modal={modal}
          readReady={ready}
          recovery={recovery}
          onDenied={scope.deny}
          onClose={() => setModal(null)}
          onSaved={() => {
            savedTrigger.current = modal.trigger;
            setModal(null);
            list.retry();
          }}
        />
      )}
    </section>
  );
}

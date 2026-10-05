import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, Button, Input, ListPage, ScrollArea } from '@barghsa/ui';
import { geographyText, type GeographyTextKey } from '@barghsa/i18n/geography';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { listProvinces } from '../lib/geography-api.js';
import { CitiesPanel } from './AdminCitiesPanel.js';
import { GeographyDialog, type GeographyModal } from './AdminGeographyDialog.js';
const selectClass =
  'h-10 rounded-md border border-input bg-background px-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { geographyBasis, useGeographyList } from '../hooks/useGeographyList.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
export interface GeographyQueryBinding {
  provinces: ListQueryBinding;
  cities: ListQueryBinding;
  expanded: string | null;
  setExpanded: (id: string | null, replace?: boolean) => void;
  clear: () => void;
}
export default function AdminGeographyPage({ query }: { query?: GeographyQueryBinding } = {}) {
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
  const expanded = query ? query.expanded : localExpanded;
  const page = query?.provinces.query.page ?? localPage;
  const search = query?.provinces.query.search ?? localSearch;
  const searchInput = query?.provinces.searchInput ?? localSearchInput;
  const status = query?.provinces.query.filters.status ?? localStatus;
  const setExpanded = useCallback((id: string | null, replace = false) => {
    if (queryRef.current) {
      if (queryRef.current.expanded !== id) queryRef.current.setExpanded(id, replace);
    } else setLocalExpanded(id);
  }, []);
  const setPage = useCallback((next: number | ((value: number) => number), replace = false) => {
    if (queryRef.current) {
      const value = typeof next === 'function' ? next(queryRef.current.provinces.query.page) : next;
      queryRef.current.provinces.setQuery({ page: value }, replace);
    } else setLocalPage(next);
  }, []);
  const repairPage = useCallback((value: number) => setPage(value, true), [setPage]);
  const [modal, setModal] = useState<GeographyModal | null>(null);
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
    if (!queryRef.current) setExpanded(null, true);
    setModal(null);
  }, [criteria]);
  useEffect(() => {
    if (!list.data || loading || error) return;
    if (expanded && !list.data.rows.some((row) => row.id === expanded)) setExpanded(null, true);
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
  const totalPages = Math.max(1, Math.ceil(total / 20));
  return (
    <section
      className="flex flex-col gap-4 text-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      aria-labelledby="province-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="province-heading" className="text-2xl font-bold">
          {t('title')}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={loading} onClick={refresh}>
            {t('refresh')}
          </Button>
          <Button
            disabled={!ready}
            onClick={(event) =>
              openModal({ kind: 'add', province: null, trigger: event.currentTarget })
            }
          >
            {t('add')}
          </Button>
        </div>
      </header>
      <ListPage>
        <ListPage.Toolbar className="flex flex-wrap gap-4">
          <Input
            className="max-w-sm"
            aria-label={t('search')}
            placeholder={t('search')}
            value={searchInput}
            onChange={(event) =>
              query
                ? query.provinces.setSearchInput(event.target.value)
                : setLocalSearchInput(event.target.value)
            }
          />
          <select
            className={selectClass}
            aria-label={t('filterStatus')}
            value={status}
            onChange={(event) => {
              if (query) query.provinces.setQuery({ filters: { status: event.target.value } });
              else {
                setLocalStatus(event.target.value);
                setPage(1);
              }
            }}
          >
            <option value="">{t('all')}</option>
            <option value="active">{t('active')}</option>
            <option value="inactive">{t('inactive')}</option>
          </select>
        </ListPage.Toolbar>
        {scope.denied && <p role="alert">{t('denied')}</p>}
        <ListPage.Content
          loading={loading}
          error={error}
          empty={false}
          emptyView={null}
          retainContent={list.data !== null}
          loadingView={<p role="status">{t('loading')}</p>}
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
            <ScrollArea
              scrollbarOrientation="horizontal"
              className="min-w-0 rounded-md border bg-card text-card-foreground"
            >
              <table className="w-full min-w-[42rem] text-sm">
                <caption className="sr-only">{t('title')}</caption>
                <thead>
                  <tr>
                    {(['nameFa', 'nameEn', 'status', 'actions'] as const).map((key) => (
                      <th key={key} scope="col" className="p-3 text-start">
                        {t(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!loading && !error && provinces.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-4 text-center">
                        {t('empty')}
                      </td>
                    </tr>
                  )}
                  {provinces.map((province) => (
                    <Fragment key={province.id}>
                      <tr className="border-t">
                        <td className="p-3" dir="rtl" lang="fa">
                          {province.nameFa}
                        </td>
                        <td className="p-3" dir="ltr" lang="en">
                          {province.nameEn}
                        </td>
                        <td className="p-3">{t(province.status)}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              aria-expanded={expanded === province.id}
                              aria-controls={`cities-${province.id}`}
                              onClick={() =>
                                setExpanded(expanded === province.id ? null : province.id)
                              }
                            >
                              {t('cities')}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={!ready}
                              onClick={(event) =>
                                openModal({ kind: 'edit', province, trigger: event.currentTarget })
                              }
                            >
                              {t('edit')}
                            </Button>
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
                            >
                              {t(province.status === 'active' ? 'deactivate' : 'activate')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expanded === province.id && (
                        <tr>
                          <td colSpan={4} className="border-t p-4">
                            <CitiesPanel
                              key={province.id}
                              province={province}
                              scope={scope}
                              parentReady={ready}
                              parentRecovery={recovery}
                              {...(query ? { query: query.cities } : {})}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
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

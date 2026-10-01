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
export default function AdminGeographyPage() {
  const locale = useLocale();
  const t = (key: GeographyTextKey) => geographyText(key, locale);
  const { number } = useNumberFormatting(locale);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState<GeographyModal | null>(null);
  const savedTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, search]);
  const clearPrivate = useCallback(() => {
    savedTrigger.current = null;
    setExpanded(null);
    setModal(null);
    setSearchInput('');
    setSearch('');
    setStatus('');
    setPage(1);
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
  const list = useGeographyList(scope, criteria, page, load, setPage);
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
    setExpanded(null);
    setModal(null);
  }, [criteria]);
  useEffect(() => {
    if (!list.data || loading || error) return;
    if (expanded && !list.data.rows.some((row) => row.id === expanded)) setExpanded(null);
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
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <select
            className={selectClass}
            aria-label={t('filterStatus')}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
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

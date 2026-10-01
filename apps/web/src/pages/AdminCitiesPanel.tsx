import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  ListPage,
  ScrollArea,
  Textarea,
} from '@barghsa/ui';
import { geographyText, type GeographyTextKey } from '@barghsa/i18n/geography';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  GeographyRequestError,
  importCities,
  listCities,
  type Province,
} from '../lib/geography-api.js';
import { GeographyDialog, type GeographyModal } from './AdminGeographyDialog.js';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import {
  geographyBasis,
  useGeographyList,
  type GeographyScope,
} from '../hooks/useGeographyList.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';

function ImportCitiesDialog({
  province,
  trigger,
  onClose,
  onSaved,
  readReady,
  recovery,
  onDenied,
}: {
  readReady: boolean;
  recovery: ReactNode;
  onDenied: () => void;
  province: Province;
  trigger: HTMLElement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const locale = useLocale();
  const { number } = useNumberFormatting(locale);
  const t = (key: GeographyTextKey) => geographyText(key, locale);
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GeographyTextKey | null>(null);
  const mounted = useRef(false),
    inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split('\t').map((cell) => cell.trim()));
  const valid =
    rows.length > 0 &&
    rows.length <= 200 &&
    rows.every(
      (row) =>
        row.length === 2 &&
        !!row[0] &&
        row[0].length <= 100 &&
        /^[\u0600-\u06FF\u200C\s]+$/.test(row[0]) &&
        !!row[1] &&
        row[1].length <= 100 &&
        /^[a-zA-Z\s]+$/.test(row[1])
    );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || inFlight.current || !readReady) return;
    if (!valid) {
      setError('importInvalid');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await importCities(
        province.id,
        rows.map((row) => ({ nameFa: row[0]!, nameEn: row[1]! }))
      );
      if (mounted.current) onSaved();
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof GeographyRequestError && cause.code === 'denied') {
        onDenied();
        return;
      }
      setError(
        cause instanceof GeographyRequestError && cause.code === 'conflict'
          ? 'cityConflict'
          : 'requestFailed'
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={field}
        finalFocus={() => trigger}
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle>{t('importCities')}</DialogTitle>
          <DialogDescription>{t('importDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={busy}>
          <Field>
            <FieldLabel htmlFor="city-import-rows">{t('importRows')}</FieldLabel>
            <Textarea
              id="city-import-rows"
              ref={field}
              rows={8}
              maxLength={41000}
              disabled={busy}
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-invalid={error === 'importInvalid'}
              aria-describedby={error ? 'city-import-error' : undefined}
            />
          </Field>
          {valid && <p role="status">{t('importCount').replace('{count}', number(rows.length))}</p>}
          {error && (
            <Alert variant="destructive" role="alert" id="city-import-error">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          )}
          {recovery}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={busy || !readReady}>
              {t(busy ? 'saving' : 'importCities')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CitiesPanel({
  province,
  scope: outerScope,
  parentReady = true,
  parentRecovery,
  query,
}: {
  province: Province;
  scope?: GeographyScope;
  parentReady?: boolean;
  parentRecovery?: ReactNode;
  query?: ListQueryBinding;
}) {
  const locale = useLocale();
  const { number } = useNumberFormatting(locale);
  const t = (key: GeographyTextKey) => geographyText(key, locale);
  const [localPage, setLocalPage] = useState(1);
  const [localSearchInput, setLocalSearchInput] = useState('');
  const [localSearch, setLocalSearch] = useState('');
  const [localStatus, setLocalStatus] = useState('');
  const queryRef = useRef(query);
  queryRef.current = query;
  const page = query?.query.page ?? localPage;
  const searchInput = query?.searchInput ?? localSearchInput;
  const search = query?.query.search ?? localSearch;
  const status = query?.query.filters.status ?? localStatus;
  const setPage = useCallback((next: number | ((value: number) => number), replace = false) => {
    if (queryRef.current) {
      const value = typeof next === 'function' ? next(queryRef.current.query.page) : next;
      queryRef.current.setQuery({ page: value }, replace);
    } else setLocalPage(next);
  }, []);
  const repairPage = useCallback((value: number) => setPage(value, true), [setPage]);
  const [modal, setModal] = useState<GeographyModal | null>(null);
  const [importTrigger, setImportTrigger] = useState<HTMLElement | null>(null);
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
    setModal(null);
    setImportTrigger(null);
    setLocalSearchInput('');
    setLocalSearch('');
    setLocalStatus('');
    setLocalPage(1);
    queryRef.current?.clear();
  }, []);
  const localScope = useCatalogueScope(clearPrivate),
    scope = outerScope ?? localScope;
  const load = useCallback(
    async (requestedPage: number, signal: AbortSignal) => {
      const result = await listCities(province.id, { search, status, page: requestedPage }, signal);
      return { rows: result.cities, total: result.total };
    },
    [province.id, search, status]
  );
  const criteria = JSON.stringify([province.id, search, status]);
  const list = useGeographyList(scope, criteria, page, load, repairPage);
  const cities = list.data?.rows ?? [],
    total = list.data?.total ?? 0,
    loading = list.loading,
    error = list.error;
  const ready = parentReady && !scope.denied && !!list.data && !loading && !error;
  const modalPage = useRef(1),
    acceptedCriteria = useRef(criteria),
    previousProvince = useRef(geographyBasis(province));
  useEffect(() => {
    if (
      acceptedCriteria.current === criteria &&
      previousProvince.current === geographyBasis(province)
    )
      return;
    savedTrigger.current = null;
    acceptedCriteria.current = criteria;
    previousProvince.current = geographyBasis(province);
    setModal(null);
    setImportTrigger(null);
  }, [criteria, province]);
  useEffect(() => {
    if (
      !list.data ||
      loading ||
      error ||
      !modal?.province ||
      list.acceptedPage !== modalPage.current
    )
      return;
    const next = list.data.rows.find((row) => row.id === modal.province?.id);
    if (!next || geographyBasis(next) !== geographyBasis(modal.province)) setModal(null);
  }, [list.data, list.acceptedPage, loading, error, modal]);
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
      {parentRecovery}
      <Button type="button" variant="outline" disabled={loading} onClick={refresh}>
        {t('cityRetry')}
      </Button>
      {error && <p role="alert">{t('requestFailed')}</p>}
    </div>
  );
  useEffect(() => {
    if (!ready || modal || importTrigger || !savedTrigger.current) return;
    const target = savedTrigger.current;
    const frame = requestAnimationFrame(() => {
      if (savedTrigger.current !== target) return;
      savedTrigger.current = null;
      if (target.isConnected) target.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, modal, importTrigger]);
  function saved() {
    savedTrigger.current = modal?.trigger ?? importTrigger;
    setModal(null);
    setImportTrigger(null);
    list.retry();
  }
  return (
    <section
      id={`cities-${province.id}`}
      aria-label={`${t('cities')} — ${locale === 'fa' ? province.nameFa : province.nameEn}`}
      className="flex min-w-0 flex-col gap-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">
          {t('cities')} — {locale === 'fa' ? province.nameFa : province.nameEn}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!ready}
            onClick={(event) =>
              openModal({ kind: 'add', province: null, trigger: event.currentTarget })
            }
          >
            {t('addCity')}
          </Button>
          <Button variant="outline" disabled={loading} onClick={refresh}>
            {t('refresh')}
          </Button>
          <Button
            variant="outline"
            disabled={!ready}
            onClick={(event) => {
              savedTrigger.current = null;
              setImportTrigger(event.currentTarget);
            }}
          >
            {t('importCities')}
          </Button>
        </div>
      </header>
      <ListPage>
        <ListPage.Toolbar className="flex flex-wrap gap-4">
          <Input
            aria-label={t('citySearch')}
            placeholder={t('citySearch')}
            value={searchInput}
            onChange={(event) =>
              query
                ? query.setSearchInput(event.target.value)
                : setLocalSearchInput(event.target.value)
            }
            className="max-w-sm"
          />
          <select
            aria-label={t('filterStatus')}
            className="h-10 rounded-md border border-input bg-background px-3"
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
          </select>
        </ListPage.Toolbar>
        {scope.denied && <p role="alert">{t('denied')}</p>}
        <ListPage.Content
          loading={loading}
          error={error}
          empty={false}
          emptyView={null}
          retainContent={list.data !== null}
          loadingView={<p role="status">{t('cityLoading')}</p>}
          errorView={
            <Alert role="alert" variant="destructive">
              <AlertDescription>
                {t('requestFailed')}{' '}
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
              <table className="w-full min-w-[34rem] text-sm" aria-busy={loading}>
                <caption className="sr-only">{t('cities')}</caption>
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
                  {!loading && !error && cities.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-4 text-center">
                        {t('cityEmpty')}
                      </td>
                    </tr>
                  )}
                  {cities.map((city) => (
                    <tr key={city.id} className="border-t">
                      <td className="p-3" lang="fa" dir="rtl">
                        {city.nameFa}
                      </td>
                      <td className="p-3" lang="en" dir="ltr">
                        {city.nameEn}
                      </td>
                      <td className="p-3">{t(city.status)}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            disabled={!ready}
                            onClick={(event) =>
                              openModal({
                                kind: 'edit',
                                province: city,
                                trigger: event.currentTarget,
                              })
                            }
                          >
                            {t('edit')}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={!ready}
                            onClick={(event) =>
                              openModal({
                                kind: city.status === 'active' ? 'deactivate' : 'edit',
                                province: city,
                                trigger: event.currentTarget,
                              })
                            }
                          >
                            {t(city.status === 'active' ? 'deactivate' : 'activate')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </ListPage.Content>
        {total > 20 && (
          <nav
            aria-label={t('cities')}
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
                onClick={() => setPage((p) => p - 1)}
              >
                {t('previous')}
              </Button>
              <Button
                variant="outline"
                disabled={loading || page * 20 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('next')}
              </Button>
            </div>
          </nav>
        )}
      </ListPage>
      {modal && (
        <GeographyDialog
          provinceId={province.id}
          modal={modal}
          readReady={ready}
          recovery={recovery}
          onDenied={scope.deny}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
      {importTrigger && (
        <ImportCitiesDialog
          province={province}
          trigger={importTrigger}
          readReady={ready}
          recovery={recovery}
          onDenied={scope.deny}
          onClose={() => setImportTrigger(null)}
          onSaved={saved}
        />
      )}
    </section>
  );
}

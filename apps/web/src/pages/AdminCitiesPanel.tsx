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
import { GeographyRecordTable } from '../components/GeographyRecordTable.js';
import { GeographyDialog, type GeographyModal } from './AdminGeographyDialog.js';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import {
  geographyBasis,
  useGeographyList,
  type GeographyScope,
} from '../hooks/useGeographyList.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { parseCityRows } from '../lib/geography-form-values.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';

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
  const native = useWizardForm<{ rows: string }>(
    async () =>
      (await import('../lib/geography-form-schemas.js')).cityImportSchema(t('importInvalid')),
    () => ({ rows: '' }),
    t('validationUnavailable')
  );
  const [text, setText] = native.field('rows');
  const [rejectedRows, setRejectedRows] = useState(false);
  const rowsError = rejectedRows
    ? { type: 'server', message: t('importInvalid') }
    : native.errors.rows;
  const busy = native.pending;
  const fieldErrors = useActionFieldErrors(
    native.form,
    { rows: t('importInvalid') },
    t('requestFailed')
  );
  const invalidFocus = useRef(false);
  const [error, setError] = useState<GeographyTextKey | null>(null);
  const mounted = useRef(false),
    inFlight = useRef(false);
  const latest = useRef({ readReady, provinceId: province.id, locale, generation: 0 });
  if (
    latest.current.readReady !== readReady ||
    latest.current.provinceId !== province.id ||
    latest.current.locale !== locale
  )
    latest.current = {
      readReady,
      provinceId: province.id,
      locale,
      generation: latest.current.generation + 1,
    };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      latest.current.generation += 1;
    };
  }, []);
  useEffect(() => {
    if (!busy && invalidFocus.current && mounted.current) {
      invalidFocus.current = false;
      native.form.setFocus('rows');
    }
  }, [busy, native.errors, native.form]);
  const rows = parseCityRows(text);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || inFlight.current || !readReady) return;
    inFlight.current = true;
    const generation = latest.current.generation;
    native.setValidationPending(true);
    native.form.clearErrors();
    setRejectedRows(false);
    setError(null);
    try {
      const valid = await native.form.trigger();
      if (!mounted.current || latest.current.generation !== generation || !latest.current.readReady)
        return;
      if (!valid) {
        invalidFocus.current = native.form.getFieldState('rows').invalid;
        return;
      }
      const cities = parseCityRows(native.form.getValues('rows'));
      if (!cities) return;
      await importCities(province.id, cities);
      if (mounted.current && latest.current.provinceId === province.id) onSaved();
    } catch (cause) {
      if (!mounted.current || latest.current.provinceId !== province.id) return;
      if (cause instanceof GeographyRequestError && cause.code === 'denied') {
        onDenied();
        return;
      }
      if (
        cause instanceof GeographyRequestError &&
        cause.fields.length > 0 &&
        cause.fields.every((name) => name === 'cities') &&
        fieldErrors(['rows'])
      ) {
        // A late local validation cannot retire feedback for an unchanged rejected proposal.
        setRejectedRows(true);
        invalidFocus.current = true;
        return;
      }
      setError(
        cause instanceof GeographyRequestError && cause.code === 'conflict'
          ? 'cityConflict'
          : 'requestFailed'
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) native.setValidationPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
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
        <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
          {error && (
            <Alert variant="destructive" role="alert" id="city-import-error">
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          )}
          {catalogueRootMessage(native.errors) && (
            <Alert variant="destructive">{catalogueRootMessage(native.errors)}</Alert>
          )}
          <Field>
            <FieldLabel htmlFor="city-import-rows">{t('importRows')}</FieldLabel>
            <Textarea
              {...native.bind('rows')}
              id="city-import-rows"
              ref={(node) => {
                field.current = node;
                native.bind('rows').ref(node);
              }}
              rows={8}
              maxLength={41000}
              disabled={busy}
              onBlur={() => {
                if (!native.isPending()) native.bind('rows').onBlur();
              }}
              aria-invalid={!!rowsError || undefined}
              aria-describedby={rowsError ? native.errorId('rows') : undefined}
              value={text}
              onChange={(event) => {
                if (!inFlight.current && event.target.value !== text) {
                  setRejectedRows(false);
                  setText(event.target.value);
                }
              }}
            />
            <CatalogueFieldFeedback
              id={native.errorId('rows')}
              error={rowsError}
              message={t('importInvalid')}
            />
          </Field>
          {rows && <p role="status">{t('importCount').replace('{count}', number(rows.length))}</p>}
          {recovery}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (!inFlight.current) onClose();
              }}
            >
              {t('cancel')}
            </Button>
            <CatalogueSaveButton
              label={t(busy ? 'saving' : 'importCities')}
              pending={busy}
              disabled={busy || !readReady}
            />
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
  onClose,
  query,
}: {
  province: Province;
  scope?: GeographyScope;
  parentReady?: boolean;
  parentRecovery?: ReactNode;
  onClose?: () => void;
  query?: ListQueryBinding;
}) {
  const locale = useLocale();
  const { number } = useNumberFormatting(locale);
  const t = (key: GeographyTextKey) => geographyText(key, locale);
  const heading = useRef<HTMLHeadingElement>(null);
  const isWorkspace = !!onClose;
  useEffect(() => {
    // The selected workspace follows the full province list, so bring it into view on open.
    if (isWorkspace) heading.current?.focus();
  }, [isWorkspace]);
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
        <h2 ref={heading} tabIndex={isWorkspace ? -1 : undefined} className="text-lg font-semibold">
          {t('cities')} — {locale === 'fa' ? province.nameFa : province.nameEn}
        </h2>
        <div className="flex flex-wrap gap-2">
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              {t('closeCities')}
            </Button>
          )}
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
            <GeographyRecordTable
              rows={cities}
              headingLevel={3}
              caption={t('cities')}
              emptyMessage={t('cityEmpty')}
              tableClassName="min-w-[34rem]"
              loading={loading}
              error={error}
              renderActions={(city) => (
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
              )}
            />
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
          key={`${modal.kind}:${modal.province?.id ?? 'new'}`}
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

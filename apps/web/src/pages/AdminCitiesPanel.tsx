import {
  Ban as TableBanIcon,
  CheckCircle as TableCheckCircleIcon,
  Pencil as TablePencilIcon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import {
  LoadingStatus,
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  ListPage,
  ListRefreshButton,
  ListSearchInput,
  NativeSelect,
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
import { inspectCityRows, parseCityRows } from '../lib/geography-form-values.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import {
  StickyRecordEditorActions,
  keepRecordFieldVisible,
  recordEditorFormSurface,
} from '../components/StickyRecordEditorActions.js';

export function ImportCitiesDialog({
  province,
  trigger,
  onClose,
  onSaved,
  readReady,
  recovery,
  onDenied,
  standalone = false,
}: {
  readReady: boolean;
  recovery: ReactNode;
  onDenied: () => void;
  province: Province;
  trigger?: HTMLElement;
  onClose: () => void;
  onSaved: () => void;
  standalone?: boolean;
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
  const preview = useMemo(() => inspectCityRows(text), [text]);
  const issues = preview?.filter((row) => row.issue).length ?? 0;
  function editRow(row: number) {
    const input = field.current;
    if (!input || inFlight.current) return;
    const lines = input.value.split('\n');
    const start = lines.slice(0, row - 1).reduce((offset, line) => offset + line.length + 1, 0);
    input.focus();
    input.setSelectionRange(start, start + (lines[row - 1]?.length ?? 0));
    input.scrollTop = (row - 1) * Number.parseFloat(getComputedStyle(input).lineHeight);
  }
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
          ? 'importConflict'
          : 'requestFailed'
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) native.setValidationPending(false);
    }
  }
  const actions = (
    <>
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
    </>
  );
  const form = (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t('importCities')}
      className={standalone ? recordEditorFormSurface : 'space-y-4'}
      onFocus={standalone ? keepRecordFieldVisible : undefined}
      aria-busy={busy}
    >
      <div className={standalone ? 'space-y-3 px-4 py-4 sm:px-6' : 'space-y-3'}>
        {standalone && (
          <div className="space-y-3 text-sm">
            <p id="city-import-format" className="text-muted-foreground">
              {t('importDescription')}
            </p>
            {!preview && (
              <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-2">
                <p className="font-medium">{t('importExample')}</p>
                <dl dir="ltr" className="grid grid-cols-2 gap-3">
                  <div className="space-y-1" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
                    <dt className="text-xs text-muted-foreground">{t('nameFa')}</dt>
                    <dd>
                      <bdi dir="rtl" lang="fa">
                        کرج
                      </bdi>
                    </dd>
                  </div>
                  <div className="space-y-1" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
                    <dt className="text-xs text-muted-foreground">{t('nameEn')}</dt>
                    <dd>
                      <bdi dir="ltr" lang="en">
                        Karaj
                      </bdi>
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        )}
        {error && (
          <Alert variant="destructive" role="alert" id="city-import-error">
            <AlertDescription>{t(error)}</AlertDescription>
          </Alert>
        )}
        {catalogueRootMessage(native.errors) && (
          <Alert variant="destructive">{catalogueRootMessage(native.errors)}</Alert>
        )}
        <Field className="min-w-0 gap-1">
          <FieldLabel htmlFor="city-import-rows">{t('importRows')}</FieldLabel>
          <Textarea
            {...native.bind('rows')}
            id="city-import-rows"
            ref={(node) => {
              field.current = node;
              native.bind('rows').ref(node);
            }}
            rows={4}
            dir="ltr"
            className="max-h-56 min-h-24 overflow-auto leading-6 whitespace-pre [tab-size:4]"
            maxLength={41000}
            disabled={busy}
            onBlur={() => {
              if (!native.isPending()) native.bind('rows').onBlur();
            }}
            aria-invalid={!!rowsError || undefined}
            aria-describedby={
              [standalone && 'city-import-format', rowsError && native.errorId('rows')]
                .filter(Boolean)
                .join(' ') || undefined
            }
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
            compact
          />
        </Field>
        {!standalone && preview && !issues && (
          <p role="status" className="text-sm">
            {t('importCount').replace('{count}', number(preview.length))}
          </p>
        )}
      </div>
      {standalone && preview && (
        <div className="space-y-2 border-t px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">{t('importPreview')}</h2>
            <p
              role="status"
              className={issues ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
            >
              {t(issues ? 'importNeedsCorrection' : 'importCount').replace(
                '{count}',
                number(issues || preview.length)
              )}
            </p>
          </div>
          <div
            className="max-h-80 overflow-auto rounded-lg border"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The named preview scroll region needs keyboard access.
            tabIndex={0}
            role="region"
            aria-label={t('importPreview')}
          >
            <table className="w-full table-fixed text-start text-sm">
              <caption className="sr-only">{t('importPreview')}</caption>
              <colgroup>
                <col className="w-12 sm:w-16" />
                <col />
                <col />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_var(--border)]">
                <tr>
                  {[t('importRow'), t('nameFa'), t('nameEn')].map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="p-2 text-start text-xs font-medium [overflow-wrap:anywhere] sm:text-sm"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <Fragment key={row.number}>
                    <tr className="border-t align-top [overflow-wrap:anywhere]">
                      <th scope="row" className="p-2 text-start font-medium tabular-nums">
                        {number(row.number)}
                      </th>
                      <td className="p-2">
                        <bdi lang="fa" dir="rtl">
                          {row.nameFa.slice(0, 100) || '—'}
                        </bdi>
                      </td>
                      <td className="p-2">
                        <bdi lang="en" dir="ltr">
                          {row.nameEn.slice(0, 100) || '—'}
                        </bdi>
                      </td>
                    </tr>
                    {row.issue && (
                      <tr className="bg-destructive/5">
                        <td colSpan={3} className="px-2 text-destructive">
                          <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs sm:text-sm">
                            <span id={`city-import-issue-${row.number}`}>{t(row.issue)}</span>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="min-h-10 px-1"
                              disabled={busy}
                              aria-describedby={`city-import-issue-${row.number}`}
                              data-city-import-line={row.number}
                              onClick={() => editRow(row.number)}
                            >
                              {t('importEditRow').replace('{row}', number(row.number))}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">{t('importCheck')}</p>
        </div>
      )}
      {standalone ? (
        <StickyRecordEditorActions secondary={recovery}>{actions}</StickyRecordEditorActions>
      ) : (
        <>
          {recovery}
          <DialogFooter>{actions}</DialogFooter>
        </>
      )}
    </form>
  );
  if (standalone) return form;
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
        finalFocus={() => trigger ?? null}
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle>{t('importCities')}</DialogTitle>
          <DialogDescription>{t('importDescription')}</DialogDescription>
        </DialogHeader>
        {form}
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
  routeSearch,
}: {
  province: Province;
  scope?: GeographyScope;
  parentReady?: boolean;
  parentRecovery?: ReactNode;
  onClose?: () => void;
  query?: ListQueryBinding;
  routeSearch?: Record<string, unknown>;
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
    const nextProvince = geographyBasis(province);
    if (acceptedCriteria.current === criteria && previousProvince.current === nextProvince) return;
    savedTrigger.current = null;
    acceptedCriteria.current = criteria;
    previousProvince.current = nextProvince;
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
          {routeSearch && ready ? (
            <Link
              className={buttonVariants({ className: 'min-h-11' })}
              to="/admin/geography/provinces/$provinceId/cities/$cityId/{-$action}"
              params={{ provinceId: province.id, cityId: 'new' }}
              search={routeSearch}
            >
              {t('addCity')}
            </Link>
          ) : (
            <Button
              disabled={!ready}
              onClick={(event) =>
                openModal({ kind: 'add', province: null, trigger: event.currentTarget })
              }
            >
              {t('addCity')}
            </Button>
          )}
          {routeSearch && ready ? (
            <Link
              className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
              to="/admin/geography/provinces/$provinceId/cities/$cityId/{-$action}"
              params={{ provinceId: province.id, cityId: 'import' }}
              search={routeSearch}
            >
              {t('importCities')}
            </Link>
          ) : (
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
          )}
        </div>
      </header>
      <ListPage>
        <ListPage.Toolbar
          search={
            <ListSearchInput
              label={t('citySearch')}
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
          loadingView={<LoadingStatus>{t('cityLoading')}</LoadingStatus>}
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
              {...(routeSearch && ready
                ? {
                    renderName: (city, name) => (
                      <Link
                        to="/admin/geography/provinces/$provinceId/cities/$cityId/{-$action}"
                        params={{ provinceId: province.id, cityId: city.id }}
                        search={routeSearch}
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        {name}
                      </Link>
                    ),
                  }
                : {})}
              renderActions={(city) => (
                <div className="flex flex-wrap gap-2">
                  {routeSearch && ready ? (
                    <Link
                      className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                      to="/admin/geography/provinces/$provinceId/cities/$cityId/{-$action}"
                      params={{ provinceId: province.id, cityId: city.id, action: 'edit' }}
                      search={routeSearch}
                      data-table-action-tooltip={t('edit')}
                    >
                      <TableActionIcon icon={TablePencilIcon}>{t('edit')}</TableActionIcon>
                    </Link>
                  ) : (
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
                      data-table-action-tooltip={t('edit')}
                    >
                      <TableActionIcon icon={TablePencilIcon}>{t('edit')}</TableActionIcon>
                    </Button>
                  )}
                  {(!routeSearch || city.status === 'active') && (
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
                      data-table-action-tooltip={t(
                        city.status === 'active' ? 'deactivate' : 'activate'
                      )}
                    >
                      <TableActionIcon
                        icon={city.status === 'active' ? TableBanIcon : TableCheckCircleIcon}
                      >
                        {t(city.status === 'active' ? 'deactivate' : 'activate')}
                      </TableActionIcon>
                    </Button>
                  )}
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

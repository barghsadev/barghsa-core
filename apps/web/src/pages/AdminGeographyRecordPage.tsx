import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  buttonVariants,
  ListRefreshButton,
  LoadingStatus,
} from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { geographyText, type GeographyTextKey } from '@barghsa/i18n/geography';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { geographyBasis } from '../hooks/useGeographyList.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useLocale } from '../hooks/useLocale.js';
import { isCity, isProvince, type City, type Province } from '../lib/geography-api.js';
import { geographyListSearch, type GeographySearch } from '../lib/geography-location.js';
import { toast } from '../lib/toast-api.js';
import { GeographyDialog, type GeographyModal } from './AdminGeographyDialog.js';

const CitiesPanel = lazy(() =>
  import('./AdminCitiesPanel.js').then(({ CitiesPanel }) => ({ default: CitiesPanel }))
);
const ImportCitiesDialog = lazy(() =>
  import('./AdminCitiesPanel.js').then(({ ImportCitiesDialog }) => ({
    default: ImportCitiesDialog,
  }))
);

function canReadProvinces(value: unknown): value is { provinces: Province[]; total: number } {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    Array.isArray(result.provinces) &&
    result.provinces.length <= 1 &&
    result.provinces.every(isProvince) &&
    typeof result.total === 'number' &&
    Number.isSafeInteger(result.total) &&
    result.total >= 0
  );
}

export default function AdminGeographyRecordPage({
  provinceId,
  cityId,
  edit,
  search,
  cityQuery,
}: {
  provinceId: string;
  cityId?: string;
  edit: boolean;
  search: GeographySearch;
  cityQuery?: ListQueryBinding;
}) {
  const locale = useLocale();
  const t = (key: GeographyTextKey) => geographyText(key, locale);
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [provinceId, cityId, edit]);
  const scope = useCatalogueScope();
  const cityRoute = cityId !== undefined;
  const createProvince = provinceId === 'new';
  const createCity = cityId === 'new';
  const importing = cityId === 'import';
  const creating = createProvince || createCity;
  const collection = '/api/admin/geography/provinces';
  const provincePath = `${collection}/${encodeURIComponent(provinceId)}`;
  const hasCity = cityRoute && !createCity && !importing;
  const validateProvince = useCallback(
    (data: unknown): data is Province => isProvince(data) && data.id === provinceId,
    [provinceId]
  );
  const validateCity = useCallback(
    (data: unknown): data is City =>
      isCity(data) && data.id === cityId && data.provinceId === provinceId,
    [cityId, provinceId]
  );
  const provinceRead = useCatalogueResource(
    scope,
    createProvince ? null : provincePath,
    validateProvince,
    { clearOnMissing: true }
  );
  const cityRead = useCatalogueResource(
    scope,
    hasCity ? `${provincePath}/cities/${encodeURIComponent(cityId)}` : null,
    validateCity,
    { clearOnMissing: true }
  );
  const permissionRead = useCatalogueResource(
    scope,
    createProvince ? `${collection}?page=1&limit=1` : null,
    canReadProvinces
  );
  const province = provinceRead.data;
  const record = cityRoute ? cityRead.data : province;
  const loading = provinceRead.loading || cityRead.loading || permissionRead.loading;
  const missing = provinceRead.missing || cityRead.missing;
  const error = provinceRead.error || cityRead.error || permissionRead.error;
  const accessible = !scope.denied && !missing;
  const hasParent = !!(createProvince ? permissionRead.data : province);
  const ready = accessible && hasParent && (!hasCity || !!record) && !loading && !error;
  const localizedName = (item: Province) => (locale === 'fa' ? item.nameFa : item.nameEn);
  const detailTitle = cityRoute ? t('city') : t('province');
  const title = creating
    ? t(cityRoute ? 'addCity' : 'add')
    : importing
      ? t('importCities')
      : edit
        ? t(cityRoute ? 'editCity' : 'editTitle')
        : record && accessible
          ? localizedName(record)
          : detailTitle;
  const selectedRead = hasCity ? cityRead : createProvince ? permissionRead : provinceRead;
  const modal = useMemo<GeographyModal>(
    () => ({ kind: creating ? 'add' : 'edit', province: creating ? null : record, trigger: null }),
    [creating, record]
  );
  const basis = record ? geographyBasis(record) : '';
  const formKey = JSON.stringify([selectedRead.ownerKey, provinceRead.ownerKey, basis]);
  function openProvince(id: string, replace = false) {
    void navigate({
      to: '/admin/geography/provinces/$provinceId/{-$action}',
      params: { provinceId: id, action: undefined },
      search,
      replace,
    });
  }
  function openCity(id: string, replace = false) {
    void navigate({
      to: '/admin/geography/provinces/$provinceId/cities/$cityId/{-$action}',
      params: { provinceId, cityId: id, action: undefined },
      search,
      replace,
    });
  }
  function leaveForm() {
    if (createProvince) {
      void navigate({ to: '/admin/geography', search: geographyListSearch(search) });
    } else if (createCity || importing || !cityId) openProvince(provinceId);
    else openCity(cityId);
  }
  function saved(value: Province | null) {
    if (!value) return;
    if (edit) {
      if (cityRoute && isCity(value)) cityRead.accept(value);
      if (!cityRoute) provinceRead.accept(value);
    }
    toast.success(confirmationText('recorded', locale));
    if (cityRoute) openCity(value.id, true);
    else openProvince(value.id, true);
  }
  function retry() {
    if (scope.denied) scope.recover();
    else {
      if (provinceRead.error && hasCity) provinceRead.retry();
      selectedRead.retry();
    }
  }
  const retryLabel = t(cityRoute ? 'cityRetry' : 'provinceRetry');
  const recovery =
    error || scope.denied ? (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={retry} disabled={loading}>
          {retryLabel}
        </Button>
        {error && !missing && (
          <p role="alert" className="text-sm text-destructive">
            {t('requestFailed')}
          </p>
        )}
      </div>
    ) : (
      <ListRefreshButton label={retryLabel} refreshing={loading} onClick={retry} />
    );
  return (
    <section
      aria-labelledby="geography-location-title"
      className={`min-w-0 space-y-5${creating || edit || importing ? ' mx-auto max-w-3xl' : ''}`}
    >
      <header className="space-y-3">
        <nav aria-label={t('title')} className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            className="text-primary underline-offset-4 hover:underline"
            to="/admin/geography"
            search={geographyListSearch(search)}
          >
            {t('title')}
          </Link>
          {province && accessible && (cityRoute || edit) && (
            <>
              <span aria-hidden="true" className="text-muted-foreground">
                /
              </span>
              <Link
                className="text-primary [overflow-wrap:anywhere] underline-offset-4 hover:underline"
                to="/admin/geography/provinces/$provinceId/{-$action}"
                params={{ provinceId, action: undefined }}
                search={search}
              >
                <bdi>{localizedName(province)}</bdi>
              </Link>
            </>
          )}
        </nav>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            {record && !creating && accessible && (
              <p className="text-sm text-muted-foreground">{detailTitle}</p>
            )}
            <h1
              id="geography-location-title"
              data-slot="record-page-heading"
              ref={heading}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] focus-visible:outline-hidden!"
            >
              {title}
            </h1>
          </div>
          {record &&
            ready &&
            !edit &&
            (cityId ? (
              <Link
                to="/admin/geography/provinces/$provinceId/cities/$cityId/{-$action}"
                className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                params={{ provinceId, cityId, action: 'edit' }}
                search={search}
              >
                {t('editCity')}
              </Link>
            ) : (
              <Link
                to="/admin/geography/provinces/$provinceId/{-$action}"
                className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                params={{ provinceId, action: 'edit' }}
                search={search}
              >
                {t('editTitle')}
              </Link>
            ))}
        </div>
      </header>
      {scope.denied ? (
        <div className="space-y-3">
          <Alert role="alert" variant="destructive">
            <AlertDescription>{t('denied')}</AlertDescription>
          </Alert>
          {recovery}
        </div>
      ) : missing ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{t('locationMissing')}</AlertDescription>
        </Alert>
      ) : !hasParent || (hasCity && !record) ? (
        loading ? (
          <LoadingStatus>{t('loadingLocation')}</LoadingStatus>
        ) : (
          recovery
        )
      ) : importing && province ? (
        <Suspense fallback={<LoadingStatus>{t('cityLoading')}</LoadingStatus>}>
          <ImportCitiesDialog
            key={formKey}
            standalone
            province={province}
            readReady={ready}
            recovery={recovery}
            onDenied={scope.deny}
            onClose={leaveForm}
            onSaved={() => {
              toast.success(confirmationText('recorded', locale));
              openProvince(provinceId, true);
            }}
          />
        </Suspense>
      ) : edit || creating ? (
        <GeographyDialog
          key={formKey}
          standalone
          {...(cityRoute ? { provinceId } : {})}
          modal={modal}
          readReady={ready}
          recovery={recovery}
          onDenied={scope.deny}
          onClose={leaveForm}
          onSaved={saved}
        />
      ) : (
        record && (
          <>
            <dl className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 text-sm sm:grid-cols-3 sm:p-6">
              <div className="min-w-0">
                <dt className="text-muted-foreground">{t('nameFa')}</dt>
                <dd className="mt-1 font-medium [overflow-wrap:anywhere]">
                  <bdi lang="fa" dir="rtl">
                    {record.nameFa}
                  </bdi>
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">{t('nameEn')}</dt>
                <dd className="mt-1 font-medium [overflow-wrap:anywhere]">
                  <bdi lang="en" dir="ltr">
                    {record.nameEn}
                  </bdi>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('status')}</dt>
                <dd className="mt-1">
                  <Badge variant={record.status === 'active' ? 'default' : 'secondary'}>
                    {t(record.status)}
                  </Badge>
                </dd>
              </div>
            </dl>
            {recovery}
            {!cityRoute && province && (
              <Suspense fallback={<LoadingStatus>{t('cityLoading')}</LoadingStatus>}>
                <CitiesPanel
                  key={provinceRead.ownerKey}
                  province={province}
                  scope={scope}
                  parentReady={ready}
                  routeSearch={search}
                  {...(cityQuery ? { query: cityQuery } : {})}
                />
              </Suspense>
            )}
          </>
        )
      )}
    </section>
  );
}

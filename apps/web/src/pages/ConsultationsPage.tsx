import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { commercialFetch as fetch } from '../lib/commercial-fetch.js';
import { ListPage } from '@barghsa/ui';
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
import { t } from '@barghsa/i18n/app';
import { HistoryDateFilter } from '../components/HistoryDateFilter.js';
import type { DateRangeFilterValue } from '@barghsa/shared/validation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Alert,
  AlertDescription,
  Button,
  StatusFilter,
  StatusBadge,
  ListViewToggle,
} from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import {
  consultationIntakeReceipt,
  definitiveConsultationRejection,
  emptyConsultationIntake,
  type ConsultationIntakeDraft,
} from '../lib/consultation-form.js';
import { CONSULTATION_REQUEST_STATUSES } from '@barghsa/shared/validation';
import { useCursorHistory } from '../hooks/useCursorHistory.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { statusFilterTone } from '../lib/status-filter-tone.js';
import { tConsultation } from '@barghsa/i18n/consultation';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { withCsrf } from '../lib/csrf.js';
import { consultationNextAction } from '../lib/consultation-next-action.js';
import type { SwitcherProfile } from '../components/ProfileSwitcher.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';

interface Product {
  id: string;
  systemKey: string | null;
  title: { fa: string; en: string };
  description: { fa?: string; en?: string } | null;
}
interface RequestRow {
  id: string;
  status: string;
  product_snapshot: { title: { fa: string; en: string } };
  submitted_at: string;
  staff_owner_username: string | null;
  staff_owner_id?: string | null;
  staff_team: string | null;
  expected_next_step: string | null;
  invoice_id: string | null;
  invoice_state: string | null;
  accepted_at: string | null;
  offer_valid_until: string | null;
  refund_pending: boolean;
}

class ConsultationReadError extends Error {
  constructor(
    readonly source: 'profile' | 'history',
    readonly status: number
  ) {
    super('Consultation read unavailable');
  }
}

export function ConsultationsPage({
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

  const navigate = useNavigate();
  const { view, setView } = useListView('consultations');
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const time = useAccountTime(locale);
  const copy = (key: string) => tConsultation(key, locale);
  const actorId = useAccountUser();
  const contextRevision = useProfileContextRevision();
  const identity = JSON.stringify([actorId, contextRevision]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const currentContext = () =>
    currentIdentity.current === identity && getProfileContextRevision() === contextRevision;
  const [profileState, setProfileState] = useState<{
    owner: string;
    value: SwitcherProfile | null;
  }>({ owner: identity, value: null });
  const profile = profileState.owner === identity ? profileState.value : null;
  const setProfile = (value: SwitcherProfile | null) => setProfileState({ owner: identity, value });
  const scope = JSON.stringify([identity, profile?.id ?? null]);
  const [productState, setProducts] = useState<Product[]>([]);
  const [productsScope, setProductsScope] = useState('');
  const products = productsScope === scope ? productState : [];
  const statusOptions: Parameters<typeof StatusFilter>[0]['options'] =
    CONSULTATION_REQUEST_STATUSES.map((value) => ({
      value,
      label: copy(`status_${value}`),
      tone: statusFilterTone(value),
    }));
  const statusesKey = statuses.join(',');
  const historyScope = JSON.stringify([
    scope,
    statusesKey,
    dateRange.from ?? null,
    dateRange.to ?? null,
    query.q,
    query.sort,
  ]);
  const historyIdentity = useRef(historyScope);
  historyIdentity.current = historyScope;
  const {
    items: requests,
    before,
    nextBefore,
    acceptPage,
    loadMore,
    clear,
    reset,
  } = useCursorHistory<RequestRow>(historyScope);
  const [requestRead, setRequestRead] = useState({
    scope: historyScope,
    status: 'loading' as 'loading' | 'ready' | 'error' | 'denied',
  });
  const requestStatus = requestRead.scope === historyScope ? requestRead.status : 'loading';
  const requestsLoading = requestStatus === 'loading';
  const requestsError = requestStatus === 'error' || requestStatus === 'denied';
  const [requestRevision, setRequestRevision] = useState(0);
  const generation = useRef(0);
  const acceptedScope = useRef(scope);
  if (acceptedScope.current !== scope) {
    acceptedScope.current = scope;
    ++generation.current;
  }
  const schemaGeneration = generation.current;
  const intakeMessages = {
    productId: copy('productInvalid'),
    confirm: copy('confirmationInvalid'),
  };
  const intake = useZodForm<ConsultationIntakeDraft>(
    async () => {
      const schemas = await import('../lib/consultation-form-schemas.js');
      return schemaGeneration === generation.current && currentContext()
        ? schemas.intakeSchema(intakeMessages)
        : schemas.inactiveIntakeSchema;
    },
    {
      defaultValues: emptyConsultationIntake,
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const intakeFields = useActionFieldErrors(
    intake,
    { productId: intakeMessages.productId },
    copy('submitError')
  );
  const selectedProductId = intake.watch('productId');
  const [profileRead, setProfileRead] = useState({
    owner: identity,
    status: 'loading' as 'loading' | 'ready' | 'error' | 'denied',
  });
  const profileStatus = profileRead.owner === identity ? profileRead.status : 'loading';
  const loading = profileStatus === 'loading';
  const loadError = profileStatus === 'error' || profileStatus === 'denied';
  const [submitError, setSubmitError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submissionKey = useRef<string | null>(null);
  const pendingIntake = useRef<{
    profileId: string;
    productId: string;
    submissionKey: string;
  } | null>(null);
  const [intakeUnconfirmed, setIntakeUnconfirmed] = useState(false);
  useEffect(() => {
    ++generation.current;
    intake.reset(emptyConsultationIntake);
    submissionKey.current = null;
    pendingIntake.current = null;
    setIntakeUnconfirmed(false);
    setSubmitting(false);
    setSubmitError(false);
  }, [scope]);
  useEffect(
    () => () => {
      ++generation.current;
    },
    []
  );

  const [profileRevision, setProfileRevision] = useState(0);
  const [productsRevision, setProductsRevision] = useState(0);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState(false);
  const [productsDenied, setProductsDenied] = useState(false);
  const catalogueRevision = useRef(0);
  const catalogue = useRef({
    products,
    loading: productsLoading,
    error: productsError,
    denied: productsDenied,
  });
  catalogue.current = {
    products,
    loading: productsLoading,
    error: productsError,
    denied: productsDenied,
  };
  function refreshProducts() {
    ++catalogueRevision.current;
    catalogue.current.loading = true;
    setProductsRevision((value) => value + 1);
  }
  async function readProfile(controller: AbortController): Promise<SwitcherProfile | null> {
    const response = await fetch('/api/profiles', {
      credentials: 'include',
      signal: controller.signal,
    });
    if (controller.signal.aborted || !currentContext()) throw new Error('Obsolete profile read');
    if (!response.ok) throw new ConsultationReadError('profile', response.status);
    const data: unknown = await response.json();
    if (controller.signal.aborted || !currentContext()) throw new Error('Obsolete profile read');
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      !('activeProfileId' in data) ||
      !('profiles' in data) ||
      !Array.isArray(data.profiles) ||
      !(
        data.activeProfileId === null ||
        (typeof data.activeProfileId === 'string' && data.activeProfileId.length > 0)
      )
    )
      throw new Error('Invalid profile read');
    if (data.activeProfileId === null) return null;
    const selected = data.profiles.find(
      (row: unknown) =>
        row && typeof row === 'object' && 'id' in row && row.id === data.activeProfileId
    );
    if (!selected) throw new Error('Invalid active profile');
    return selected as SwitcherProfile;
  }
  const denied = (error: unknown) =>
    error instanceof ConsultationReadError && [401, 403].includes(error.status);
  useEffect(() => {
    const controller = new AbortController();
    setProfileRead({ owner: identity, status: 'loading' });
    void readProfile(controller)
      .then((value) => {
        if (controller.signal.aborted || !currentContext()) return;
        setProfile(value);
        setProfileRead({ owner: identity, status: 'ready' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !currentContext()) return;
        setProfile(null);
        setProfileRead({ owner: identity, status: denied(error) ? 'denied' : 'error' });
      });
    return () => controller.abort();
  }, [profileRevision, identity]);
  useEffect(() => {
    if (!profile) return;
    ++catalogueRevision.current;
    catalogue.current.loading = true;
    const controller = new AbortController();
    setProductsLoading(true);
    setProductsError(false);
    setProductsDenied(false);
    void fetch(`/api/consultations/products?profileId=${encodeURIComponent(profile.id)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{ products: Product[] }>;
      })
      .then((data) => {
        if (controller.signal.aborted || !currentContext() || acceptedScope.current !== scope)
          return;
        if (
          !Array.isArray(data.products) ||
          !data.products.every(
            (product) =>
              typeof product.id === 'string' &&
              typeof product.title?.en === 'string' &&
              typeof product.title?.fa === 'string'
          )
        )
          throw new Error('products');
        setProducts(data.products);
        setProductsScope(scope);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || !currentContext() || acceptedScope.current !== scope)
          return;
        if (cause instanceof Error && ['401', '403', '404'].includes(cause.message)) {
          setProducts([]);
          setProductsDenied(true);
          if (!pendingIntake.current) {
            intake.reset(emptyConsultationIntake);
            submissionKey.current = null;
          }
        } else setProductsError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted && currentContext() && acceptedScope.current === scope)
          setProductsLoading(false);
      });
    return () => controller.abort();
  }, [profile, productsRevision]);
  useEffect(() => {
    if (
      !pendingIntake.current &&
      selectedProductId &&
      !products.some((product) => product.id === selectedProductId)
    ) {
      intake.reset(emptyConsultationIntake);
      setSubmitError(false);
      submissionKey.current = null;
    }
  }, [products, selectedProductId]);

  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController();
    const fresh = () =>
      !controller.signal.aborted && currentContext() && historyIdentity.current === historyScope;
    setRequestRead({ scope: historyScope, status: 'loading' });
    void (async () => {
      const selected = await readProfile(controller);
      if (!fresh()) return;
      if (selected?.id !== profile.id) {
        ++generation.current;
        clear();
        setProfile(selected);
        setProfileRead({ owner: identity, status: 'ready' });
        return;
      }
      const queryParams = new URLSearchParams({ profileId: profile.id });
      if (before) queryParams.set('before', before);
      if (statusesKey) queryParams.set('statuses', statusesKey);
      if (dateRange.from) queryParams.set('from', dateRange.from);
      if (dateRange.to) queryParams.set('to', dateRange.to);
      if (query.q) queryParams.set('q', query.q);
      if (query.sort !== DEFAULT_HISTORY_SORT) queryParams.set('sort', query.sort);
      const response = await fetch(`/api/consultations/requests?${queryParams}`, {
        credentials: 'include',
        signal: controller.signal,
      });
      if (!fresh()) return;
      if (!response.ok) throw new ConsultationReadError('history', response.status);
      const result = (await response.json()) as {
        requests: RequestRow[];
        nextBefore: string | null;
      };
      if (!fresh()) return;
      if (
        !Array.isArray(result.requests) ||
        result.requests.some((row) => !row || typeof row.id !== 'string' || !row.id) ||
        (result.nextBefore !== null && typeof result.nextBefore !== 'string')
      )
        throw new Error('Invalid consultation history');
      acceptPage(result.requests, result.nextBefore);
      setRequestRead({ scope: historyScope, status: 'ready' });
    })().catch((error: unknown) => {
      if (!fresh()) return;
      if (denied(error)) {
        clear();
        if (error instanceof ConsultationReadError && error.source === 'profile') {
          ++generation.current;
          setProfile(null);
          setProfileRead({ owner: identity, status: 'denied' });
        }
      }
      setRequestRead({ scope: historyScope, status: denied(error) ? 'denied' : 'error' });
    });
    return () => controller.abort();
  }, [profile, before, requestRevision, historyScope, acceptPage, clear]);

  function submit(event: FormEvent<HTMLFormElement>) {
    if (
      !currentContext() ||
      !profile ||
      productsLoading ||
      productsError ||
      productsDenied ||
      submitting ||
      intake.isSubmissionPending()
    ) {
      event.preventDefault();
      return;
    }
    const capturedGeneration = generation.current;
    const capturedCatalogue = catalogueRevision.current;
    const capturedProfile = profile.id;
    void intake.handleSubmit(async (draft) => {
      if (
        !currentContext() ||
        capturedGeneration !== generation.current ||
        capturedCatalogue !== catalogueRevision.current ||
        catalogue.current.loading ||
        catalogue.current.error ||
        catalogue.current.denied ||
        intake.getValues('productId') !== draft.productId ||
        intake.getValues('confirm') !== draft.confirm ||
        (!pendingIntake.current &&
          !catalogue.current.products.some((product) => product.id === draft.productId))
      )
        return;
      const body = pendingIntake.current ?? {
        profileId: capturedProfile,
        productId: draft.productId,
        submissionKey: (submissionKey.current ??= crypto.randomUUID()),
      };
      pendingIntake.current = body;
      setSubmitting(true);
      setSubmitError(false);
      let completed = false;
      try {
        const response = await fetch('/api/consultations/requests', {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        const result = await response.json().catch(() => null);
        if (!currentContext() || capturedGeneration !== generation.current) return;
        if (!response.ok) {
          if (
            response.status === 400 &&
            result?.error?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
            Array.isArray(result.error.fields) &&
            intakeFields(result.error.fields)
          ) {
            pendingIntake.current = null;
            setIntakeUnconfirmed(false);
            return;
          }
          if ([401, 403, 404].includes(response.status)) {
            setProducts([]);
            setProductsDenied(true);
          }
          if (definitiveConsultationRejection(response.status, result)) {
            pendingIntake.current = null;
            setIntakeUnconfirmed(false);
            setSubmitError(true);
            return;
          }
          throw new Error('submit');
        }
        if (!consultationIntakeReceipt(result)) throw new Error('receipt');
        pendingIntake.current = null;
        setIntakeUnconfirmed(false);
        completed = true;
        void navigate({
          to: '/consultations/$requestId',
          params: { requestId: result.requestId },
        });
      } catch {
        if (currentContext() && capturedGeneration === generation.current) {
          setSubmitError(true);
          setIntakeUnconfirmed(true);
        }
      } finally {
        if (currentContext() && capturedGeneration === generation.current && !completed)
          setSubmitting(false);
      }
    })(event);
  }

  const profileName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.title || profile.id
    : '';

  const columns: HistoryColumn<RequestRow>[] = [
    {
      id: 'reference',
      label: t('historySearch.reference', locale),
      render: (request) => (
        <Link
          to="/consultations/$requestId"
          params={{ requestId: request.id }}
          className="text-primary underline underline-offset-4"
        >
          <bdi dir="ltr" className="break-all">
            {request.id}
          </bdi>
        </Link>
      ),
    },
    {
      id: 'subject',
      label: t('historyView.subject', locale),
      render: (request) => (
        <span className="font-medium" dir="auto">
          {request.product_snapshot.title[locale]}
        </span>
      ),
    },
    {
      id: 'status',
      label: copy('status'),
      render: (request) => (
        <StatusBadge
          label={copy(`status_${request.status}`)}
          tone={statusFilterTone(request.status)}
        />
      ),
    },
    {
      id: 'owner',
      label: copy('owner'),
      render: (request) => (
        <div className="min-w-40 space-y-1">
          <p dir="auto">
            {request.staff_owner_username ??
              (request.staff_owner_id
                ? copy('assignedStaff')
                : request.staff_team
                  ? copy('awaitingOwner')
                  : copy('unassigned'))}
          </p>
          {request.staff_team && (
            <p className="text-muted-foreground">
              {copy('team')}: <span dir="auto">{request.staff_team}</span>
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'action',
      label: copy('nextStep'),
      render: (request) => {
        const action = consultationNextAction(request, request.refund_pending, locale);
        const invoiceAction = request.invoice_id && action.href?.startsWith('/invoices/');
        const href = action.href?.startsWith('#')
          ? `/consultations/${encodeURIComponent(request.id)}${action.href}`
          : action.href;
        return (
          <div className="min-w-44 space-y-2">
            {href && !invoiceAction ? (
              <a href={href} className="text-primary underline underline-offset-4">
                {action.text}
              </a>
            ) : (
              <p>{action.text}</p>
            )}
            {request.invoice_id && invoiceAction && (
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: request.invoice_id }}
                className="font-medium text-primary underline underline-offset-4"
              >
                {copy('viewInvoice')}
              </Link>
            )}
          </div>
        );
      },
    },
    {
      id: 'submitted',
      label: copy('submittedAt'),
      render: (request) => (
        <time dateTime={request.submitted_at}>
          {time.format(request.submitted_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </time>
      ),
    },
  ];
  return (
    <section
      className={`mx-auto w-full min-w-0 space-y-8 px-4 py-8 ${view === 'table' ? 'max-w-7xl' : 'max-w-4xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{copy('title')}</h1>
        <p className="max-w-2xl text-muted-foreground">{copy('intro')}</p>
      </header>
      {time.notice}
      {loading && <p role="status">{copy('loading')}</p>}
      {loadError && (
        <div role="alert" className="space-y-2">
          <p>
            {profileStatus === 'denied'
              ? t('historyPagination.accessDenied', locale)
              : copy('profileLoadError')}
          </p>
          <Button variant="outline" onClick={() => setProfileRevision((value) => value + 1)}>
            {copy('retry')}
          </Button>
        </div>
      )}
      {!loading && !loadError && !profile && <p role="alert">{copy('profileRequired')}</p>}
      {!loading && !loadError && profile && (
        <>
          <Form {...intake}>
            <div role="group" aria-label={copy('intakeForm')}>
              <form onSubmit={submit} noValidate className="max-w-4xl space-y-5">
                <div className="rounded-xl border bg-card p-4">
                  <span className="text-sm text-muted-foreground">{copy('profile')}</span>
                  <p className="font-medium" dir="auto">
                    {profileName}
                  </p>
                </div>
                {intake.formState.errors.root && (
                  <Alert variant="destructive">
                    <AlertDescription>{copy('validationUnavailable')}</AlertDescription>
                  </Alert>
                )}
                <FormField
                  control={intake.control}
                  name="productId"
                  render={({ field }) => (
                    <FormItem id="consultation-product">
                      <FormLabel id="consultation-product-label" className="text-xl font-semibold">
                        {copy('available')}
                      </FormLabel>
                      <FormControl>
                        <div
                          role="radiogroup"
                          aria-labelledby="consultation-product-label"
                          onBlur={field.onBlur}
                        >
                          <ListPage>
                            <ListPage.Toolbar
                              actions={
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={productsLoading || intake.formState.isSubmitting}
                                  onClick={refreshProducts}
                                >
                                  {copy('refreshProducts')}
                                </Button>
                              }
                            />
                            <ListPage.Content
                              loading={productsLoading}
                              error={productsError || productsDenied}
                              empty={!products.length}
                              retainContent={!!products.length && !productsDenied}
                              loadingView={<p role="status">{copy('loading')}</p>}
                              errorView={
                                productsDenied ? (
                                  <p role="alert">{copy('productsDenied')}</p>
                                ) : (
                                  <div className="space-y-2">
                                    <p role="alert">{copy('productsError')}</p>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={refreshProducts}
                                    >
                                      {copy('retry')}
                                    </Button>
                                  </div>
                                )
                              }
                              emptyView={
                                <p className="text-muted-foreground">{copy('emptyProducts')}</p>
                              }
                            >
                              {products.map((product, index) => (
                                <label
                                  key={product.id}
                                  className={`flex cursor-pointer gap-3 rounded-xl border bg-card p-5 transition-colors hover:border-primary ${selectedProductId === product.id ? 'border-primary ring-1 ring-primary' : ''}`}
                                >
                                  <input
                                    type="radio"
                                    id={`consultation-product-${product.id}`}
                                    ref={index === 0 ? field.ref : undefined}
                                    name={field.name}
                                    value={product.id}
                                    checked={selectedProductId === product.id}
                                    disabled={
                                      submitting ||
                                      intake.formState.isSubmitting ||
                                      intakeUnconfirmed ||
                                      productsLoading ||
                                      productsError ||
                                      productsDenied
                                    }
                                    aria-describedby="consultation-product-description consultation-product-message"
                                    onChange={() => {
                                      field.onChange(product.id);
                                      submissionKey.current = null;
                                      setSubmitError(false);
                                    }}
                                    className="mt-1"
                                  />
                                  <span className="space-y-1">
                                    <span className="block font-semibold" dir="auto">
                                      {product.title[locale]}
                                    </span>
                                    {product.description?.[locale] && (
                                      <span
                                        className="block text-sm text-muted-foreground"
                                        dir="auto"
                                      >
                                        {product.description[locale]}
                                      </span>
                                    )}
                                  </span>
                                </label>
                              ))}
                            </ListPage.Content>
                          </ListPage>
                        </div>
                      </FormControl>
                      <FormDescription>{copy('productHelp')}</FormDescription>
                      <div className="grid">
                        <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
                          {intakeMessages.productId}
                        </p>
                        <FormMessage className="col-start-1 row-start-1" />
                      </div>
                    </FormItem>
                  )}
                />
                {!productsDenied && (products.length > 0 || pendingIntake.current) && (
                  <>
                    <FormField
                      control={intake.control}
                      name="confirm"
                      render={({ field }) => (
                        <FormItem id="consultation-confirmation">
                          <div className="flex items-start gap-2 text-sm">
                            <FormControl>
                              <input
                                type="checkbox"
                                ref={field.ref}
                                name={field.name}
                                checked={field.value}
                                onChange={(event) => field.onChange(event.target.checked)}
                                onBlur={field.onBlur}
                                disabled={
                                  submitting || intake.formState.isSubmitting || intakeUnconfirmed
                                }
                                className="mt-1"
                              />
                            </FormControl>
                            <FormLabel>{copy('confirm')}</FormLabel>
                          </div>
                          <FormDescription>{copy('confirmationHelp')}</FormDescription>
                          <div className="grid">
                            <p
                              aria-hidden="true"
                              className="invisible col-start-1 row-start-1 text-sm"
                            >
                              {intakeMessages.confirm}
                            </p>
                            <FormMessage className="col-start-1 row-start-1" />
                          </div>
                        </FormItem>
                      )}
                    />
                    {profile?.id && <OrderWalletBalance profileId={profile.id} scopeKey={scope} />}
                    {submitError && (
                      <Alert variant="destructive">
                        <AlertDescription>
                          {copy(intakeUnconfirmed ? 'intakeUnconfirmed' : 'submitError')}
                        </AlertDescription>
                      </Alert>
                    )}
                    <Button
                      type="submit"
                      loading={intake.formState.isSubmitting || submitting}
                      disabled={
                        productsLoading ||
                        productsError ||
                        productsDenied ||
                        submitting ||
                        intake.formState.isSubmitting
                      }
                    >
                      {copy('request')}
                    </Button>
                  </>
                )}
              </form>
            </div>
          </Form>

          <section className="space-y-3" aria-labelledby="consultation-requests-title">
            <h2 id="consultation-requests-title" className="text-xl font-semibold">
              {copy('myRequests')}
            </h2>
            <ListPage>
              <ListPage.Toolbar
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
                        domain="consultation"
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
                loading={requestsLoading}
                error={requestsError}
                empty={requests.length === 0}
                retainContent={requests.length > 0}
                loadingView={<p role="status">{copy('loading')}</p>}
                errorView={
                  <div className="space-y-2">
                    <p role="alert">
                      {requestStatus === 'denied'
                        ? t('historyPagination.accessDenied', locale)
                        : copy('loadError')}
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!currentContext() || historyIdentity.current !== historyScope) return;
                        if (requestStatus === 'denied') reset();
                        setRequestRevision((value) => value + 1);
                      }}
                    >
                      {copy('retry')}
                    </Button>
                  </div>
                }
                emptyView={
                  <p className="text-muted-foreground">
                    {dateRange.from || dateRange.to || query.q
                      ? t('historyDates.empty', locale)
                      : copy(statuses.length ? 'filteredEmpty' : 'emptyRequests')}
                  </p>
                }
              >
                {view === 'table' && requests.length ? (
                  <HistoryTable
                    caption={copy('myRequests')}
                    items={requests}
                    columns={columns}
                    rowKey={(request) => request.id}
                  />
                ) : (
                  <ul className="space-y-3">
                    {requests.map((request) => {
                      const action = consultationNextAction(
                        request,
                        request.refund_pending,
                        locale
                      );
                      return (
                        <li key={request.id}>
                          <Link
                            to="/consultations/$requestId"
                            params={{ requestId: request.id }}
                            className="block rounded-xl border bg-card p-4 hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            <span className="block font-semibold" dir="auto">
                              {request.product_snapshot.title[locale]}
                            </span>
                            <span className="mt-2 block text-sm">
                              {copy('status')}: {copy(`status_${request.status}`)}
                            </span>
                            <span className="block text-sm text-muted-foreground">
                              {copy('nextStep')}: {action.text}
                            </span>
                            <span className="block text-sm text-muted-foreground">
                              {copy('owner')}:{' '}
                              <span dir="auto">
                                {request.staff_owner_username ??
                                  (request.staff_owner_id
                                    ? copy('assignedStaff')
                                    : request.staff_team
                                      ? copy('awaitingOwner')
                                      : copy('unassigned'))}
                              </span>
                            </span>
                            {request.staff_team && (
                              <span className="block text-sm text-muted-foreground">
                                {copy('team')}: <span dir="auto">{request.staff_team}</span>
                              </span>
                            )}
                            <span className="block break-all text-xs text-muted-foreground">
                              {t('historySearch.reference', locale)}:{' '}
                              <bdi dir="ltr">{request.id}</bdi>
                            </span>
                            <time
                              className="mt-2 block text-xs text-muted-foreground"
                              dateTime={request.submitted_at}
                            >
                              {time.format(request.submitted_at, {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                              })}
                            </time>
                          </Link>
                          {request.invoice_id && action.href?.startsWith('/invoices/') && (
                            <Link
                              to="/invoices/$invoiceId"
                              params={{ invoiceId: request.invoice_id }}
                              className="mt-2 inline-block text-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
                            >
                              {copy('viewInvoice')}
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ListPage.Content>
              <ListPage.Pagination
                kind="cursor"
                hasMore={!!nextBefore && !requestsError}
                loading={requestsLoading}
                onNext={loadMore}
                label={t('historyPagination.label', locale)}
                nextLabel={copy('moreRequests')}
              />
            </ListPage>
          </section>
        </>
      )}
    </section>
  );
}

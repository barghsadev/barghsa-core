import { toast } from '../lib/toast-api.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { commercialFetch as fetch } from '../lib/commercial-fetch.js';
import {
  LoadingStatus,
  ListPage,
  ListRefreshButton,
  PageHeader,
  buttonVariants,
} from '@barghsa/ui';
import { Plus, UserRound } from 'lucide-react';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { RecordEditorActions } from '../components/RecordEditorLayout.js';
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
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';
import { readWithDeadline } from '../lib/server-query-client.js';
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
  FormTextarea,
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
import { tConsultationBrief } from '@barghsa/i18n/consultation-intake';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { withCsrf } from '../lib/csrf.js';
import { consultationNextAction } from '../lib/consultation-next-action.js';
import { uuidReference } from '../lib/form-receipt.js';
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

type ConsultationHistoryProps = {
  statuses?: readonly string[];
  onStatusesChange?: (statuses: string[]) => void;
  dateRange?: DateRangeFilterValue;
  onDateRangeChange?: (range: DateRangeFilterValue) => void;
  query?: HistoryQuery;
  onQueryChange?: (query: HistoryQuery) => void;
  onClearFilters?: () => void;
  onApplyFilters?: (selection: HistoryFilterSelection<HistoryQuery>) => void;
  onRemoveFilter?: (key: HistoryFilterKey, value?: string) => void;
};

export function ConsultationsPage(props: ConsultationHistoryProps = {}) {
  return <ConsultationWorkspace {...props} screen="history" />;
}

export function ConsultationIntakePage() {
  return <ConsultationWorkspace screen="intake" />;
}

function writeIntakeSession(key: string | null, value: string | null) {
  if (!key) return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // The form works in memory when storage is unavailable.
  }
}

function ConsultationWorkspace({
  screen,
  statuses = [],
  onStatusesChange,
  dateRange = {},
  onDateRangeChange,
  query = { q: '', sort: DEFAULT_HISTORY_SORT },
  onQueryChange,
  onClearFilters,
  onApplyFilters,
  onRemoveFilter,
}: ConsultationHistoryProps & { screen: 'intake' | 'history' }) {
  const isIntake = screen === 'intake';
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
  const briefCopy = (key: Parameters<typeof tConsultationBrief>[0]) =>
    tConsultationBrief(key, locale);
  const actorId = useAccountUser();
  const reader = useId();
  const client = useQueryClient();
  const readSequence = useRef(0);
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
  const offeringKey =
    isIntake && actorId && profile
      ? `barghsa.consultation-offering:${JSON.stringify([actorId, profile.id])}`
      : null;
  const pendingKey = offeringKey ? `${offeringKey}:submission` : null;
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
    brief: briefCopy('invalid'),
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
    { productId: intakeMessages.productId, brief: intakeMessages.brief },
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
  const [offeringChanged, setOfferingChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submissionKey = useRef<string | null>(null);
  const restoredOffering = useRef(false);
  const intakeTransport = useRef<AbortController | null>(null);
  const pendingIntake = useRef<{
    profileId: string;
    productId: string;
    submissionKey: string;
    brief: string | undefined;
  } | null>(null);
  const [intakeUnconfirmed, setIntakeUnconfirmed] = useState(false);
  const [briefRecovery, setBriefRecovery] = useState<'check' | 'reenter' | null>(null);
  useEffect(() => {
    ++generation.current;
    restoredOffering.current = false;
    intake.reset(emptyConsultationIntake);
    submissionKey.current = null;
    pendingIntake.current = null;
    setIntakeUnconfirmed(false);
    setBriefRecovery(null);
    setSubmitting(false);
    setSubmitError(false);
    setOfferingChanged(false);
    return () => intakeTransport.current?.abort();
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
  async function readOwned(key: ServerQueryKey, path: string, controller: AbortController) {
    if (controller.signal.aborted || !currentContext())
      throw new Error('Obsolete consultation read');
    const abort = () => void client.cancelQueries({ queryKey: key, exact: true });
    controller.signal.addEventListener('abort', abort, { once: true });
    try {
      return await client.fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: ({ signal }) =>
          readWithDeadline(signal, async (signal) => {
            const response = await fetch(path, { credentials: 'include', signal });
            return {
              ok: response.ok,
              status: response.status,
              value: response.ok ? ((await response.json()) as unknown) : null,
            };
          }),
      });
    } finally {
      controller.signal.removeEventListener('abort', abort);
    }
  }
  async function readProfile(controller: AbortController): Promise<SwitcherProfile | null> {
    const response = await readOwned(
      queryKeys.profiles.authority(
        {
          context: 'account',
          ownerId: actorId?.trim() ? actorId : reader,
          accountId: actorId,
          revision: contextRevision,
        },
        JSON.stringify([reader, identity, 'consultation-profile', ++readSequence.current])
      ),
      '/api/profiles',
      controller
    );
    if (controller.signal.aborted || !currentContext()) throw new Error('Obsolete profile read');
    if (!response.ok) throw new ConsultationReadError('profile', response.status);
    const data: unknown = response.value;
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
    if (!data.activeProfileId.trim()) throw new Error('Invalid active profile');
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
    if (!isIntake || !profile) return;
    ++catalogueRevision.current;
    catalogue.current.loading = true;
    const controller = new AbortController();
    setProductsLoading(true);
    setProductsError(false);
    setProductsDenied(false);
    void readOwned(
      queryKeys.catalogue.list(
        {
          context: 'customer',
          ownerId: profile.id,
          accountId: actorId,
          revision: contextRevision,
        },
        new URLSearchParams({ reader, endpoint: 'consultation-products', profileId: profile.id }),
        ++readSequence.current
      ),
      `/api/consultations/products?profileId=${encodeURIComponent(profile.id)}`,
      controller
    )
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.value as { products: Product[] };
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
          setOfferingChanged(false);
          writeIntakeSession(offeringKey, null);
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
  }, [isIntake, profile, productsRevision]);
  useEffect(() => {
    if (
      !offeringKey ||
      !pendingKey ||
      !profile ||
      productsScope !== scope ||
      productsLoading ||
      productsError ||
      productsDenied ||
      pendingIntake.current
    )
      return;
    const selected = intake.getValues('productId');
    if (selected) {
      if (products.some((product) => product.id === selected)) return;
      intake.reset({ ...emptyConsultationIntake, brief: intake.getValues('brief') });
      setOfferingChanged(true);
      writeIntakeSession(offeringKey, null);
      setSubmitError(false);
      submissionKey.current = null;
      return;
    }
    if (restoredOffering.current) return;
    restoredOffering.current = true;
    try {
      const pending = sessionStorage.getItem(pendingKey);
      if (pending) {
        const value = JSON.parse(pending) as {
          productId?: unknown;
          submissionKey?: unknown;
          hasBrief?: boolean;
        };
        const productId = uuidReference(value.productId);
        const key = uuidReference(value.submissionKey);
        pendingIntake.current = {
          profileId: profile.id,
          productId,
          submissionKey: key,
          brief: undefined,
        };
        submissionKey.current = key;
        intake.reset({ ...emptyConsultationIntake, productId, confirm: true });
        setBriefRecovery(value.hasBrief === true ? 'check' : null);
        setIntakeUnconfirmed(true);
        setSubmitError(true);
        return;
      }
      const saved = sessionStorage.getItem(offeringKey);
      if (saved) {
        if (products.some(({ id }) => id === saved)) {
          intake.setValue('productId', saved);
        } else {
          writeIntakeSession(offeringKey, null);
          setOfferingChanged(true);
        }
        return;
      }
    } catch {
      writeIntakeSession(pendingKey, null);
    }
    const [onlyService] = products;
    if (products.length === 1 && onlyService) intake.setValue('productId', onlyService.id);
  }, [
    offeringKey,
    pendingKey,
    profile,
    scope,
    productsScope,
    products,
    productsLoading,
    productsError,
    productsDenied,
  ]);

  useEffect(() => {
    if (isIntake || !profile) return;
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
      const response = await readOwned(
        queryKeys.consultations.list(
          {
            context: 'customer',
            ownerId: profile.id,
            accountId: actorId,
            revision: contextRevision,
          },
          new URLSearchParams([...queryParams, ['reader', reader]]),
          ++readSequence.current
        ),
        `/api/consultations/requests?${queryParams}`,
        controller
      );
      if (!fresh()) return;
      if (!response.ok) throw new ConsultationReadError('history', response.status);
      const result = response.value as {
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
  }, [isIntake, profile, before, requestRevision, historyScope, acceptPage, clear]);

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
        intake.getValues('brief') !== draft.brief ||
        intake.getValues('confirm') !== draft.confirm ||
        (!pendingIntake.current &&
          !catalogue.current.products.some((product) => product.id === draft.productId))
      )
        return;
      const checkingReceipt = briefRecovery === 'check';
      const body = {
        profileId: capturedProfile,
        productId: pendingIntake.current?.productId ?? draft.productId,
        submissionKey: (submissionKey.current ??= crypto.randomUUID()),
        brief:
          pendingIntake.current && briefRecovery !== 'reenter'
            ? pendingIntake.current.brief
            : draft.brief.trim() || undefined,
      };
      if (!checkingReceipt) {
        pendingIntake.current = body;
        setBriefRecovery(null);
        writeIntakeSession(
          pendingKey,
          JSON.stringify({
            productId: body.productId,
            submissionKey: body.submissionKey,
            hasBrief: body.brief ? true : undefined,
          })
        );
      }
      const transport = new AbortController();
      intakeTransport.current = transport;
      setSubmitting(true);
      setSubmitError(false);
      let completed = false;
      try {
        const { response, result } = await readWithDeadline(transport.signal, async (signal) => {
          const query = new URLSearchParams({
            profileId: body.profileId,
            productId: body.productId,
          });
          const response = checkingReceipt
            ? await fetch(
                `/api/consultations/requests/submissions/${body.submissionKey}?${query}`,
                {
                  credentials: 'include',
                  cache: 'no-store',
                  signal,
                }
              )
            : await fetch('/api/consultations/requests', {
                method: 'POST',
                credentials: 'include',
                headers: withCsrf({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(body),
                signal,
              });
          return { response, result: await response.json().catch(() => null) };
        });
        if (!currentContext() || capturedGeneration !== generation.current) return;
        if (!response.ok) {
          if (!checkingReceipt && response.status === 409) {
            writeIntakeSession(
              pendingKey,
              JSON.stringify({
                productId: body.productId,
                submissionKey: body.submissionKey,
                hasBrief: true,
              })
            );
            setBriefRecovery('check');
            throw new Error('receipt');
          }
          if (
            response.status === 400 &&
            result?.error?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
            Array.isArray(result.error.fields) &&
            !checkingReceipt &&
            intakeFields(result.error.fields)
          ) {
            pendingIntake.current = null;
            writeIntakeSession(pendingKey, null);
            setIntakeUnconfirmed(false);
            toast.error(copy('submitError'), { id: reader });
            return;
          }
          if ([401, 403, 404].includes(response.status)) {
            setProducts([]);
            setProductsDenied(true);
          }
          if (!checkingReceipt && definitiveConsultationRejection(response.status, result)) {
            pendingIntake.current = null;
            writeIntakeSession(pendingKey, null);
            setIntakeUnconfirmed(false);
            setSubmitError(true);
            toast.error(copy('submitError'), { id: reader });
            return;
          }
          throw new Error('submit');
        }
        const receipt = checkingReceipt ? result?.receipt : result;
        if (checkingReceipt && receipt === null) {
          setBriefRecovery('reenter');
          setSubmitError(false);
          return;
        }
        if (!consultationIntakeReceipt(receipt)) throw new Error('receipt');
        pendingIntake.current = null;
        setIntakeUnconfirmed(false);
        setBriefRecovery(null);
        writeIntakeSession(pendingKey, null);
        writeIntakeSession(offeringKey, null);
        completed = true;
        toast.success(confirmationText('recorded', locale), { id: reader });
        void navigate({
          to: '/consultations/$requestId',
          params: { requestId: receipt.requestId },
        });
      } catch {
        if (currentContext() && capturedGeneration === generation.current) {
          setSubmitError(true);
          setIntakeUnconfirmed(true);
          toast.error(copy('intakeUnconfirmed'), { id: reader });
        }
      } finally {
        if (intakeTransport.current === transport) intakeTransport.current = null;
        if (currentContext() && capturedGeneration === generation.current && !completed)
          setSubmitting(false);
      }
    })(event);
  }

  const profileName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.title || profile.id
    : '';

  const requestIdentity = (request: RequestRow) => (
    <Link
      to="/consultations/$requestId"
      params={{ requestId: request.id }}
      className="block min-w-0 space-y-1 rounded-sm text-start focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="block font-semibold text-primary hover:underline underline-offset-4">
        <bdi>{request.product_snapshot.title[locale]}</bdi>
      </span>
      <span className="block text-xs font-normal wrap-anywhere text-muted-foreground">
        <bdi>{request.id}</bdi>
      </span>
      <time
        className="block text-xs font-normal text-muted-foreground"
        dateTime={request.submitted_at}
      >
        {time.format(request.submitted_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}
      </time>
    </Link>
  );
  const status = (request: RequestRow) => (
    <StatusBadge label={copy(`status_${request.status}`)} tone={statusFilterTone(request.status)} />
  );
  const owner = (request: RequestRow) => (
    <div className="min-w-0 space-y-1 text-sm">
      <p dir="auto" className="wrap-anywhere">
        {request.staff_owner_username ??
          (request.staff_owner_id
            ? copy('assignedStaff')
            : request.staff_team
              ? copy('awaitingOwner')
              : copy('unassigned'))}
      </p>
      {request.staff_team && (
        <p className="text-xs text-muted-foreground">
          {copy('team')}: <bdi>{request.staff_team}</bdi>
        </p>
      )}
    </div>
  );
  const nextStep = (request: RequestRow) => {
    const action = consultationNextAction(request, request.refund_pending, locale);
    const invoiceAction = request.invoice_id && action.href?.startsWith('/invoices/');
    const href = action.href?.startsWith('#')
      ? `/consultations/${encodeURIComponent(request.id)}${action.href}`
      : action.href;
    const linkClass = 'touch-action font-medium text-primary hover:underline underline-offset-4';
    return (
      <div className="min-w-32 space-y-1 text-start">
        {href && !invoiceAction ? (
          <a href={href} className={linkClass}>
            {action.text}
          </a>
        ) : (
          <p className="text-muted-foreground">{action.text}</p>
        )}
        {request.invoice_id && invoiceAction && (
          <Link
            to="/invoices/$invoiceId"
            params={{ invoiceId: request.invoice_id }}
            className={linkClass}
          >
            {copy('viewInvoice')}
          </Link>
        )}
      </div>
    );
  };
  const columns: (HistoryColumn<RequestRow> & { label: string })[] = [
    { id: 'subject', label: t('historyView.subject', locale), render: requestIdentity },
    { id: 'status', label: copy('status'), render: status },
    { id: 'owner', label: copy('owner'), render: owner },
    { id: 'action', actions: true, label: copy('nextStep'), render: nextStep },
  ];
  const showIntakeDetails = !productsDenied && (products.length > 0 || !!pendingIntake.current);
  const onlyServiceSelected = products.length === 1 && products[0]?.id === selectedProductId;
  return (
    <section
      className={`mx-auto w-full min-w-0 ${isIntake ? 'max-w-3xl space-y-4' : 'max-w-5xl space-y-4'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {isIntake ? (
        <header className="space-y-1">
          <Link
            to="/consultations"
            className="touch-action w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {copy('myRequests')}
          </Link>
          <h1 className="text-2xl font-semibold sm:text-3xl">{copy('newRequest')}</h1>
          <p className="text-sm text-muted-foreground">{briefCopy('afterSubmission')}</p>
        </header>
      ) : (
        <PageHeader
          title={copy('title')}
          {...(profileName ? { description: profileName } : {})}
          actions={
            !loading && !loadError && profile ? (
              <Link to="/consultations/new" className={buttonVariants()}>
                <Plus aria-hidden="true" data-icon="inline-start" />
                {copy('newRequest')}
              </Link>
            ) : null
          }
        />
      )}
      {time.notice}
      {loading && <LoadingStatus>{copy('loading')}</LoadingStatus>}
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
          {isIntake && (
            <Form {...intake}>
              <div role="group" aria-label={copy('intakeForm')}>
                <form onSubmit={submit} noValidate className="min-w-0 rounded-xl border bg-card">
                  <div
                    className={`grid min-w-0 ${showIntakeDetails ? 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]' : ''}`}
                  >
                    <div className="min-w-0 space-y-3 p-3 sm:p-4">
                      {intake.formState.errors.root && (
                        <Alert variant="destructive">
                          <AlertDescription>{copy('validationUnavailable')}</AlertDescription>
                        </Alert>
                      )}
                      <FormField
                        control={intake.control}
                        name="productId"
                        render={({ field, fieldState }) => (
                          <FormItem id="consultation-product">
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <h2
                                id="consultation-product-label"
                                className="text-base font-semibold"
                              >
                                {copy('available')}
                              </h2>
                              <ListRefreshButton
                                label={copy('refreshProducts')}
                                disabled={productsLoading || intake.formState.isSubmitting}
                                onClick={refreshProducts}
                              />
                            </div>
                            <FormDescription>
                              {onlyServiceSelected
                                ? briefCopy('singleService')
                                : copy('productHelp')}
                            </FormDescription>
                            <FormControl>
                              <div
                                role="radiogroup"
                                aria-labelledby="consultation-product-label"
                                aria-required="true"
                                onBlur={field.onBlur}
                              >
                                <ListPage>
                                  <ListPage.Content
                                    loading={productsLoading}
                                    error={productsError || productsDenied}
                                    empty={!products.length}
                                    retainContent={!!products.length && !productsDenied}
                                    loadingView={<LoadingStatus>{copy('loading')}</LoadingStatus>}
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
                                      <p className="text-muted-foreground">
                                        {copy('emptyProducts')}
                                      </p>
                                    }
                                  >
                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                                      {products.map((product, index) => (
                                        <label
                                          key={product.id}
                                          className={`flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors hover:border-primary ${selectedProductId === product.id ? 'border-primary bg-primary/5' : 'bg-card'}`}
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
                                            aria-describedby={[
                                              'consultation-product-description',
                                              fieldState.error && 'consultation-product-message',
                                              offeringChanged && 'consultation-offering-changed',
                                            ]
                                              .filter(Boolean)
                                              .join(' ')}
                                            onChange={() => {
                                              field.onChange(product.id);
                                              setOfferingChanged(false);
                                              writeIntakeSession(offeringKey, product.id);
                                              submissionKey.current = null;
                                              setSubmitError(false);
                                            }}
                                            className="mt-1 size-4 shrink-0 accent-primary"
                                          />
                                          <span className="min-w-0 space-y-0.5">
                                            <span className="block text-sm font-medium" dir="auto">
                                              {product.title[locale]}
                                            </span>
                                            {product.description?.[locale] && (
                                              <span
                                                className="block text-xs text-muted-foreground"
                                                dir="auto"
                                              >
                                                {product.description[locale]}
                                              </span>
                                            )}
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                  </ListPage.Content>
                                </ListPage>
                              </div>
                            </FormControl>
                            {offeringChanged && products.length > 0 && (
                              <p
                                id="consultation-offering-changed"
                                role="alert"
                                className="text-sm"
                              >
                                {briefCopy('serviceRemoved')}
                              </p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    {showIntakeDetails && (
                      <div className="min-w-0 space-y-3 border-t p-3 sm:p-4 lg:border-s lg:border-t-0">
                        {briefRecovery === 'reenter' && (
                          <Alert>
                            <AlertDescription>{briefCopy('reenter')}</AlertDescription>
                          </Alert>
                        )}
                        {briefRecovery !== 'check' && (
                          <FormTextarea
                            control={intake.control}
                            name="brief"
                            label={briefCopy('label')}
                            description={briefCopy('help')}
                            reserveMessageSpace={false}
                            inputProps={{
                              dir: 'auto',
                              rows: 1,
                              maxLength: 2000,
                              placeholder: briefCopy('example'),
                              className: 'min-h-14 resize-y placeholder:text-sm',
                            }}
                            disabled={
                              submitting ||
                              intake.formState.isSubmitting ||
                              (intakeUnconfirmed && briefRecovery !== 'reenter')
                            }
                          />
                        )}
                        <FormField
                          control={intake.control}
                          name="confirm"
                          render={({ field }) => (
                            <FormItem
                              id="consultation-confirmation"
                              className="rounded-lg bg-muted/45 px-3 py-2"
                            >
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                <UserRound aria-hidden="true" className="size-4 shrink-0" />
                                <span>{copy('profile')}</span>
                                <bdi className="text-sm font-medium text-foreground wrap-anywhere">
                                  {profileName}
                                </bdi>
                              </div>
                              <FormLabel className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                                <FormControl>
                                  <input
                                    type="checkbox"
                                    aria-required="true"
                                    ref={field.ref}
                                    name={field.name}
                                    checked={field.value}
                                    onChange={(event) => field.onChange(event.target.checked)}
                                    onBlur={field.onBlur}
                                    disabled={
                                      submitting ||
                                      intake.formState.isSubmitting ||
                                      intakeUnconfirmed
                                    }
                                    className="size-4 shrink-0 accent-primary"
                                  />
                                </FormControl>
                                <span>{copy('confirm')}</span>
                              </FormLabel>
                              <FormDescription className="sr-only">
                                {copy('confirmationHelp')}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {submitError && (
                          <Alert variant="destructive">
                            <AlertDescription>
                              {briefRecovery === 'check'
                                ? briefCopy('checkHelp')
                                : copy(intakeUnconfirmed ? 'intakeUnconfirmed' : 'submitError')}
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    )}
                  </div>
                  {showIntakeDetails && (
                    <RecordEditorActions className="rounded-b-xl bg-card px-3 py-2 max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-sm:[&>div]:w-full sm:px-4">
                      <Button
                        type="submit"
                        className="min-h-11 max-sm:w-full"
                        loading={intake.formState.isSubmitting || submitting}
                        disabled={
                          productsLoading ||
                          productsError ||
                          productsDenied ||
                          submitting ||
                          intake.formState.isSubmitting
                        }
                      >
                        {briefRecovery === 'check' ? briefCopy('check') : copy('request')}
                      </Button>
                    </RecordEditorActions>
                  )}
                </form>
              </div>
            </Form>
          )}

          {!isIntake && (
            <section className="space-y-3" aria-labelledby="consultation-requests-title">
              <h2 id="consultation-requests-title" tabIndex={-1} className="sr-only">
                {copy('myRequests')}
              </h2>
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
                  loadingView={
                    requests.length ? (
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
                    <ul className="grid gap-3">
                      {requests.map((request) => (
                        <li
                          key={request.id}
                          className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
                        >
                          {requestIdentity(request)}
                          {status(request)}
                          <dl className="text-sm">
                            <div>
                              <dt className="text-xs text-muted-foreground">{copy('owner')}</dt>
                              <dd>{owner(request)}</dd>
                            </div>
                          </dl>
                          <div className="border-t pt-3 text-sm">{nextStep(request)}</div>
                        </li>
                      ))}
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
          )}
        </>
      )}
    </section>
  );
}

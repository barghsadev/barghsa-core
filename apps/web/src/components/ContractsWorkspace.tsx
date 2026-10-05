import { HistoryTable, type HistoryColumn } from './HistoryTable.js';
import { useListView } from '../hooks/useListView.js';
import { ContractRefundQueue } from './ContractRefundQueue.js';
import { ContractCancellationRequestQueue } from './ContractCancellationRequestQueue.js';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
  type SyntheticEvent,
} from 'react';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  AlertDescription,
  Button,
  EmptyState,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  NativeSelect,
  PageHeader,
  PageLoading,
  StatusBadge,
  ListViewToggle,
  ListPage,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import { contractBase, contractStates, type ContractSummary } from '../lib/contracts.js';
import { ContractActivationRules } from './ContractActivationRules.js';
import { ContractDetailLoader } from './ContractDetailLoader.js';
import { ContractDraftEditor } from './ContractDraftEditor.js';
import { ContractCommercialValueText } from './ContractCommercialValueText.js';
import {
  CustomerContractFilters,
  type CustomerContractHistoryControls,
} from './CustomerContractFilters.js';
import { DEFAULT_CONTRACT_LIST_SORT } from '@barghsa/shared/validation';
import { useCursorHistory } from '../hooks/useCursorHistory.js';
import { useCursorPageRows } from '../hooks/useCursorPageRows.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import type { ContractFormCoordination } from '../lib/contract-review-signature-form.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import type { RecordListQuery } from '../lib/record-list-query.js';

export function ContractsWorkspace({
  staff = false,
  initialState,
  customerHistory,
  selection,
  queries,
}: {
  staff?: boolean;
  initialState?: 'Active' | undefined;
  customerHistory?: CustomerContractHistoryControls | undefined;
  selection?: Pick<RecordListQuery, 'selected' | 'select'> | undefined;
  queries?: RecordListQuery | undefined;
}) {
  const revision = useProfileContextRevision();
  const actor = useAccountUser();
  return (
    <Workspace
      key={`${staff}:${revision}:${actor}`}
      staff={staff}
      initialState={initialState}
      customerHistory={customerHistory}
      selection={selection}
      queries={queries}
    />
  );
}
function Workspace({
  staff,
  initialState,
  customerHistory,
  selection,
  queries,
}: {
  staff: boolean;
  initialState?: 'Active' | undefined;
  customerHistory?: CustomerContractHistoryControls | undefined;
  selection?: Pick<RecordListQuery, 'selected' | 'select'> | undefined;
  queries?: RecordListQuery | undefined;
}) {
  const owner = useRef<object | null>(null),
    [locked, setLocked] = useState(false);
  const readAbort = useRef<AbortController | null>(null),
    readEpoch = useRef(0);
  const coordination = useRef<ContractFormCoordination>({
    blocked: () => !!owner.current,
    revision: () => readEpoch.current,
    acquire: (claim) => {
      if (owner.current) return false;
      owner.current = claim;
      setLocked(true);
      ++readEpoch.current;
      readAbort.current?.abort();
      return true;
    },
    release: (claim) => {
      if (owner.current === claim) {
        owner.current = null;
        setLocked(false);
      }
    },
  }).current;
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const routeFilters = {
    contractNumber: queries?.queue.query.filters.contractNumber || '',
    profileId: queries?.queue.query.filters.profileId || '',
    state: queries?.queue.query.filters.state || '',
    serviceType: queries?.queue.query.filters.serviceType || '',
  };
  const basis = JSON.stringify(routeFilters);
  const [filters, setFilters] = useState(routeFilters);
  const [localQuery, setQuery] = useState(initialState ? 'state=Active' : '');
  const query = queries
    ? new URLSearchParams(Object.entries(routeFilters).filter(([, value]) => value)).toString()
    : localQuery;
  useEffect(() => {
    if (!queries) return;
    setFilters(routeFilters);
    setInvalid(false);
    setInvalidNumber(false);
  }, [basis]);
  const [generation, setGeneration] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [invalidNumber, setInvalidNumber] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const customerParams = new URLSearchParams();
  if (initialState) customerParams.set('state', initialState);
  if (customerHistory) {
    if (customerHistory.query.q) customerParams.set('q', customerHistory.query.q);
    if (customerHistory.query.serviceType)
      customerParams.set('serviceType', customerHistory.query.serviceType);
    if (customerHistory.query.sort !== DEFAULT_CONTRACT_LIST_SORT)
      customerParams.set('sort', customerHistory.query.sort);
    if (customerHistory.statuses.length)
      customerParams.set('statuses', customerHistory.statuses.join(','));
    if (customerHistory.dateRange.from) customerParams.set('from', customerHistory.dateRange.from);
    if (customerHistory.dateRange.to) customerParams.set('to', customerHistory.dateRange.to);
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    if (coordination.blocked()) return;
    if (
      filters.profileId &&
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(filters.profileId)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (
      filters.contractNumber &&
      (!/^[1-9][0-9]{0,18}$/.test(filters.contractNumber) ||
        BigInt(filters.contractNumber) > 9_223_372_036_854_775_807n)
    ) {
      setInvalidNumber(true);
      return;
    }
    setInvalidNumber(false);
    setCreatedId(null);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    if (queries) {
      queries.apply('', filters);
      if (JSON.stringify(filters) === basis) setGeneration((value) => value + 1);
    } else {
      setQuery(params.toString());
      setGeneration((value) => value + 1);
    }
  }
  function blockCompanion(event: SyntheticEvent) {
    if (coordination.blocked()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <PageHeader
        title={word(staff ? 'staffTitle' : 'title')}
        description={word(staff ? 'staffDescription' : 'description')}
      />
      {!staff ? (
        <nav className="flex gap-4 text-sm" aria-label={word('title')}>
          <Link
            onClick={(event) => {
              if (coordination.blocked()) event.preventDefault();
            }}
            aria-disabled={locked}
            to="/contracts"
            search={{ state: undefined }}
            className="text-primary underline underline-offset-4"
            aria-current={initialState ? undefined : 'page'}
          >
            {word('all')}
          </Link>
          <Link
            onClick={(event) => {
              if (coordination.blocked()) event.preventDefault();
            }}
            aria-disabled={locked}
            to="/contracts"
            search={{ state: 'Active' }}
            className="text-primary underline underline-offset-4"
            aria-current={initialState ? 'page' : undefined}
          >
            {word('Active')}
          </Link>
        </nav>
      ) : null}
      {staff ? (
        <form onSubmit={apply} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <fieldset disabled={locked} className="contents">
            <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="contracts-number">{word('contractNumber')}</FieldLabel>
                <Input
                  id="contracts-number"
                  dir="ltr"
                  inputMode="numeric"
                  value={filters.contractNumber}
                  onChange={(e) =>
                    setFilters({ ...filters, contractNumber: e.target.value.trim() })
                  }
                  aria-invalid={invalidNumber}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="contracts-profile">{word('profile')}</FieldLabel>
                <Input
                  id="contracts-profile"
                  dir="ltr"
                  value={filters.profileId}
                  onChange={(e) => setFilters({ ...filters, profileId: e.target.value.trim() })}
                  aria-invalid={invalid}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="contracts-state">{word('state')}</FieldLabel>
                <NativeSelect
                  id="contracts-state"
                  value={filters.state}
                  onChange={(e) => setFilters({ ...filters, state: e.target.value })}
                >
                  <option value="">{word('all')}</option>
                  {contractStates.map((state) => (
                    <option key={state} value={state}>
                      {word(state)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="contracts-service">{word('serviceType')}</FieldLabel>
                <NativeSelect
                  id="contracts-service"
                  value={filters.serviceType}
                  onChange={(e) => setFilters({ ...filters, serviceType: e.target.value })}
                >
                  <option value="">{word('all')}</option>
                  {['electricity', 'savings', 'solar'].map((type) => (
                    <option key={type} value={type}>
                      {word(type)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </FieldGroup>
          </fieldset>
          {invalid ? <p role="alert">{word('invalidProfile')}</p> : null}
          {invalidNumber ? <p role="alert">{word('invalidContractNumber')}</p> : null}
          <Button type="submit" className="self-start" disabled={locked}>
            {word('apply')}
          </Button>
        </form>
      ) : null}
      {staff ? (
        <ContractDraftEditor
          coordination={coordination}
          onSaved={(id) => {
            if (coordination.blocked()) return;
            if (queries) queries.select(id, { resetCursor: true });
            else setCreatedId(id);
            setGeneration((value) => value + 1);
          }}
        />
      ) : null}
      {staff ? (
        <fieldset
          disabled={locked}
          className="contents"
          onClickCapture={blockCompanion}
          onSubmitCapture={blockCompanion}
        >
          <ContractRefundQueue />
          <ContractCancellationRequestQueue />
          <ContractActivationRules />
        </fieldset>
      ) : null}
      <ContractResults
        key={generation}
        staff={staff}
        query={staff ? query : customerParams.toString()}
        customerHistory={customerHistory}
        selection={selection}
        queries={queries}
        initialSelected={createdId ?? new URLSearchParams(window.location.search).get('contractId')}
        coordination={coordination}
        locked={locked}
        readAbort={readAbort}
        readEpoch={readEpoch}
      />
    </div>
  );
}
function ContractResults({
  staff,
  customerHistory,
  query,
  initialSelected,
  selection,
  queries,
  coordination,
  locked,
  readAbort,
  readEpoch,
}: {
  staff: boolean;
  query: string;
  customerHistory?: CustomerContractHistoryControls | undefined;
  selection?: Pick<RecordListQuery, 'selected' | 'select'> | undefined;
  initialSelected: string | null;
  coordination: ContractFormCoordination;
  locked: boolean;
  readAbort: MutableRefObject<AbortController | null>;
  readEpoch: MutableRefObject<number>;
  queries?: RecordListQuery | undefined;
}) {
  const { view, setView } = useListView('contracts');
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => contractText(key, locale);
  const [reload, setReload] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const legacy = useCursorHistory<ContractSummary>(`${staff}:${query}:${reload}`);
  const cursor = queries ? queries.queue.query.cursor : legacy.before;
  const urlRows = useCursorPageRows<ContractSummary>(`${staff}:${query}`, cursor || '');
  const [denied, setDenied] = useState(false);
  const items = denied ? [] : queries ? urlRows.rows : legacy.items;
  const next = denied ? null : queries ? urlRows.next : legacy.nextBefore;
  const acceptPage = queries ? urlRows.acceptPage : legacy.acceptPage;
  const loadMore = () => {
    if (coordination.blocked() || !next) return;
    if (queries) queries.queue.next(next);
    else legacy.loadMore();
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [localSelected, setLocalSelected] = useState<string | null>(initialSelected);
  const queryRef = useRef(queries);
  queryRef.current = queries;
  const selectionQuery = queries ?? selection;
  const selectionRef = useRef(selectionQuery);
  selectionRef.current = selectionQuery;
  const offeredSelection = denied ? null : selectionQuery ? selectionQuery.selected : localSelected;
  const acceptedSelection = useRef(offeredSelection);
  if (!coordination.blocked()) acceptedSelection.current = offeredSelection;
  const selected = acceptedSelection.current;
  const setSelected = (id: string | null, replace = false) => {
    if (coordination.blocked()) return;
    if (selectionRef.current) selectionRef.current.select(id, { replace });
    else setLocalSelected(id);
  };
  useEffect(() => {
    if (coordination.blocked()) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    readAbort.current = controller;
    const epoch = ++readEpoch.current;
    const fresh = () =>
      !controller.signal.aborted && epoch === readEpoch.current && !coordination.blocked();
    const params = new URLSearchParams(query);
    if (cursor) params.set('before', cursor);
    setLoading(true);
    setError(false);
    void documentRequest<{ contracts: ContractSummary[]; nextBefore: string | null }>(
      `${contractBase(staff)}?${params}`,
      { signal: controller.signal }
    )
      .then((page) => {
        if (!fresh()) return;
        setDenied(false);
        acceptPage(
          page.contracts,
          queries ? staffOrderId(page.nextBefore) || null : page.nextBefore
        );
      })
      .catch((reason: unknown) => {
        if (!fresh()) return;
        setError(true);
        if (reason instanceof DocumentRequestError && [401, 403].includes(reason.status)) {
          setDenied(true);
          urlRows.discard();
          setSelected(null, true);
        }
      })
      .finally(() => {
        if (fresh()) setLoading(false);
      });
    return () => controller.abort();
  }, [staff, query, cursor, reload, retryRevision, acceptPage, locked]);
  function refresh() {
    if (coordination.blocked()) return;
    if (queryRef.current) queryRef.current.queue.setQuery({ cursor: '' });
    setReload((value) => value + 1);
  }
  const renderIdentity = (item: ContractSummary) => (
    <>
      <Button variant="link" disabled={locked} onClick={() => setSelected(item.id)}>
        {word(item.serviceType)} · {word('version')} {item.versionNumber.toLocaleString(locale)}
      </Button>
      <p className="text-sm text-muted-foreground">
        {word(item.contractNumber ? 'contractNumber' : 'contractReference')}:{' '}
        <bdi dir="ltr" className="break-all">
          {item.contractNumber ?? item.id}
        </bdi>
      </p>
    </>
  );
  const renderParty = (item: ContractSummary) => (
    <>
      {item.profileType ? (
        <p className="text-sm text-muted-foreground">
          {word(item.acceptedParty ? 'acceptedParty' : 'account')}:{' '}
          {(item.acceptedParty ? item.acceptedParty.name : item.profileTitle) ||
            word('draftUnnamedProfile')}{' '}
          ·{' '}
          {word(
            (item.acceptedParty?.profileType ?? item.profileType) === 'LEGAL'
              ? 'draftLegal'
              : 'draftIndividual'
          )}
        </p>
      ) : null}
    </>
  );
  const renderLinked = (item: ContractSummary) => (
    <>
      {item.serviceType === 'electricity' && item.linkedOrderStatus ? (
        <p className="text-sm text-muted-foreground">
          {word('linkedOrderStatus')}:{' '}
          {appText(`electricity.order.status.${item.linkedOrderStatus}`, locale)}
        </p>
      ) : null}
    </>
  );
  const renderValue = (item: ContractSummary) => (
    <>
      {item.commercialValue ? (
        <p className="text-sm text-muted-foreground">
          {word('statedContractValue')}:{' '}
          <ContractCommercialValueText value={item.commercialValue} />
        </p>
      ) : null}
    </>
  );
  const renderHistory = (item: ContractSummary) => (
    <>
      {item.changeDescription ? (
        <p className="text-sm text-muted-foreground">{item.changeDescription}</p>
      ) : null}
      {!staff && item.publishedAt ? (
        <p className="text-sm text-muted-foreground">
          {word('publishedAt')}: {time.format(item.publishedAt)}
        </p>
      ) : null}
      {!staff && item.acceptedAt ? (
        <p className="text-sm text-muted-foreground">
          {word('acceptedAt')}: {time.format(item.acceptedAt)}
        </p>
      ) : null}
    </>
  );
  const renderActivity = (item: ContractSummary) => (
    <>
      {item.initialInvoiceId ? (
        <p className="text-sm text-muted-foreground">
          {item.initialInvoiceAmount !== null && item.initialInvoiceAmount !== undefined
            ? `${word('initialInvoiceAmount')}: ${numbers.money(item.initialInvoiceAmount)}`
            : word('initialInvoiceLinked')}
          {item.initialInvoiceState
            ? ` · ${appText(`invoices.state.${item.initialInvoiceState}`, locale)}`
            : ''}
          {staff ? (
            <>
              {' · '}
              <a
                href={`/admin/invoices?invoiceId=${encodeURIComponent(item.initialInvoiceId)}`}
                className="text-primary underline underline-offset-4"
              >
                {word('openInitialInvoice')}
              </a>
            </>
          ) : (
            <>
              {' · '}
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: item.initialInvoiceId }}
                className="text-primary underline underline-offset-4"
              >
                {word('openInitialInvoice')}
              </Link>
            </>
          )}
        </p>
      ) : null}
      {!staff && item.serviceType === 'electricity' && item.orderId ? (
        <Link
          to="/electricity/orders/$orderId"
          params={{ orderId: item.orderId }}
          className="text-sm text-primary underline underline-offset-4"
        >
          {word('openLinkedOrder')}
        </Link>
      ) : null}
      {staff && item.serviceType === 'electricity' && item.orderId ? (
        <a
          href={`/admin/electricity-orders?orderId=${encodeURIComponent(item.orderId)}`}
          className="text-sm text-primary underline underline-offset-4"
        >
          {word('openLinkedOrder')}
        </a>
      ) : null}
      {!staff && item.serviceType === 'savings' && item.savingOrderId ? (
        <Link
          to="/savings/orders/$orderId"
          params={{ orderId: item.savingOrderId }}
          className="text-sm text-primary underline underline-offset-4"
        >
          {word('openLinkedSavingOrder')}
        </Link>
      ) : null}
      {staff && item.serviceType === 'electricity' ? (
        <a
          className="text-sm text-primary underline"
          href={`/admin/electricity-price-adjustments?contractId=${encodeURIComponent(item.id)}`}
        >
          {adminText('admin.electricityPrice.title', locale)}
        </a>
      ) : null}
    </>
  );
  const renderStatus = (item: ContractSummary) => (
    <>
      <div className="flex flex-wrap gap-2">
        <StatusBadge label={word(item.state)} />
        {item.pendingAmendmentState ? (
          <StatusBadge
            label={
              item.pendingAmendmentState === 'Draft'
                ? `${word('amendmentPending')} · ${word('Draft')}`
                : item.pendingAmendmentState === 'AwaitingCustomerAcceptance'
                  ? staff
                    ? `${word('amendmentPending')} · ${word('AwaitingCustomerAcceptance')}`
                    : word('amendmentAwaitingAcceptance')
                  : word('amendmentAwaitingSignature')
            }
          />
        ) : null}
      </div>
    </>
  );
  const renderStarts = (item: ContractSummary) => (
    <>
      {item.serviceStartsAt ? (
        <p className="text-sm text-muted-foreground">
          {word('serviceStartsAt')}: {time.format(item.serviceStartsAt)}
        </p>
      ) : null}
    </>
  );
  const renderEnds = (item: ContractSummary) => (
    <>
      {item.serviceEndsAt ? (
        <p className="text-sm text-muted-foreground">
          {word('serviceEndsAt')}: {time.format(item.serviceEndsAt)}
        </p>
      ) : null}
    </>
  );
  const columns: HistoryColumn<ContractSummary>[] = [
    {
      id: 'reference',
      label: word('contractNumber'),
      render: (item) => <div className="min-w-48">{renderIdentity(item)}</div>,
    },
    { id: 'type', label: word('serviceType'), render: (item) => word(item.serviceType) },
    { id: 'state', label: word('state'), render: renderStatus },
    {
      id: 'party',
      label: word('acceptedParty'),
      render: (item) => (item.profileType ? renderParty(item) : '—'),
    },
    {
      id: 'starts',
      label: word('serviceStartsAt'),
      render: (item) => (item.serviceStartsAt ? time.format(item.serviceStartsAt) : '—'),
    },
    {
      id: 'ends',
      label: word('serviceEndsAt'),
      render: (item) => (item.serviceEndsAt ? time.format(item.serviceEndsAt) : '—'),
    },
    {
      id: 'value',
      label: word('statedContractValue'),
      render: (item) =>
        item.commercialValue ? <ContractCommercialValueText value={item.commercialValue} /> : '—',
    },
    {
      id: 'activity',
      label: appText('historyView.activity', locale),
      render: (item) => (
        <div className="min-w-52 space-y-2">
          {renderLinked(item)}
          {renderHistory(item)}
          {renderActivity(item)}
        </div>
      ),
    },
  ];
  return (
    <ListPage role="region" aria-label={word(staff ? 'staffTitle' : 'title')}>
      {!staff && time.notice}
      <ListPage.Toolbar
        filters={
          !staff && customerHistory ? (
            <fieldset
              disabled={locked}
              onChangeCapture={(event) => {
                if (coordination.blocked()) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onSubmitCapture={(event) => {
                if (coordination.blocked()) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
            >
              <CustomerContractFilters history={customerHistory} />
            </fieldset>
          ) : undefined
        }
        actions={
          <>
            {!staff && (
              <ListViewToggle
                value={view}
                onChange={setView}
                labels={{
                  group: appText('historyView.group', locale),
                  table: appText('historyView.table', locale),
                  card: appText('historyView.card', locale),
                }}
              />
            )}
            <Button
              className="self-start"
              variant="outline"
              onClick={refresh}
              disabled={loading || locked}
            >
              {word('refresh')}
            </Button>
          </>
        }
      />
      {selected ? (
        <ContractDetailLoader
          key={selected}
          id={selected}
          staff={staff}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          refreshRevision={reload}
          coordination={coordination}
          onWithdrawal={() => setSelected(null, true)}
        />
      ) : null}
      <ListPage.Content
        loading={loading}
        error={error}
        empty={items.length === 0}
        retainContent={items.length > 0}
        loadingView={<PageLoading label={word('loading')} />}
        errorView={
          <div className="space-y-2">
            <Alert variant="destructive">
              <AlertDescription>{word(denied ? 'denied' : 'error')}</AlertDescription>
            </Alert>
            {!denied && (
              <Button variant="outline" onClick={() => setRetryRevision((value) => value + 1)}>
                {appText('historyPagination.retry', locale)}
              </Button>
            )}
          </div>
        }
        emptyView={<EmptyState title={word('empty')} description={word('emptyHint')} />}
      >
        {items.length ? (
          !staff && view === 'table' ? (
            <HistoryTable
              caption={word('title')}
              items={items}
              columns={columns}
              rowKey={(item) => item.id}
            />
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    {renderIdentity(item)}
                    {renderParty(item)}
                    {renderLinked(item)}
                    {renderValue(item)}
                    {renderHistory(item)}
                    {renderStarts(item)}
                    {renderEnds(item)}
                    {renderActivity(item)}
                  </div>
                  {renderStatus(item)}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </ListPage.Content>
      <ListPage.Pagination
        kind="cursor"
        hasMore={
          !locked &&
          !!next &&
          !error &&
          !denied &&
          (loading || (queries ? queries.queue.canAdvance(next) : true))
        }
        loading={loading}
        onNext={loadMore}
        previous={{
          enabled: !locked && !denied && (queries?.queue.hasPrevious ?? false),
          onClick: () => {
            if (!coordination.blocked()) queries?.queue.previous();
          },
          label: appText('historyPagination.previous', locale),
        }}
        label={appText('historyPagination.label', locale)}
        nextLabel={word('next')}
      />
    </ListPage>
  );
}

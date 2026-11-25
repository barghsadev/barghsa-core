import { validDocumentRow } from '../lib/document-records.js';
import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import {
  documentIdPattern,
  useCustomerDocumentProfile,
} from '../hooks/useCustomerDocumentProfile.js';
import { Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  EmptyState,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  ListPage,
  ListRefreshButton,
  ListSearchInput,
  NativeSelect,
  PageHeader,
  PageLoading,
  ListViewToggle,
  buttonVariants,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { t as appText } from '@barghsa/i18n/workspace';
import { useCursorPageRows } from '../hooks/useCursorPageRows.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import type { RecordListQuery } from '../lib/record-list-query.js';
import { useLocale } from '../hooks/useLocale.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { DocumentList } from './DocumentRecords.js';
import { DocumentStatusBadge } from './DocumentStatusBadge.js';
import {
  relatedDocumentLocation,
  relatedDocumentMatches,
  type RelatedDocumentLinks,
} from '../lib/related-document-route.js';
import { useListView } from '../hooks/useListView.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { QueueEmptyState } from './QueueEmptyState.js';
import {
  DocumentUpload,
  type OrderDocumentAssociation,
  type SolarDocumentAssociation,
} from './DocumentUpload.js';
import {
  documentBase,
  DocumentRequestError,
  documentKinds,
  documentStates,
  type BusinessDocument,
  type DocumentKind,
  type DocumentPage,
} from '../lib/documents.js';

const DocumentDetail = lazy(() =>
  import('./DocumentDetail.js').then(({ DocumentDetail }) => ({ default: DocumentDetail }))
);

export interface DocumentFilters {
  contractVersionId?: string;
  kind: DocumentKind;
  state: string;
  category: string;
  query: string;
  profileId: string;
  businessRecordId: string;
}
export function DocumentsWorkspace({
  staff = false,
  queries,
  recordSearch,
}: {
  staff?: boolean;
  queries?: RecordListQuery | undefined;
  recordSearch?: Record<string, unknown> | undefined;
}) {
  const revision = useProfileContextRevision();
  const actor = useAccountUser();
  return (
    <Workspace
      key={JSON.stringify([staff, revision, actor])}
      staff={staff}
      queries={queries}
      recordSearch={recordSearch}
    />
  );
}
function Workspace({
  staff,
  queries,
  recordSearch,
}: {
  staff: boolean;
  queries?: RecordListQuery | undefined;
  recordSearch?: Record<string, unknown> | undefined;
}) {
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const {
    id: activeProfile,
    state: profileState,
    retry: retryProfile,
  } = useCustomerDocumentProfile(!staff);
  const routeFilters: DocumentFilters = {
    kind: (queries?.queue.query.filters.kind || 'standalone') as DocumentKind,
    state: queries
      ? queries.queue.query.filters.state === 'all'
        ? ''
        : queries.queue.query.filters.state || ''
      : staff
        ? 'SubmittedForReview'
        : '',
    category: queries?.queue.query.filters.category || '',
    query: queries?.queue.query.search || '',
    profileId: staff ? queries?.queue.query.filters.profileId || '' : '',
    businessRecordId: queries?.queue.query.filters.businessRecordId || '',
  };
  const basis = JSON.stringify(routeFilters);
  const [filters, setFilters] = useState<DocumentFilters>(routeFilters);
  const [localApplied, setApplied] = useState(filters);
  const applied = queries ? routeFilters : localApplied;
  useEffect(() => {
    if (!queries) return;
    setFilters(routeFilters);
    setInvalid(false);
  }, [basis]);
  const [invalid, setInvalid] = useState(false);
  const [generation, setGeneration] = useState(0);
  function apply(event: FormEvent) {
    event.preventDefault();
    if (
      (filters.profileId && !documentIdPattern.test(filters.profileId)) ||
      (filters.businessRecordId && !documentIdPattern.test(filters.businessRecordId))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (queries) {
      queries.apply(filters.query, {
        kind: filters.kind,
        state: filters.state || (staff ? 'all' : ''),
        category: filters.category,
        profileId: staff ? filters.profileId : '',
        businessRecordId: filters.businessRecordId,
      });
      if (JSON.stringify(filters) === basis) setGeneration((value) => value + 1);
    } else {
      setApplied({ ...filters });
      setGeneration((value) => value + 1);
    }
  }
  function change(key: keyof DocumentFilters, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }));
  }
  const appliedFilterCount = [
    applied.kind !== 'standalone',
    applied.state !== (staff ? 'SubmittedForReview' : ''),
    applied.category,
    applied.profileId,
    applied.businessRecordId,
  ].filter(Boolean).length;
  const filterForm = (
    <form onSubmit={apply} className="flex flex-col gap-2">
      <ListPage.Toolbar
        search={
          <ListSearchInput
            id="documents-search"
            label={word('search')}
            maxLength={128}
            value={filters.query}
            onChange={(event) => change('query', event.target.value)}
          />
        }
        moreFilters={{
          label: appText('historyFilters.label', locale),
          count: appliedFilterCount
            ? new Intl.NumberFormat(locale).format(appliedFilterCount)
            : undefined,
          children: (
            <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="documents-kind">{word('kind')}</FieldLabel>
                <NativeSelect
                  id="documents-kind"
                  value={filters.kind}
                  onChange={(event) => {
                    setFilters((previous) => ({
                      ...previous,
                      kind: event.target.value as DocumentKind,
                      businessRecordId: '',
                    }));
                  }}
                >
                  {documentKinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {word(kind)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="documents-state">{word('state')}</FieldLabel>
                <NativeSelect
                  id="documents-state"
                  value={filters.state}
                  onChange={(event) => change('state', event.target.value)}
                >
                  <option value="">{word('all')}</option>
                  {documentStates
                    .filter((state) => staff || state !== 'Removed')
                    .map((state) => (
                      <option key={state} value={state}>
                        {word(state)}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="documents-category">{word('category')}</FieldLabel>
                <NativeSelect
                  id="documents-category"
                  value={filters.category}
                  onChange={(event) => change('category', event.target.value)}
                >
                  <option value="">{word('allCategories')}</option>
                  {['document', 'image', 'video', 'contract'].map((category) => (
                    <option key={category} value={category}>
                      {word(category)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {staff ? (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="documents-profile">{word('profile')}</FieldLabel>
                  <Input
                    id="documents-profile"
                    value={filters.profileId}
                    onChange={(event) => change('profileId', event.target.value.trim())}
                    dir="ltr"
                  />
                </Field>
              ) : null}
              {staff && filters.kind !== 'standalone' ? (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="documents-record">{word('record')}</FieldLabel>
                  <Input
                    id="documents-record"
                    value={filters.businessRecordId}
                    onChange={(event) => change('businessRecordId', event.target.value.trim())}
                    dir="ltr"
                  />
                </Field>
              ) : null}
            </FieldGroup>
          ),
        }}
        actions={
          <Button type="submit" variant="secondary">
            {word('apply')}
          </Button>
        }
      />
      {invalid ? <p role="alert">{word('invalidReference')}</p> : null}
    </form>
  );
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <PageHeader
        title={word(staff ? 'staffTitle' : 'title')}
        description={
          staff ? word('staffDescription') : profileState !== 'missing' ? word('description') : ''
        }
      />
      {staff && recordSearch && (
        <nav className="flex flex-wrap gap-2" aria-label={word('documentGovernance')}>
          {(['retention', 'destruction'] as const).map((operation) => (
            <Link
              key={operation}
              to="/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}"
              params={{ documentId: 'governance', section: operation, action: undefined }}
              search={recordSearch}
              className={buttonVariants({ variant: 'outline' })}
            >
              {word(operation === 'retention' ? 'retentionPolicies' : 'destructionQueue')}
            </Link>
          ))}
        </nav>
      )}
      {(!recordSearch || staff) && filterForm}
      {!staff && (profileState === 'error' || profileState === 'denied') ? (
        <Alert variant="destructive">
          <AlertDescription>
            {word(profileState === 'denied' ? 'denied' : 'listError')}
          </AlertDescription>
          <Button variant="outline" onClick={retryProfile}>
            {word('refresh')}
          </Button>
        </Alert>
      ) : !staff && profileState === 'loading' ? (
        <PageLoading label={word('loading')} />
      ) : !staff && profileState === 'missing' ? (
        <EmptyState
          title={appText('dashboard.profile.choose', locale)}
          description={word('description')}
          action={
            <a href="/app" className="text-sm text-primary underline underline-offset-4">
              {appText('dashboard.nav.overview', locale)}
            </a>
          }
        />
      ) : (
        <DocumentResults
          key={generation}
          staff={staff}
          showRetention={staff}
          filters={applied}
          queries={queries}
          recordSearch={recordSearch}
          filterDisclosure={recordSearch && !staff && filterForm}
          profileId={staff ? applied.profileId : activeProfile!}
        />
      )}
    </div>
  );
}
export function DocumentResults(props: ComponentProps<typeof Results>) {
  const { staff, profileId, filters, association } = props;
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const scope = JSON.stringify([
    actor,
    revision,
    staff,
    profileId,
    filters.kind,
    filters.state,
    filters.category,
    filters.query.trim(),
    filters.businessRecordId,
    filters.contractVersionId,
    association,
  ]);
  return <Results key={scope} {...props} />;
}

function Results({
  staff,
  showRetention = false,
  filters,
  profileId,
  association,
  queries,
  recordSearch,
  filterDisclosure,
  embedded = false,
  relatedLinks,
  summaryLabel,
}: {
  staff: boolean;
  showRetention?: boolean;
  filters: DocumentFilters;
  profileId: string;
  association?: OrderDocumentAssociation | SolarDocumentAssociation;
  queries?: RecordListQuery | undefined;
  recordSearch?: Record<string, unknown> | undefined;
  filterDisclosure?: ReactNode;
  embedded?: boolean;
  relatedLinks?: RelatedDocumentLinks;
  summaryLabel?: string;
}) {
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const { view, setView } = useListView(staff ? 'staff-documents' : 'customer-documents');
  const time = useAccountTime(locale);
  const [localItems, setItems] = useState<BusinessDocument[] | null>(null);
  const [localNext, setNext] = useState<string | null>(null);
  const [localCursor, setCursor] = useState<string | null>(null);
  const cursor = queries ? queries.queue.query.cursor : localCursor;
  const urlRows = useCursorPageRows<BusinessDocument>(
    JSON.stringify([
      staff,
      profileId,
      filters.kind,
      filters.state,
      filters.category,
      filters.query.trim(),
      filters.businessRecordId,
      filters.contractVersionId,
      association,
    ]),
    cursor || ''
  );
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const accessDenied = useRef(false);
  const listRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const items = denied ? null : queries ? urlRows.rows : localItems;
  const next = denied ? null : queries ? urlRows.next : localNext;
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const queryRef = useRef(queries);
  queryRef.current = queries;
  const selected = denied ? null : queries ? queries.selected : localSelected;
  const setSelected = (id: string | null, replace = false) =>
    queryRef.current ? queryRef.current.select(id, { replace }) : setLocalSelected(id);
  const [upload, setUpload] = useState<{
    replacement: BusinessDocument | null;
    selection: string | null;
  } | null>(null);
  const visibleUpload =
    upload && (!queries || upload.selection === queries.selected) ? upload : null;
  const [uploaded, setUploaded] = useState<string | null>(null);
  useEffect(() => {
    if (upload && queries && upload.selection !== queries.selected) setUpload(null);
  }, [selected]);
  function denyAccess() {
    listRequest.current?.abort();
    accessDenied.current = true;
    setDenied(true);
    setError(true);
    setLoading(false);
    setItems(null);
    urlRows.discard();
    setNext(null);
    setSelected(null, true);
    setUpload(null);
    setUploaded(null);
  }
  const params = new URLSearchParams({ businessRecordType: filters.kind });
  if (profileId) params.set('profileId', profileId);
  if (filters.contractVersionId) params.set('contractVersionId', filters.contractVersionId);
  if (filters.state) params.set('state', filters.state);
  if (filters.category) params.set('category', filters.category);
  if (filters.query.trim()) params.set('q', filters.query.trim());
  if (filters.businessRecordId) params.set('businessRecordId', filters.businessRecordId);
  if (cursor) params.set('before', cursor);
  const path = `${documentBase(staff)}?${params}`;
  const allStatuses = new URLSearchParams(params);
  allStatuses.delete('state');
  allStatuses.delete('before');
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readDocument = useOwnedDocumentRead(
    actor,
    revision,
    staff,
    profileId,
    JSON.stringify([
      filters.kind,
      filters.state,
      filters.category,
      filters.query.trim(),
      filters.businessRecordId,
      filters.contractVersionId,
      association,
    ])
  );
  useEffect(() => {
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    setError(false);
    void readDocument<DocumentPage>(path, {
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted) {
          if (
            !Array.isArray(page.documents) ||
            !page.documents.every(
              (item) =>
                validDocumentRow(item, profileId) &&
                (!relatedLinks || relatedDocumentMatches(item, relatedLinks.context))
            ) ||
            (page.nextBefore !== null && typeof page.nextBefore !== 'string')
          )
            throw new DocumentRequestError(502, null);
          accessDenied.current = false;
          setDenied(false);
          if (queries) urlRows.acceptPage(page.documents, staffOrderId(page.nextBefore) || null);
          else {
            setItems((previous) =>
              cursor
                ? [
                    ...(previous ?? []),
                    ...page.documents.filter(
                      (item) => !previous?.some((old) => old.id === item.id)
                    ),
                  ]
                : page.documents
            );
            setNext(page.nextBefore);
          }
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        const forbidden =
          reason instanceof DocumentRequestError && [401, 403].includes(reason.status);
        setError(true);
        if (forbidden) denyAccess();
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (listRequest.current === controller) listRequest.current = null;
    };
  }, [
    path,
    refresh,
    urlRows.acceptPage,
    readDocument,
    relatedLinks?.context.id,
    relatedLinks?.context.kind,
  ]);
  function reload() {
    if (queryRef.current && cursor) {
      queryRef.current.queue.setQuery({ cursor: '' });
      return;
    }
    setCursor(null);
    setNext(null);
    setRefresh((value) => value + 1);
  }
  return (
    <ListPage role="region" aria-label={word('listTitle')}>
      {summaryLabel ? (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{summaryLabel}</h2>
          <ListRefreshButton label={word('refresh')} onClick={reload} disabled={loading} />
        </div>
      ) : (
        <ListPage.Toolbar
          actions={
            <>
              {recordSearch && !denied && filters.kind === 'standalone' && profileId && (
                <Link
                  to={
                    staff
                      ? '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}'
                      : '/documents/$documentId/{-$operation}'
                  }
                  params={{ documentId: 'new', operation: undefined }}
                  search={recordSearch}
                  className={buttonVariants({ className: 'min-h-11' })}
                >
                  {word('upload')}
                </Link>
              )}
              {!embedded && (
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
            </>
          }
        >
          {relatedLinks &&
            relatedLinks.allowUpload !== false &&
            relatedLinks.allowChanges !== false &&
            !denied &&
            profileId && (
              <Link
                {...relatedDocumentLocation(relatedLinks.context, 'new')}
                className={buttonVariants({ className: 'min-h-11' })}
                disabled={relatedLinks.disabled}
                onClick={(event) => {
                  if (relatedLinks.blocked?.()) event.preventDefault();
                }}
              >
                {word('upload')}
              </Link>
            )}
          {!relatedLinks &&
            !recordSearch &&
            !denied &&
            (filters.kind === 'standalone' || association) &&
            !!profileId && (
              <Button
                onClick={() => {
                  if (accessDenied.current) return;
                  setUpload({ replacement: null, selection: null });
                  setSelected(null);
                  setUploaded(null);
                }}
              >
                {word('upload')}
              </Button>
            )}
          <ListRefreshButton label={word('refresh')} onClick={reload} disabled={loading} />
        </ListPage.Toolbar>
      )}
      {filterDisclosure}
      {!summaryLabel && time.notice}
      {uploaded && uploaded === selected ? <p role="status">{word('uploadComplete')}</p> : null}
      {staff && filters.kind === 'standalone' && !profileId ? (
        <p className="text-sm text-muted-foreground">{word('selectProfile')}</p>
      ) : null}
      {visibleUpload ? (
        <DocumentUpload
          staff={staff}
          profileId={visibleUpload.replacement?.profileId ?? profileId}
          replacement={visibleUpload.replacement}
          {...(association ? { association } : {})}
          onClose={() => setUpload(null)}
          onUploaded={(document) => {
            if (
              !mounted.current ||
              accessDenied.current ||
              (queryRef.current && queryRef.current.selected !== visibleUpload.selection)
            )
              return;
            setUpload(null);
            setUploaded(document.id);
            if (queryRef.current) {
              queryRef.current.select(document.id, { resetCursor: true });
              setRefresh((value) => value + 1);
            } else {
              setSelected(document.id);
              reload();
            }
          }}
        />
      ) : null}
      {selected ? (
        <Suspense fallback={<PageLoading label={word('loading')} />}>
          <DocumentDetail
            key={selected}
            id={selected}
            profileId={profileId}
            staff={staff}
            showRetention={showRetention}
            onClose={() => setSelected(null)}
            onPrevious={(id) => {
              if (!accessDenied.current) setSelected(id);
            }}
            onChanged={() => {
              if (!accessDenied.current) reload();
            }}
            savingPreSubmissionOnly={association?.businessRecordType === 'order' && !staff}
            solarCustomer={association?.businessRecordType === 'solar_request' && !staff}
            onReplace={(document) => {
              if (accessDenied.current) return;
              setSelected(null);
              setUpload({ replacement: document, selection: null });
            }}
          />
        </Suspense>
      ) : null}
      <ListPage.Content
        loading={loading}
        error={error}
        empty={!items?.length}
        retainContent={!!items?.length && !denied}
        loadingView={<PageLoading label={word('loading')} />}
        errorView={
          <Alert variant="destructive">
            <AlertDescription>{word(denied ? 'denied' : 'listError')}</AlertDescription>
            {!denied && (
              <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>
                {word('retry')}
              </Button>
            )}
          </Alert>
        }
        emptyView={
          queries && filters.state && !cursor ? (
            <QueueEmptyState
              locale={locale}
              message={word('empty')}
              status={word(filters.state)}
              alternatives={[
                { value: 'all', label: word('all'), path: `${documentBase(staff)}?${allStatuses}` },
              ]}
              hasResults={(body) => {
                const documents = (body as Partial<DocumentPage> | null)?.documents;
                return (
                  Array.isArray(documents) &&
                  documents.some(
                    (item) => validDocumentRow(item, profileId) && item.state !== filters.state
                  )
                );
              }}
              all={() => {
                if (!accessDenied.current)
                  queries.queue.setQuery({ filters: { state: staff ? 'all' : '' } });
              }}
              disabled={denied}
            />
          ) : summaryLabel ? (
            <p className="rounded-lg border bg-muted/25 px-3 py-2.5 text-sm text-muted-foreground">
              {word('empty')}
            </p>
          ) : (
            <EmptyState
              icon={embedded ? null : undefined}
              className={
                embedded
                  ? 'items-start border p-3 text-start [&_[data-slot=empty-header]]:items-start [&_[data-slot=empty-header]]:gap-1'
                  : ''
              }
              title={word('empty')}
              description={word(embedded ? 'requestEmptyHint' : 'emptyHint')}
            />
          )
        }
      >
        {items?.length ? (
          summaryLabel ? (
            <ul className="divide-y rounded-lg border bg-muted/15">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
                >
                  <span className="flex min-w-0 grow basis-36 items-center gap-2 text-sm font-medium">
                    <FileText
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <bdi className="min-w-0 wrap-anywhere">{item.originalName}</bdi>
                  </span>
                  <DocumentStatusBadge state={item.state} locale={locale} />
                </li>
              ))}
            </ul>
          ) : (
            <DocumentList
              items={items}
              staff={staff}
              locale={locale}
              view={embedded ? 'card' : view}
              selectedId={selected}
              recordSearch={recordSearch}
              relatedLinks={relatedLinks}
              formatDate={time.format}
              onChanged={(id) => {
                if (accessDenied.current) return;
                if (selected === id) setSelected(null);
                if (upload?.replacement?.id === id) setUpload(null);
                reload();
              }}
              onReplace={(document) => {
                if (accessDenied.current) return;
                setSelected(null);
                setUpload({ replacement: document, selection: null });
                setUploaded(null);
              }}
              onDenied={denyAccess}
              onSelect={(id) => {
                if (accessDenied.current) return;
                setSelected(id);
                setUpload(null);
              }}
            />
          )
        ) : null}
      </ListPage.Content>
      <ListPage.Pagination
        kind="cursor"
        hasMore={
          !!next &&
          !error &&
          !denied &&
          (loading || (queries ? queries.queue.canAdvance(next) : true))
        }
        loading={loading}
        label={word('pages')}
        nextLabel={word('next')}
        previous={{
          enabled: !denied && (queries?.queue.hasPrevious ?? false),
          onClick: () => queries?.queue.previous(),
          label: appText('historyPagination.previous', locale),
        }}
        onNext={() => {
          if (!next) return;
          if (queries) queries.queue.next(next);
          else setCursor(next);
        }}
      />
    </ListPage>
  );
}

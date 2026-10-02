import { useEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react';
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
  NativeSelect,
  PageHeader,
  PageLoading,
  ListViewToggle,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { t as appText } from '@barghsa/i18n/app';
import { useCursorPageRows } from '../hooks/useCursorPageRows.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import type { RecordListQuery } from '../lib/record-list-query.js';
import { useLocale } from '../hooks/useLocale.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { DocumentRecords } from './DocumentRecords.js';
import { useListView } from '../hooks/useListView.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentDetail } from './DocumentDetail.js';
import { DocumentRetentionPolicies } from './DocumentRetentionPolicies.js';
import { DocumentDestructionQueue } from './DocumentDestructionQueue.js';
import {
  DocumentUpload,
  type OrderDocumentAssociation,
  type SolarDocumentAssociation,
} from './DocumentUpload.js';
import {
  documentBase,
  DocumentRequestError,
  documentKinds,
  documentRequest,
  documentStates,
  type BusinessDocument,
  type DocumentKind,
  type DocumentPage,
} from '../lib/documents.js';

export interface DocumentFilters {
  contractVersionId?: string;
  kind: DocumentKind;
  state: string;
  category: string;
  query: string;
  profileId: string;
  businessRecordId: string;
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function DocumentsWorkspace({
  staff = false,
  queries,
}: {
  staff?: boolean;
  queries?: RecordListQuery | undefined;
}) {
  const revision = useProfileContextRevision();
  return <Workspace key={`${staff}:${revision}`} staff={staff} queries={queries} />;
}
function Workspace({ staff, queries }: { staff: boolean; queries?: RecordListQuery | undefined }) {
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
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
  useEffect(() => {
    if (staff) return;
    const controller = new AbortController();
    setProfileError(false);
    void documentRequest<{ activeProfileId: string | null }>('/api/profiles', {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setActiveProfile(data.activeProfileId);
          if (!data.activeProfileId) setProfileError(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setProfileError(true);
      });
    return () => controller.abort();
  }, [staff, profileRetry]);
  function apply(event: FormEvent) {
    event.preventDefault();
    if (
      (filters.profileId && !uuid.test(filters.profileId)) ||
      (filters.businessRecordId && !uuid.test(filters.businessRecordId))
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
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <PageHeader
        title={word(staff ? 'staffTitle' : 'title')}
        description={word(staff ? 'staffDescription' : 'description')}
      />
      {staff ? <DocumentRetentionPolicies /> : null}
      {staff ? <DocumentDestructionQueue /> : null}
      <form onSubmit={apply} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
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
          <Field>
            <FieldLabel htmlFor="documents-search">{word('search')}</FieldLabel>
            <Input
              id="documents-search"
              type="search"
              maxLength={128}
              value={filters.query}
              onChange={(event) => change('query', event.target.value)}
            />
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
        {invalid ? <p role="alert">{word('invalidReference')}</p> : null}
        <Button type="submit" className="self-start">
          {word('apply')}
        </Button>
      </form>
      {profileError ? (
        <Alert variant="destructive">
          <AlertDescription>{word('denied')}</AlertDescription>
          <Button variant="outline" onClick={() => setProfileRetry((value) => value + 1)}>
            {word('refresh')}
          </Button>
        </Alert>
      ) : !staff && !activeProfile ? (
        <PageLoading label={word('loading')} />
      ) : (
        <DocumentResults
          key={generation}
          staff={staff}
          showRetention={staff}
          filters={applied}
          queries={queries}
          profileId={staff ? applied.profileId : activeProfile!}
        />
      )}
    </div>
  );
}
export function DocumentResults(props: ComponentProps<typeof Results>) {
  const { staff, profileId, filters, association } = props;
  const scope = JSON.stringify([
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
}: {
  staff: boolean;
  showRetention?: boolean;
  filters: DocumentFilters;
  profileId: string;
  association?: OrderDocumentAssociation | SolarDocumentAssociation;
  queries?: RecordListQuery | undefined;
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
  const params = new URLSearchParams({ businessRecordType: filters.kind });
  if (profileId) params.set('profileId', profileId);
  if (filters.contractVersionId) params.set('contractVersionId', filters.contractVersionId);
  if (filters.state) params.set('state', filters.state);
  if (filters.category) params.set('category', filters.category);
  if (filters.query.trim()) params.set('q', filters.query.trim());
  if (filters.businessRecordId) params.set('businessRecordId', filters.businessRecordId);
  if (cursor) params.set('before', cursor);
  const path = `${documentBase(staff)}?${params}`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void documentRequest<DocumentPage>(path, {
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted) {
          if (
            !Array.isArray(page.documents) ||
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
        if (forbidden) {
          accessDenied.current = true;
          setDenied(true);
          setItems(null);
          urlRows.discard();
          setNext(null);
          setSelected(null, true);
          setUpload(null);
          setUploaded(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, refresh, urlRows.acceptPage]);
  function reload() {
    if (queryRef.current) queryRef.current.queue.setQuery({ cursor: '' });
    else setCursor(null);
    setNext(null);
    setRefresh((value) => value + 1);
  }
  return (
    <ListPage role="region" aria-label={word('listTitle')}>
      <ListPage.Toolbar
        actions={
          <ListViewToggle
            value={view}
            onChange={setView}
            labels={{
              group: appText('historyView.group', locale),
              table: appText('historyView.table', locale),
              card: appText('historyView.card', locale),
            }}
          />
        }
      >
        <Button variant="outline" onClick={reload} disabled={loading}>
          {word('refresh')}
        </Button>
        {!denied && (filters.kind === 'standalone' || association) && profileId ? (
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
        ) : null}
      </ListPage.Toolbar>
      {time.notice}
      {uploaded && uploaded === selected ? <p role="status">{word('uploadComplete')}</p> : null}
      {staff && filters.kind === 'standalone' && !profileId ? (
        <p className="text-sm text-muted-foreground">{word('selectProfile')}</p>
      ) : null}
      {visibleUpload ? (
        <DocumentUpload
          staff={staff}
          profileId={profileId}
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
        <DocumentDetail
          key={selected}
          id={selected}
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
        emptyView={<EmptyState title={word('empty')} description={word('emptyHint')} />}
      >
        {items?.length ? (
          <DocumentRecords
            items={items}
            staff={staff}
            locale={locale}
            view={view}
            selectedId={selected}
            formatDate={time.format}
            onSelect={(id) => {
              if (accessDenied.current) return;
              setSelected(id);
              setUpload(null);
            }}
          />
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

import { useEffect, useState, type FormEvent } from 'react';
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
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { DocumentDetail } from './DocumentDetail.js';
import { DocumentRetentionPolicies } from './DocumentRetentionPolicies.js';
import {
  DocumentUpload,
  type OrderDocumentAssociation,
  type SolarDocumentAssociation,
} from './DocumentUpload.js';
import {
  documentBase,
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
export function DocumentsWorkspace({ staff = false }: { staff?: boolean }) {
  const revision = useProfileContextRevision();
  return <Workspace key={`${staff}:${revision}`} staff={staff} />;
}
function Workspace({ staff }: { staff: boolean }) {
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
  const [filters, setFilters] = useState<DocumentFilters>({
    kind: 'standalone',
    state: staff ? 'SubmittedForReview' : '',
    category: '',
    query: '',
    profileId: '',
    businessRecordId: '',
  });
  const [applied, setApplied] = useState(filters);
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
    setApplied({ ...filters });
    setGeneration((value) => value + 1);
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
          profileId={staff ? applied.profileId : activeProfile!}
        />
      )}
    </div>
  );
}
export function DocumentResults({
  staff,
  showRetention = false,
  filters,
  profileId,
  association,
}: {
  staff: boolean;
  showRetention?: boolean;
  filters: DocumentFilters;
  profileId: string;
  association?: OrderDocumentAssociation | SolarDocumentAssociation;
}) {
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const [items, setItems] = useState<BusinessDocument[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ replacement: BusinessDocument | null } | null>(null);
  const [uploaded, setUploaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ businessRecordType: filters.kind });
    if (profileId) params.set('profileId', profileId);
    if (filters.contractVersionId) params.set('contractVersionId', filters.contractVersionId);
    if (filters.state) params.set('state', filters.state);
    if (filters.category) params.set('category', filters.category);
    if (filters.query.trim()) params.set('q', filters.query.trim());
    if (filters.businessRecordId) params.set('businessRecordId', filters.businessRecordId);
    if (cursor) params.set('before', cursor);
    setLoading(true);
    setError(false);
    void documentRequest<DocumentPage>(`${documentBase(staff)}?${params}`, {
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted) {
          setItems((previous) =>
            cursor
              ? [
                  ...(previous ?? []),
                  ...page.documents.filter((item) => !previous?.some((old) => old.id === item.id)),
                ]
              : page.documents
          );
          setNext(page.nextBefore);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [staff, filters, profileId, cursor, refresh]);
  function reload() {
    setCursor(null);
    setNext(null);
    setItems(null);
    setRefresh((value) => value + 1);
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={reload} disabled={loading}>
          {word('refresh')}
        </Button>
        {(filters.kind === 'standalone' || association) && profileId ? (
          <Button
            onClick={() => {
              setUpload({ replacement: null });
              setSelected(null);
              setUploaded(false);
            }}
          >
            {word('upload')}
          </Button>
        ) : null}
      </div>
      {uploaded ? <p role="status">{word('uploadComplete')}</p> : null}
      {staff && filters.kind === 'standalone' && !profileId ? (
        <p className="text-sm text-muted-foreground">{word('selectProfile')}</p>
      ) : null}
      {upload ? (
        <DocumentUpload
          staff={staff}
          profileId={profileId}
          replacement={upload.replacement}
          {...(association ? { association } : {})}
          onClose={() => setUpload(null)}
          onUploaded={(document) => {
            setUpload(null);
            setSelected(document.id);
            setUploaded(true);
            reload();
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
          onPrevious={setSelected}
          onChanged={reload}
          savingPreSubmissionOnly={association?.businessRecordType === 'order' && !staff}
          solarCustomer={association?.businessRecordType === 'solar_request' && !staff}
          onReplace={(document) => {
            setSelected(null);
            setUpload({ replacement: document });
          }}
        />
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
          <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>
            {word('refresh')}
          </Button>
        </Alert>
      ) : null}
      {items === null && loading ? <PageLoading label={word('loading')} /> : null}
      {items?.length === 0 ? (
        <EmptyState title={word('empty')} description={word('emptyHint')} />
      ) : null}
      {items?.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <Button
                  variant="link"
                  className="justify-start whitespace-normal text-start"
                  onClick={() => {
                    setSelected(document.id);
                    setUpload(null);
                  }}
                >
                  {document.originalName}
                </Button>
                <p className="text-sm text-muted-foreground">
                  {word(document.category)} · {word(document.uploadedByType)}
                </p>
              </div>
              <StatusBadge label={word(document.state)} />
            </li>
          ))}
        </ul>
      ) : null}
      {next ? (
        <Button variant="outline" disabled={loading} onClick={() => setCursor(next)}>
          {loading ? word('loading') : word('next')}
        </Button>
      ) : null}
    </div>
  );
}

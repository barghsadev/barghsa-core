import type { KnowledgeCatalogueKind } from '../lib/catalogue-category-query.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useEffect, useState, useRef, useCallback, type FormEvent } from 'react';
import { Button, Input, Label, ListPage } from '@barghsa/ui';
import { KnowledgeBaseDocumentPicker } from '../components/KnowledgeBaseDocumentPicker.js';
import { t } from '@barghsa/i18n/admin-ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { withCsrf } from '../lib/csrf.js';
interface Entry {
  id: string;
  title: string;
  description: string;
  audience?: 'admin' | 'staff' | 'customer' | 'public';
  sourceType?: 'document' | 'url' | 'api';
  sourceConfig?: { urls?: string[]; apiUrl?: string };
  contentState?: 'empty' | 'processing' | 'ready' | 'error';
  contentError?: string | null;
  chunkingStrategy?: { size: number; overlap: number };
  vectorEmbeddingModel?: string | null;
  isEnabled?: boolean;
  documentCount?: number;
  memberCount?: number;
}
interface Detail extends Entry {
  members?: { id: string; title: string }[];
  documents?: { id: string; fileName: string; storageKey: string; processingStatus: string }[];
}
interface QueryResult {
  id: string;
  kbId: string;
  excerpt: string;
  score: number;
  metadata: { fileName?: string; url?: string };
}
type Kind = 'knowledge-bases' | 'kb-groups';
type Draft = {
  id?: string;
  title: string;
  description: string;
  audience: 'admin' | 'staff' | 'customer' | 'public';
  sourceType: 'document' | 'url' | 'api';
  sourceUrl: string;
  chunkSize: number;
  chunkOverlap: number;
  vectorEmbeddingModel: string;
};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validEntries(value: unknown): value is Entry[] {
  return (
    Array.isArray(value) &&
    value.every((v) => {
      if (!record(v) || !['id', 'title', 'description'].every((k) => typeof v[k] === 'string'))
        return false;
      const config = v.sourceConfig,
        chunk = v.chunkingStrategy;
      return (
        ['documentCount', 'memberCount'].every(
          (k) => v[k] === undefined || typeof v[k] === 'number'
        ) &&
        (config === undefined ||
          (record(config) &&
            (config.urls === undefined ||
              (Array.isArray(config.urls) &&
                config.urls.every((url) => typeof url === 'string'))) &&
            (config.apiUrl === undefined || typeof config.apiUrl === 'string'))) &&
        (chunk === undefined ||
          (record(chunk) && typeof chunk.size === 'number' && typeof chunk.overlap === 'number')) &&
        (v.vectorEmbeddingModel === undefined ||
          v.vectorEmbeddingModel === null ||
          typeof v.vectorEmbeddingModel === 'string')
      );
    })
  );
}
function validDetail(value: unknown): value is Detail {
  return (
    record(value) &&
    validEntries([value]) &&
    (value.members === undefined ||
      (Array.isArray(value.members) &&
        value.members.every(
          (v) => record(v) && typeof v.id === 'string' && typeof v.title === 'string'
        ))) &&
    (value.documents === undefined ||
      (Array.isArray(value.documents) &&
        value.documents.every(
          (v) =>
            record(v) &&
            ['id', 'fileName', 'storageKey', 'processingStatus'].every(
              (k) => typeof v[k] === 'string'
            )
        )))
  );
}
function validQuery(value: unknown): value is QueryResult[] {
  return (
    Array.isArray(value) &&
    value.every((v) => {
      if (!record(v)) return false;
      const metadata = v.metadata;
      return (
        ['id', 'kbId', 'excerpt'].every((k) => typeof v[k] === 'string') &&
        typeof v.score === 'number' &&
        Number.isFinite(v.score) &&
        record(metadata) &&
        ['fileName', 'url'].every(
          (k) =>
            metadata[k] === undefined || metadata[k] === null || typeof metadata[k] === 'string'
        )
      );
    })
  );
}
function retrievalBasis(detail: Detail) {
  return JSON.stringify({
    config: draftFor(detail),
    enabled: detail.isEnabled,
    state: detail.contentState,
    members: detail.members?.map((v) => v.id).sort(),
    documents: detail.documents?.map((v) => `${v.id}:${v.storageKey}:${v.processingStatus}`).sort(),
  });
}
function draftFor(entry?: Entry): Draft {
  return {
    ...(entry ? { id: entry.id } : {}),
    title: entry?.title ?? '',
    description: entry?.description ?? '',
    audience: entry?.audience ?? 'admin',
    sourceType: entry?.sourceType ?? 'document',
    sourceUrl: entry?.sourceConfig?.urls?.join('\n') ?? entry?.sourceConfig?.apiUrl ?? '',
    chunkSize: entry?.chunkingStrategy?.size ?? 800,
    chunkOverlap: entry?.chunkingStrategy?.overlap ?? 100,
    vectorEmbeddingModel: entry?.vectorEmbeddingModel ?? '',
  };
}
export default function AdminKnowledgeBasesPage({
  initialKind = 'knowledge-bases',
  onKindChange,
  focusCategory = false,
}: {
  initialKind?: KnowledgeCatalogueKind;
  focusCategory?: boolean;
  onKindChange?: (value: KnowledgeCatalogueKind) => void;
} = {}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.kb.${key}`, locale);
  const processingError = (code: string | null | undefined) =>
    label(
      (
        {
          kb_embedding_not_configured: 'errorProviderMissing',
          kb_embedding_model_missing: 'errorModelMissing',
          kb_source_empty: 'errorSourceEmpty',
          kb_source_unavailable: 'errorSourceUnavailable',
          kb_unsupported_file_type: 'errorUnsupportedFile',
        } as Record<string, string>
      )[code ?? ''] ?? 'errorGeneric'
    );
  const [kind, setKind] = useState<Kind>(initialKind);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [member, setMember] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null),
    [notice, setNotice] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [queryState, setQueryState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [queryResult, setQueryResult] = useState<{ id: string; rows: QueryResult[] } | null>(null);
  const commandTarget = useRef<{ id: string; basis: string } | null>(null);
  const generation = useRef(0),
    commandGeneration = useRef(0);
  const selectionGeneration = useRef(0);
  const queryRequest = useRef<AbortController | null>(null);
  const draftBasis = useRef<string | null>(null),
    detailBasis = useRef<string | null>(null);
  const clearDetail = useCallback(() => {
    generation.current++;
    selectionGeneration.current++;
    commandTarget.current = null;
    queryRequest.current?.abort();
    setSelected(null);
    setMember('');
    setQueryText('');
    setQueryResult(null);
    setQueryState('idle');
    setAction(null);
    detailBasis.current = null;
  }, []);
  const clearWork = useCallback(() => {
    clearDetail();
    setDraft(null);
    setNotice(false);
    draftBasis.current = null;
  }, [clearDetail]);
  const scope = useCatalogueScope(clearWork);
  const list = useCatalogueResource(scope, `/api/admin/${kind}`, validEntries);
  const choices = useCatalogueResource(
    scope,
    kind === 'kb-groups' ? '/api/admin/knowledge-bases' : null,
    validEntries
  );
  const validateDetail = useCallback(
    (value: unknown): value is Detail => validDetail(value) && value.id === selected,
    [selected]
  );
  const selectedRead = useCatalogueResource(
    scope,
    selected ? `/api/admin/${kind}/${encodeURIComponent(selected)}` : null,
    validateDetail
  );
  const rows = list.data ?? [],
    kbs = kind === 'knowledge-bases' ? rows : (choices.data ?? []),
    detail = selectedRead.data;
  const disabled = scope.denied || list.loading || list.error;
  const detailDisabled = disabled || selectedRead.loading || selectedRead.error;
  const memberDisabled = detailDisabled || choices.loading || choices.error;
  const work = useRef({
    selected,
    draft,
    kind,
    action,
    detail,
    disabled,
    detailDisabled,
    memberDisabled,
  });
  work.current = {
    selected,
    draft,
    kind,
    action,
    detail,
    disabled,
    detailDisabled,
    memberDisabled,
  };
  useEffect(
    () => () => {
      generation.current++;
      selectionGeneration.current++;
      queryRequest.current?.abort();
    },
    []
  );
  useEffect(() => {
    if (!list.data) return;
    const current = work.current;
    if (current.draft?.id && draftBasis.current) {
      const fresh = list.data.find((row) => row.id === current.draft?.id);
      if (!fresh || JSON.stringify(draftFor(fresh)) !== draftBasis.current) {
        generation.current++;
        setDraft(null);
        setAction(null);
        draftBasis.current = null;
      }
    }
    const command = commandTarget.current;
    if (
      command &&
      !list.data.some(
        (row) => row.id === command.id && JSON.stringify(draftFor(row)) === command.basis
      )
    ) {
      generation.current++;
      setAction(null);
      commandTarget.current = null;
    }
    if (current.selected && !list.data.some((row) => row.id === current.selected)) clearDetail();
  }, [list.data, clearDetail]);
  useEffect(() => {
    if (!selectedRead.data) return;
    const next = retrievalBasis(selectedRead.data);
    if (detailBasis.current && detailBasis.current !== next) {
      generation.current++;
      queryRequest.current?.abort();
      setQueryResult(null);
      setQueryState('idle');
      setAction(null);
    }
    detailBasis.current = next;
  }, [selectedRead.data]);
  useEffect(() => {
    const pending = work.current.action;
    if (!choices.data || !pending || !record(pending.body) || typeof pending.body.kbId !== 'string')
      return;
    const id = pending.body.kbId;
    if (!choices.data.some((row) => row.id === id)) {
      generation.current++;
      setAction(null);
    }
  }, [choices.data]);
  function open(value: string) {
    if (disabled || value === selected) return;
    clearDetail();
    setSelected(value);
  }
  function edit(entry?: Entry) {
    if (disabled) return;
    generation.current++;
    commandTarget.current = null;
    setAction(null);
    setDraft(draftFor(entry));
    draftBasis.current = entry ? JSON.stringify(draftFor(entry)) : null;
    setNotice(false);
  }
  function refresh() {
    if (scope.denied) scope.recover();
    else {
      list.retry();
      choices.retry();
      selectedRead.retry();
    }
  }
  function commandDisabled(path: string, body?: unknown) {
    const current = work.current;
    if (path.includes('/members/')) return current.detailDisabled;
    if (path.endsWith('/members')) return current.memberDisabled;
    if (
      path.includes('/documents') ||
      path.endsWith('/reprocess') ||
      (body && typeof body === 'object' && 'isEnabled' in body)
    )
      return current.detailDisabled;
    return current.disabled;
  }
  const recovery = (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={list.loading || choices.loading || selectedRead.loading}
        onClick={refresh}
      >
        {label('refresh')}
      </Button>
      {list.loading && <p role="status">{label('loading')}</p>}
      {list.error && (
        <div role="alert">
          <p>{label('error')}</p>
          <Button type="button" onClick={list.retry}>
            {label('retry')}
          </Button>
        </div>
      )}
      {choices.error && (
        <div role="alert">
          <p>{label('optionsError')}</p>
          <Button type="button" onClick={choices.retry}>
            {label('optionsRetry')}
          </Button>
        </div>
      )}
      {selectedRead.error && (
        <div role="alert">
          <p>{label('detailError')}</p>
          <Button type="button" onClick={selectedRead.retry}>
            {label('detailRetry')}
          </Button>
        </div>
      )}
    </div>
  );
  function propose(
    path: string,
    method: TeamAction['method'],
    title: string,
    description: string,
    body?: unknown
  ) {
    if (commandDisabled(path, body)) return;
    const target = rows.find((row) => path === `/api/admin/${kind}/${row.id}`);
    commandTarget.current = target
      ? { id: target.id, basis: JSON.stringify(draftFor(target)) }
      : null;
    commandGeneration.current = generation.current;
    setNotice(false);
    setAction({
      path,
      method,
      title,
      description,
      ...(body === undefined ? {} : { body }),
      forbiddenMessage: label('denied'),
      errorMessages: { 'VALIDATION:PARSE:ZOD_ERROR': label('invalid') },
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || disabled) return;
    propose(
      `/api/admin/${kind}${draft.id ? `/${draft.id}` : ''}`,
      draft.id ? 'PUT' : 'POST',
      label('save'),
      kind === 'knowledge-bases' && draft.audience !== 'admin'
        ? `${label('confirmSave')} ${label('audienceWarning')}`
        : label('confirmSave'),
      kind === 'kb-groups'
        ? { title: draft.title.trim(), description: draft.description }
        : {
            title: draft.title.trim(),
            description: draft.description,
            audience: draft.audience,
            sourceType: draft.sourceType,
            sourceConfig:
              draft.sourceType === 'url'
                ? {
                    urls: draft.sourceUrl
                      .split(/\r?\n/)
                      .map((url) => url.trim())
                      .filter(Boolean),
                  }
                : draft.sourceType === 'api'
                  ? { apiUrl: draft.sourceUrl.trim() }
                  : {},
            chunkingStrategy: { size: draft.chunkSize, overlap: draft.chunkOverlap },
            vectorEmbeddingModel: draft.vectorEmbeddingModel.trim() || null,
          }
    );
  }
  async function testQuery(event: FormEvent) {
    event.preventDefault();
    if (!detail || detailDisabled || !queryText.trim()) return;
    queryRequest.current?.abort();
    const request = new AbortController();
    queryRequest.current = request;
    const commandVersion = generation.current,
      targetId = detail.id;
    const current = () => !request.signal.aborted && commandVersion === generation.current;
    setQueryState('loading');
    setQueryResult(null);
    try {
      const response = await fetch(`/api/admin/${kind}/${targetId}/query`, {
        method: 'POST',
        signal: request.signal,
        headers: withCsrf({ 'content-type': 'application/json' }),
        body: JSON.stringify({ query: queryText.trim(), limit: 5 }),
      });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        scope.deny();
        return;
      }
      if (!response.ok) throw new Error('Query failed');
      const results: unknown = await response.json();
      if (!current()) return;
      if (!validQuery(results)) throw new Error('Invalid query');
      setQueryResult({ id: targetId, rows: results });
      setQueryState('idle');
    } catch {
      if (current()) setQueryState('error');
    }
  }
  return (
    <div
      className="mx-auto min-w-0 flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <div className="flex flex-wrap gap-2">
        {(['knowledge-bases', 'kb-groups'] as const).map((value) => (
          <Button
            key={value}
            autoFocus={focusCategory && kind === value}
            variant={kind === value ? 'default' : 'outline'}
            aria-pressed={kind === value}
            onClick={() => {
              if (kind === value) return;
              clearWork();
              if (onKindChange) onKindChange(value);
              else {
                scope.recover();
                setKind(value);
              }
            }}
          >
            {label(value)}
          </Button>
        ))}
        <Button
          variant="outline"
          disabled={list.loading || choices.loading || selectedRead.loading}
          onClick={refresh}
        >
          {label('refresh')}
        </Button>
      </div>
      <ListPage>
        {scope.denied ? (
          <p role="alert">{label('denied')}</p>
        ) : (
          <>
            {notice && <p role="status">{label('saved')}</p>}
            <ListPage.Toolbar>
              <Button disabled={disabled} onClick={() => edit()}>
                {label(kind === 'knowledge-bases' ? 'addKb' : 'addGroup')}
              </Button>
            </ListPage.Toolbar>
            {choices.loading && <p role="status">{label('optionsLoading')}</p>}
            {choices.error && (
              <div role="alert">
                <p>{label('optionsError')}</p>
                <Button onClick={choices.retry}>{label('optionsRetry')}</Button>
              </div>
            )}
            {selectedRead.loading && <p role="status">{label('detailLoading')}</p>}
            {selectedRead.error && (
              <div role="alert">
                <p>{label('detailError')}</p>
                <Button onClick={selectedRead.retry}>{label('detailRetry')}</Button>
              </div>
            )}
            {draft && (
              <form
                onSubmit={save}
                aria-label={label('editor')}
                className="flex flex-col gap-4 border-y py-5"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="kb-title">{label('name')}</Label>
                  <Input
                    id="kb-title"
                    required
                    maxLength={120}
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="kb-description">{label('description')}</Label>
                  <textarea
                    id="kb-description"
                    className="min-h-24 rounded-md border bg-background p-3"
                    maxLength={2000}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </div>
                {kind === 'knowledge-bases' && (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="kb-audience">{label('audience')}</Label>
                      <select
                        id="kb-audience"
                        className="rounded-md border bg-background p-2"
                        value={draft.audience}
                        onChange={(event) =>
                          setDraft({ ...draft, audience: event.target.value as Draft['audience'] })
                        }
                      >
                        {(['admin', 'staff', 'customer', 'public'] as const).map((value) => (
                          <option key={value} value={value}>
                            {label(`audience${value}`)}
                          </option>
                        ))}
                      </select>
                      <p className="text-sm text-muted-foreground">{label('audienceHelp')}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="kb-source-type">{label('sourceType')}</Label>
                      <select
                        id="kb-source-type"
                        className="rounded-md border bg-background p-2"
                        value={draft.sourceType}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            sourceType: event.target.value as Draft['sourceType'],
                          })
                        }
                      >
                        <option value="document">{label('sourceDocument')}</option>
                        <option value="url">{label('sourceUrl')}</option>
                        <option value="api">{label('sourceApi')}</option>
                      </select>
                    </div>
                    {draft.sourceType !== 'document' && (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="kb-source-url">{label('sourceAddress')}</Label>
                        {draft.sourceType === 'url' ? (
                          <>
                            <textarea
                              id="kb-source-url"
                              required
                              maxLength={40960}
                              rows={3}
                              className="rounded-md border bg-background p-3"
                              value={draft.sourceUrl}
                              onChange={(event) =>
                                setDraft({ ...draft, sourceUrl: event.target.value })
                              }
                            />
                            <p className="text-sm text-muted-foreground">
                              {label('sourceUrlsHelp')}
                            </p>
                          </>
                        ) : (
                          <Input
                            id="kb-source-url"
                            type="url"
                            required
                            maxLength={2048}
                            placeholder="https://"
                            value={draft.sourceUrl}
                            onChange={(event) =>
                              setDraft({ ...draft, sourceUrl: event.target.value })
                            }
                          />
                        )}
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="kb-chunk-size">{label('chunkSize')}</Label>
                        <Input
                          id="kb-chunk-size"
                          type="number"
                          min={100}
                          max={4000}
                          required
                          value={draft.chunkSize}
                          onChange={(event) =>
                            setDraft({ ...draft, chunkSize: Number(event.target.value) })
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="kb-chunk-overlap">{label('chunkOverlap')}</Label>
                        <Input
                          id="kb-chunk-overlap"
                          type="number"
                          min={0}
                          max={1000}
                          required
                          value={draft.chunkOverlap}
                          onChange={(event) =>
                            setDraft({ ...draft, chunkOverlap: Number(event.target.value) })
                          }
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="kb-embedding-model">{label('embeddingModel')}</Label>
                      <Input
                        id="kb-embedding-model"
                        maxLength={120}
                        value={draft.vectorEmbeddingModel}
                        onChange={(event) =>
                          setDraft({ ...draft, vectorEmbeddingModel: event.target.value })
                        }
                      />
                    </div>
                  </>
                )}
                <div className="flex gap-2">
                  <Button type="submit" disabled={disabled || !draft.title.trim()}>
                    {label('save')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                    {label('cancel')}
                  </Button>
                </div>
              </form>
            )}
            <ListPage.Content
              loading={list.loading}
              error={list.error}
              empty={!rows.length}
              retainContent={rows.length > 0}
              loadingView={<p role="status">{label('loading')}</p>}
              errorView={
                <div role="alert">
                  <p>{label('error')}</p>
                  <Button onClick={list.retry}>{label('retry')}</Button>
                </div>
              }
              emptyView={<p>{label('empty')}</p>}
            >
              <ul className="divide-y">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <h2 className="break-words font-semibold">{row.title}</h2>
                      <p className="whitespace-pre-wrap break-words text-sm">{row.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {label(kind === 'knowledge-bases' ? 'documents' : 'members')}:{' '}
                        {numbers.number(row.documentCount ?? row.memberCount ?? 0)}
                      </p>
                      {kind === 'knowledge-bases' && (
                        <div className="space-y-1 text-sm text-muted-foreground">
                          <p>
                            {label('contentState')}: {label(`state${row.contentState ?? 'empty'}`)}
                            {' · '}
                            {label(row.isEnabled ? 'enabled' : 'disabled')}
                          </p>
                          <p>
                            {label('audience')}: {label(`audience${row.audience ?? 'admin'}`)}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={disabled}
                        onClick={() => open(row.id)}
                        aria-label={`${label('open')} ${row.title}`}
                      >
                        {label('open')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={disabled}
                        onClick={() => edit(row)}
                        aria-label={`${label('edit')} ${row.title}`}
                      >
                        {label('edit')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={disabled}
                        onClick={() =>
                          propose(
                            `/api/admin/${kind}/${row.id}`,
                            'DELETE',
                            label('delete'),
                            `${row.title}. ${label('confirmDelete')}`
                          )
                        }
                        aria-label={`${label('delete')} ${row.title}`}
                      >
                        {label('delete')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </ListPage.Content>
            {detail && (
              <section aria-label={detail.title} className="flex flex-col gap-4 border-t pt-5">
                <h2 className="break-words text-xl font-semibold">{detail.title}</h2>
                {kind === 'knowledge-bases' && (
                  <div className="flex items-center gap-3">
                    <span>
                      {label('contentState')}: {label(`state${detail.contentState ?? 'empty'}`)}
                    </span>
                    <Button
                      variant="outline"
                      disabled={detailDisabled || detail.contentState !== 'ready'}
                      onClick={() =>
                        propose(
                          `/api/admin/knowledge-bases/${detail.id}`,
                          'PUT',
                          label(detail.isEnabled ? 'disable' : 'enable'),
                          label('confirmSave'),
                          { isEnabled: !detail.isEnabled }
                        )
                      }
                    >
                      {label(detail.isEnabled ? 'disable' : 'enable')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        detailDisabled ||
                        (detail.sourceType === 'document' && !detail.documents?.length)
                      }
                      onClick={() =>
                        propose(
                          `/api/admin/knowledge-bases/${detail.id}/reprocess`,
                          'POST',
                          label('reprocess'),
                          detail.audience && detail.audience !== 'admin'
                            ? `${label('confirmReprocess')} ${label('audienceWarning')}`
                            : label('confirmReprocess')
                        )
                      }
                    >
                      {label('reprocess')}
                    </Button>
                  </div>
                )}
                {kind === 'knowledge-bases' && detail.contentState === 'error' && (
                  <p role="alert">
                    {label('processingError')}: {processingError(detail.contentError)}
                  </p>
                )}
                <form onSubmit={(event) => void testQuery(event)} className="flex flex-col gap-2">
                  <Label htmlFor="kb-test-query">{label('testQuery')}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id="kb-test-query"
                      maxLength={500}
                      required
                      value={queryText}
                      onChange={(event) => {
                        queryRequest.current?.abort();
                        setQueryState('idle');
                        setQueryResult(null);
                        setQueryText(event.target.value);
                      }}
                    />
                    <Button
                      type="submit"
                      disabled={
                        detailDisabled ||
                        queryState === 'loading' ||
                        (kind === 'knowledge-bases' && detail.contentState !== 'ready')
                      }
                    >
                      {label('runQuery')}
                    </Button>
                  </div>
                </form>
                {queryState === 'loading' && <p role="status">{label('queryLoading')}</p>}
                {queryState === 'error' && <p role="alert">{label('queryError')}</p>}
                {queryResult?.id === detail.id &&
                  (queryResult.rows.length ? (
                    <ol className="divide-y" aria-label={label('queryResults')}>
                      {queryResult.rows.map((item) => (
                        <li key={item.id} className="py-3">
                          <p className="text-sm text-muted-foreground">
                            {item.metadata.fileName ?? item.metadata.url ?? item.kbId}
                            {' · '}
                            {label('relevance')}: {numbers.percent(Math.max(0, item.score))}
                          </p>
                          <p className="whitespace-pre-wrap break-words">{item.excerpt}</p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>{label('noMatches')}</p>
                  ))}
                {kind === 'kb-groups' ? (
                  <>
                    <form
                      className="flex flex-wrap items-end gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (member)
                          propose(
                            `/api/admin/kb-groups/${detail.id}/members`,
                            'POST',
                            label('link'),
                            label('confirmLink'),
                            { kbId: member }
                          );
                      }}
                    >
                      <div className="flex min-w-0 flex-col gap-2">
                        <Label htmlFor="kb-member">{label('selectKb')}</Label>
                        <select
                          id="kb-member"
                          className="max-w-full rounded-md border bg-background p-2"
                          required
                          value={member}
                          onChange={(event) => setMember(event.target.value)}
                        >
                          <option value="">{label('selectKb')}</option>
                          {member &&
                            (!kbs.some((kb) => kb.id === member) ||
                              detail.members?.some((m) => m.id === member)) && (
                              <option value={member}>
                                {label('unavailable')} ({member})
                              </option>
                            )}
                          {kbs
                            .filter(
                              (kb) => !detail.members?.some((existing) => existing.id === kb.id)
                            )
                            .map((kb) => (
                              <option key={kb.id} value={kb.id}>
                                {kb.title}
                              </option>
                            ))}
                        </select>
                      </div>
                      <Button
                        type="submit"
                        disabled={
                          memberDisabled ||
                          !member ||
                          !kbs.some((kb) => kb.id === member) ||
                          !!detail.members?.some((m) => m.id === member)
                        }
                      >
                        {label('link')}
                      </Button>
                    </form>
                    <ul className="divide-y">
                      {detail.members?.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                          <span className="min-w-0 break-words">{item.title}</span>
                          <Button
                            variant="outline"
                            onClick={() =>
                              propose(
                                `/api/admin/kb-groups/${detail.id}/members/${item.id}`,
                                'DELETE',
                                label('unlink'),
                                label('confirmUnlink')
                              )
                            }
                            disabled={detailDisabled}
                            aria-label={`${label('unlink')} ${item.title}`}
                          >
                            {label('unlink')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <h3 className="font-semibold">{label('documents')}</h3>
                    <KnowledgeBaseDocumentPicker
                      key={detail.id}
                      attachedKeys={detail.documents?.map((doc) => doc.storageKey) ?? []}
                      onAttach={((target, version, basis) => (key: string) => {
                        const current = work.current;
                        if (
                          version !== selectionGeneration.current ||
                          target !== current.selected ||
                          !current.detail ||
                          basis !== retrievalBasis(current.detail)
                        )
                          return;
                        propose(
                          `/api/admin/knowledge-bases/${detail.id}/documents`,
                          'POST',
                          label('attach'),
                          detail.audience && detail.audience !== 'admin'
                            ? `${label('confirmAttach')} ${label('audienceWarning')}`
                            : label('confirmAttach'),
                          { storageKey: key }
                        );
                      })(detail.id, selectionGeneration.current, retrievalBasis(detail))}
                    />

                    {!detail.documents?.length && <p>{label('noDocuments')}</p>}
                    <ul className="divide-y">
                      {detail.documents?.map((doc) => (
                        <li key={doc.id} className="flex flex-col gap-1 py-3">
                          <span className="break-words">{doc.fileName}</span>
                          <div>
                            <Button
                              variant="outline"
                              disabled={detailDisabled}
                              aria-label={`${label('detach')} ${doc.fileName}`}
                              onClick={() =>
                                propose(
                                  `/api/admin/knowledge-bases/${detail.id}/documents/${doc.id}`,
                                  'DELETE',
                                  label('detach'),
                                  label('confirmDetach')
                                )
                              }
                            >
                              {label('detach')}
                            </Button>
                          </div>
                          <span>
                            {label(
                              ['pending', 'processing', 'ready', 'failed'].includes(
                                doc.processingStatus
                              )
                                ? doc.processingStatus
                                : 'unknown'
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={commandDisabled(action.path, action.body)}
          summary={recovery}
          onClose={() => {
            generation.current++;
            setAction(null);
          }}
          onSuccess={((command, version) => async () => {
            if (version !== generation.current) return;
            if (command.body && typeof command.body === 'object' && 'title' in command.body) {
              setDraft(null);
              draftBasis.current = null;
            }
            if (command.path.endsWith('/members')) setMember('');
            if (command.method === 'DELETE' && command.path === `/api/admin/${kind}/${selected}`)
              clearDetail();
            setNotice(true);
            list.retry();
            choices.retry();
            selectedRead.retry();
          })(action, commandGeneration.current)}
        />
      )}
    </div>
  );
}

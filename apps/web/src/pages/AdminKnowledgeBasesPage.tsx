import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { KnowledgeBaseDocumentPicker } from '../components/KnowledgeBaseDocumentPicker.js';
import { t } from '@barghsa/i18n/admin-ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
interface Entry {
  id: string;
  title: string;
  description: string;
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
  sourceType: 'document' | 'url' | 'api';
  sourceUrl: string;
  chunkSize: number;
  chunkOverlap: number;
  vectorEmbeddingModel: string;
};
function draftFor(entry?: Entry): Draft {
  return {
    ...(entry ? { id: entry.id } : {}),
    title: entry?.title ?? '',
    description: entry?.description ?? '',
    sourceType: entry?.sourceType ?? 'document',
    sourceUrl: entry?.sourceConfig?.urls?.join('\n') ?? entry?.sourceConfig?.apiUrl ?? '',
    chunkSize: entry?.chunkingStrategy?.size ?? 800,
    chunkOverlap: entry?.chunkingStrategy?.overlap ?? 100,
    vectorEmbeddingModel: entry?.vectorEmbeddingModel ?? '',
  };
}
export default function AdminKnowledgeBasesPage() {
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
  const [kind, setKind] = useState<Kind>('knowledge-bases');
  const [rows, setRows] = useState<Entry[]>([]),
    [kbs, setKbs] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [member, setMember] = useState(''),
    [revision, setRevision] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [action, setAction] = useState<TeamAction | null>(null),
    [notice, setNotice] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [queryState, setQueryState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [queryResult, setQueryResult] = useState<{ id: string; rows: QueryResult[] } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    setRows([]);
    setDetail(null);
    setDraft(null);
    setMember('');
    setQueryResult(null);
    void (async () => {
      try {
        const paths = [
          `/api/admin/${kind}`,
          '/api/admin/knowledge-bases',
          ...(selected ? [`/api/admin/${kind}/${selected}`] : []),
        ];
        const responses = await Promise.all(
          paths.map((path) => fetch(path, { signal: abort.signal }))
        );
        if (responses.some((response) => response.status === 403)) {
          if (!abort.signal.aborted) setState('denied');
          return;
        }
        if (responses.some((response) => !response.ok)) throw new Error('Load failed');
        const data = await Promise.all(responses.map((response) => response.json()));
        if (abort.signal.aborted) return;
        setRows(data[0] as Entry[]);
        setKbs(data[1] as Entry[]);
        setDetail((data[2] as Detail | undefined) ?? null);
        setState('ready');
      } catch {
        if (!abort.signal.aborted) setState('error');
      }
    })();
    return () => abort.abort();
  }, [kind, selected, revision]);
  function propose(
    path: string,
    method: TeamAction['method'],
    title: string,
    description: string,
    body?: unknown
  ) {
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
    if (!draft) return;
    propose(
      `/api/admin/${kind}${draft.id ? `/${draft.id}` : ''}`,
      draft.id ? 'PUT' : 'POST',
      label('save'),
      label('confirmSave'),
      kind === 'kb-groups'
        ? { title: draft.title.trim(), description: draft.description }
        : {
            title: draft.title.trim(),
            description: draft.description,
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
    if (!detail || !queryText.trim()) return;
    const targetId = detail.id;
    setQueryState('loading');
    setQueryResult(null);
    try {
      const response = await fetch(`/api/admin/${kind}/${targetId}/query`, {
        method: 'POST',
        headers: withCsrf({ 'content-type': 'application/json' }),
        body: JSON.stringify({ query: queryText.trim(), limit: 5 }),
      });
      if (!response.ok) throw new Error('Query failed');
      const rows = (await response.json()) as QueryResult[];
      setQueryResult({ id: targetId, rows });
      setQueryState('idle');
    } catch {
      setQueryState('error');
    }
  }
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <div className="flex flex-wrap gap-2">
        {(['knowledge-bases', 'kb-groups'] as const).map((value) => (
          <Button
            key={value}
            variant={kind === value ? 'default' : 'outline'}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setSelected(null);
              setNotice(false);
            }}
          >
            {label(value)}
          </Button>
        ))}
        <Button
          variant="outline"
          onClick={() => {
            setSelected(null);
            setRevision((value) => value + 1);
          }}
        >
          {label('refresh')}
        </Button>
      </div>
      {notice && <p role="status">{label('saved')}</p>}
      {state === 'loading' && <p role="status">{label('loading')}</p>}
      {state === 'denied' && <p role="alert">{label('denied')}</p>}
      {state === 'error' && <p role="alert">{label('error')}</p>}
      {state === 'ready' && (
        <>
          <div>
            <Button onClick={() => setDraft(draftFor())}>
              {label(kind === 'knowledge-bases' ? 'addKb' : 'addGroup')}
            </Button>
          </div>
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
                          <p className="text-sm text-muted-foreground">{label('sourceUrlsHelp')}</p>
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
                <Button type="submit" disabled={!draft.title.trim()}>
                  {label('save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  {label('cancel')}
                </Button>
              </div>
            </form>
          )}
          {!rows.length && <p>{label('empty')}</p>}
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
                    <p className="text-sm text-muted-foreground">
                      {label('contentState')}: {label(`state${row.contentState ?? 'empty'}`)}
                      {' · '}
                      {label(row.isEnabled ? 'enabled' : 'disabled')}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setSelected(row.id)}
                    aria-label={`${label('open')} ${row.title}`}
                  >
                    {label('open')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setDraft(draftFor(row))}
                    aria-label={`${label('edit')} ${row.title}`}
                  >
                    {label('edit')}
                  </Button>
                  <Button
                    variant="outline"
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
                    disabled={detail.contentState !== 'ready'}
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
                    disabled={detail.sourceType === 'document' && !detail.documents?.length}
                    onClick={() =>
                      propose(
                        `/api/admin/knowledge-bases/${detail.id}/reprocess`,
                        'POST',
                        label('reprocess'),
                        label('confirmReprocess')
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
                    onChange={(event) => setQueryText(event.target.value)}
                  />
                  <Button
                    type="submit"
                    disabled={
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
                    <Button type="submit" disabled={!member}>
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
                    key={`${detail.id}:${revision}`}
                    attachedKeys={detail.documents?.map((doc) => doc.storageKey) ?? []}
                    onAttach={(key) =>
                      propose(
                        `/api/admin/knowledge-bases/${detail.id}/documents`,
                        'POST',
                        label('attach'),
                        label('confirmAttach'),
                        { storageKey: key }
                      )
                    }
                  />

                  {!detail.documents?.length && <p>{label('noDocuments')}</p>}
                  <ul className="divide-y">
                    {detail.documents?.map((doc) => (
                      <li key={doc.id} className="flex flex-col gap-1 py-3">
                        <span className="break-words">{doc.fileName}</span>
                        <div>
                          <Button
                            variant="outline"
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
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            if (action.method === 'DELETE' && action.path === `/api/admin/${kind}/${selected}`)
              setSelected(null);
            setNotice(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}

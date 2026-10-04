import {
  matchesKnowledgeDocumentReceipt,
  matchesKnowledgeDocuments,
  validCatalogueCount,
  type KnowledgeDocumentCommand,
} from '../lib/knowledge-documents.js';
import { CatalogueRelationEditor } from '../components/CatalogueRelationEditor.js';
import {
  matchesMembership,
  memberIdsBasis,
  type MembershipCommand,
} from '../lib/catalogue-membership.js';
import { CatalogueQueryEditor } from '../components/CatalogueQueryEditor.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import {
  type KnowledgeDraft as Draft,
  invalidKnowledgeFields,
  knowledgeBody,
  matchesAiCatalogueReceipt,
} from '../lib/knowledge-policy-form.js';
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
        ['documentCount', 'memberCount'].every((k) => validCatalogueCount(v[k])) &&
        (v.audience === undefined ||
          ['admin', 'staff', 'customer', 'public'].includes(v.audience as string)) &&
        (v.sourceType === undefined ||
          ['document', 'url', 'api'].includes(v.sourceType as string)) &&
        (v.contentState === undefined ||
          ['empty', 'processing', 'ready', 'error'].includes(v.contentState as string)) &&
        (v.isEnabled === undefined || typeof v.isEnabled === 'boolean') &&
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
    chunkSize: String(entry?.chunkingStrategy?.size ?? 800),
    chunkOverlap: String(entry?.chunkingStrategy?.overlap ?? 100),
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
  const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
    knowledgePolicyFormText(key, locale);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const messages = Object.fromEntries(
    Object.keys(draftFor()).map((key) => [key, copy(key as Parameters<typeof copy>[0])])
  ) as Record<keyof Draft, string>;
  messages.id = copy('invalid');
  const form = useWizardForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema(messages, (value) => invalidKnowledgeFields(value, kindRef.current));
    },
    draftFor,
    copy('unavailable')
  );
  const ownedFields = useActionFieldErrors(form.form, messages, copy('invalid'));
  const [draftOpen, setDraftOpen] = useState(false);
  const draft = draftOpen ? form.values : null;
  const resetForm = form.form.reset;
  const setDraft = useCallback(
    (value: Draft | null) => {
      resetForm(value ?? draftFor());
      setDraftOpen(!!value);
    },
    [resetForm]
  );
  const [changed, setChanged] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [pending, setPending] = useState(false);
  const validationBusy = useRef(false),
    networkPending = useRef(false),
    requiredRead = useRef(0);
  const formCapture = useRef<{ body: Record<string, unknown>; id?: string } | null>(null);
  const actionRef = useRef<TeamAction | null>(null);
  const operationCapture = useRef<MembershipCommand | null>(null),
    uncertainOperation = useRef<MembershipCommand | KnowledgeDocumentCommand | null>(null);
  const documentCapture = useRef<KnowledgeDocumentCommand | null>(null);
  const requiredOperationRead = useRef<{ detail: number; choices: number | null }>({
    detail: 0,
    choices: null,
  });
  const [operationUncertain, setOperationUncertain] = useState(false);
  const setAction = useCallback((value: TeamAction | null) => {
    actionRef.current = value;
    if (!value) {
      formCapture.current = null;
      operationCapture.current = null;
      documentCapture.current = null;
    }
    updateAction(value);
  }, []);
  const onPendingChange = useCallback((value: boolean) => {
    networkPending.current = value;
    setPending(value);
  }, []);

  const [selected, setSelected] = useState<string | null>(null);
  const [member, setMember] = useState('');
  const [action, updateAction] = useState<TeamAction | null>(null),
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
    setOperationUncertain(false);
    uncertainOperation.current = null;
    requiredOperationRead.current = { detail: 0, choices: null };
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
  }, [setAction]);
  const clearWork = useCallback(() => {
    clearDetail();
    setDraft(null);
    setNotice(false);
    draftBasis.current = null;
    setChanged(false);
    setUncertain(false);
    requiredRead.current = 0;
    formCapture.current = null;
    validationBusy.current = false;
    form.setValidationPending(false);
    onPendingChange(false);
  }, [clearDetail, setAction, setDraft, form.setValidationPending, onPendingChange]);
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
        setChanged(true);
        setAction(null);
        validationBusy.current = false;
        form.setValidationPending(false);
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
  }, [list.data, clearDetail, setAction, form.setValidationPending]);
  useEffect(() => {
    if (!selectedRead.data) return;
    const next = retrievalBasis(selectedRead.data);
    if (detailBasis.current && detailBasis.current !== next) {
      generation.current++;
      queryRequest.current?.abort();
      setQueryResult(null);
      setQueryState('idle');
      if (!formCapture.current) setAction(null);
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
    if (
      disabled ||
      value === selected ||
      networkPending.current ||
      actionRef.current ||
      validationBusy.current
    )
      return;
    clearDetail();
    setSelected(value);
  }
  function edit(entry?: Entry) {
    if (
      disabled ||
      networkPending.current ||
      validationBusy.current ||
      actionRef.current ||
      uncertain
    )
      return;
    generation.current++;
    formCapture.current = null;
    setChanged(false);
    commandTarget.current = null;
    setAction(null);
    setDraft(draftFor(entry));
    draftBasis.current = entry ? JSON.stringify(draftFor(entry)) : null;
    setNotice(false);
  }
  function refresh() {
    if (networkPending.current) return;
    if (validationBusy.current) {
      generation.current++;
      validationBusy.current = false;
      form.setValidationPending(false);
    }
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
        disabled={pending || list.loading || choices.loading || selectedRead.loading}
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
    if (
      operationUncertain ||
      commandDisabled(path, body) ||
      actionRef.current ||
      validationBusy.current ||
      networkPending.current
    )
      return;
    const target = rows.find((row) => path === `/api/admin/${kind}/${row.id}`);
    commandTarget.current = target
      ? { id: target.id, basis: JSON.stringify(draftFor(target)) }
      : null;
    commandGeneration.current = generation.current;
    setNotice(false);
    setAction({
      path,
      method,
      ...(formCapture.current
        ? { successStatus: method === 'POST' ? 201 : 200, conflictMessage: copy('changed') }
        : {}),
      ...(operationCapture.current ? { successStatus: 204, conflictMessage: copy('changed') } : {}),
      ...(documentCapture.current ? { successStatus: method === 'POST' ? 200 : 204 } : {}),
      title,
      description,
      ...(body === undefined ? {} : { body }),
      forbiddenMessage: label('denied'),
      errorMessages: { 'VALIDATION:PARSE:ZOD_ERROR': label('invalid') },
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      !draft ||
      disabled ||
      changed ||
      uncertain ||
      actionRef.current ||
      validationBusy.current ||
      networkPending.current
    )
      return;
    const epoch = ++generation.current;
    validationBusy.current = true;
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit((value) => {
        if (epoch !== generation.current || work.current.disabled || actionRef.current || uncertain)
          return;
        validationBusy.current = false;
        const body = knowledgeBody(value, kindRef.current);
        formCapture.current = { body, ...(value.id ? { id: value.id } : {}) };
        propose(
          `/api/admin/${kind}${value.id ? `/${value.id}` : ''}`,
          value.id ? 'PUT' : 'POST',
          label('save'),
          kind === 'knowledge-bases' && value.audience !== 'admin'
            ? `${label('confirmSave')} ${label('audienceWarning')}`
            : label('confirmSave'),
          body
        );
      })();
    } finally {
      if (epoch === generation.current) {
        validationBusy.current = false;
        form.setValidationPending(false);
      }
    }
  }
  function unconfirmed() {
    if (operationCapture.current || documentCapture.current) {
      const operation = (operationCapture.current ?? documentCapture.current)!;
      uncertainOperation.current = operation;
      setOperationUncertain(true);
      generation.current++;
      setAction(null);
      onPendingChange(false);
      requiredOperationRead.current = {
        detail: selectedRead.retry(),
        choices: operation.choicesRequired ? choices.retry() : null,
      };
      return;
    }
    if (!formCapture.current) return;
    setUncertain(true);
    generation.current++;
    setAction(null);
    onPendingChange(false);
    requiredRead.current = list.retry();
  }
  const operationResetDisabled =
    !operationUncertain ||
    !!action ||
    pending ||
    detailDisabled ||
    selectedRead.readAttempt === null ||
    selectedRead.readAttempt < requiredOperationRead.current.detail ||
    (requiredOperationRead.current.choices !== null &&
      (choices.loading ||
        choices.error ||
        choices.readAttempt === null ||
        choices.readAttempt < requiredOperationRead.current.choices));
  const operationRecovery = operationUncertain && (
    <div className="space-y-2">
      <p role="alert">{copy('uncertain')}</p>
      <Button
        type="button"
        variant="outline"
        disabled={operationResetDisabled}
        onClick={() => {
          if (operationResetDisabled) return;
          uncertainOperation.current?.owner?.reset();
          uncertainOperation.current = null;
          setOperationUncertain(false);
        }}
      >
        {copy('reset')}
      </Button>
    </div>
  );
  function proposeMembership(
    operation: MembershipCommand,
    method: 'POST' | 'DELETE',
    body?: unknown
  ) {
    if (
      operationUncertain ||
      actionRef.current ||
      validationBusy.current ||
      networkPending.current ||
      work.current.selected !== operation.groupId ||
      (operation.choicesRequired ? work.current.memberDisabled : work.current.detailDisabled)
    )
      return;
    operationCapture.current = operation;
    propose(
      `/api/admin/kb-groups/${operation.groupId}/members${method === 'DELETE' ? `/${operation.memberId}` : ''}`,
      method,
      label(method === 'DELETE' ? 'unlink' : operation.choicesRequired ? 'link' : 'updatePriority'),
      label(
        method === 'DELETE'
          ? 'confirmUnlink'
          : operation.choicesRequired
            ? 'confirmLink'
            : 'confirmPriority'
      ),
      body
    );
  }
  const resetDisabled =
    disabled ||
    !!action ||
    form.pending ||
    pending ||
    (uncertain && (list.readAttempt === null || list.readAttempt < requiredRead.current));
  function resetDraft() {
    if (resetDisabled || !draft) return;
    generation.current++;
    const fresh = draft.id ? rows.find((row) => row.id === draft.id) : undefined;
    setDraft(draft.id && !fresh ? null : draftFor(fresh));
    draftBasis.current = fresh ? JSON.stringify(draftFor(fresh)) : null;
    setChanged(false);
    setUncertain(false);
    formCapture.current = null;
    setNotice(false);
  }
  async function testQuery(query: string, fields: (value: unknown[]) => boolean) {
    if (!detail || detailDisabled || actionRef.current || networkPending.current) return;
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
        body: JSON.stringify({ query, limit: 5 }),
      });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        scope.deny();
        return;
      }
      if (response.status === 400) {
        const value: unknown = await response.json();
        if (!current()) return;
        if (
          record(value) &&
          record(value.error) &&
          value.error.code === 'VALIDATION:INPUT:INVALID' &&
          Array.isArray(value.error.fields) &&
          fields(value.error.fields)
        ) {
          setQueryState('idle');
          return;
        }
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
            disabled={pending}
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
          disabled={pending || list.loading || choices.loading || selectedRead.loading}
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
              <Button
                disabled={disabled || form.pending || !!action || pending || uncertain}
                onClick={() => edit()}
              >
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
                noValidate
                aria-busy={form.pending || undefined}
                onSubmit={(event) => void save(event)}
                aria-label={label('editor')}
                className="flex flex-col gap-4 border-y py-5"
              >
                {changed && <p role="alert">{copy('changed')}</p>}
                {uncertain && <p role="alert">{copy('uncertain')}</p>}
                {catalogueRootMessage(form.errors) && (
                  <p role="alert">{catalogueRootMessage(form.errors)}</p>
                )}
                <fieldset disabled={form.pending || !!action || pending} className="contents">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="kb-title">{label('name')}</Label>
                    <Input
                      {...form.bind('title')}
                      id="kb-title"
                      required
                      maxLength={120}
                      value={draft.title}
                      onChange={(event) =>
                        form.field('title')[1](event.target.value as Draft['title'])
                      }
                    />
                    <CatalogueFieldFeedback
                      id={form.errorId('title')}
                      error={form.errors.title}
                      message={messages.title}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="kb-description">{label('description')}</Label>
                    <textarea
                      {...form.bind('description')}
                      id="kb-description"
                      className="min-h-24 rounded-md border bg-background p-3"
                      maxLength={2000}
                      value={draft.description}
                      onChange={(event) =>
                        form.field('description')[1](event.target.value as Draft['description'])
                      }
                    />
                    <CatalogueFieldFeedback
                      id={form.errorId('description')}
                      error={form.errors.description}
                      message={messages.description}
                    />
                  </div>
                  {kind === 'knowledge-bases' && (
                    <>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="kb-audience">{label('audience')}</Label>
                        <select
                          {...form.bind('audience')}
                          id="kb-audience"
                          className="rounded-md border bg-background p-2"
                          value={draft.audience}
                          onChange={(event) =>
                            form.field('audience')[1](event.target.value as Draft['audience'])
                          }
                        >
                          {(['admin', 'staff', 'customer', 'public'] as const).map((value) => (
                            <option key={value} value={value}>
                              {label(`audience${value}`)}
                            </option>
                          ))}
                        </select>
                        <CatalogueFieldFeedback
                          id={form.errorId('audience')}
                          error={form.errors.audience}
                          message={messages.audience}
                        />
                        <p className="text-sm text-muted-foreground">{label('audienceHelp')}</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="kb-source-type">{label('sourceType')}</Label>
                        <select
                          {...form.bind('sourceType')}
                          id="kb-source-type"
                          className="rounded-md border bg-background p-2"
                          value={draft.sourceType}
                          onChange={(event) => {
                            form.field('sourceType')[1](event.target.value as Draft['sourceType']);
                            form.form.clearErrors('sourceUrl');
                          }}
                        >
                          <option value="document">{label('sourceDocument')}</option>
                          <option value="url">{label('sourceUrl')}</option>
                          <option value="api">{label('sourceApi')}</option>
                        </select>
                        <CatalogueFieldFeedback
                          id={form.errorId('sourceType')}
                          error={form.errors.sourceType}
                          message={messages.sourceType}
                        />
                      </div>
                      {draft.sourceType !== 'document' && (
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="kb-source-url">{label('sourceAddress')}</Label>
                          {draft.sourceType === 'url' ? (
                            <>
                              <textarea
                                {...form.bind('sourceUrl')}
                                id="kb-source-url"
                                required
                                maxLength={40960}
                                rows={3}
                                className="rounded-md border bg-background p-3"
                                value={draft.sourceUrl}
                                onChange={(event) =>
                                  form.field('sourceUrl')[1](
                                    event.target.value as Draft['sourceUrl']
                                  )
                                }
                              />
                              <CatalogueFieldFeedback
                                id={form.errorId('sourceUrl')}
                                error={form.errors.sourceUrl}
                                message={messages.sourceUrl}
                              />
                              <p className="text-sm text-muted-foreground">
                                {label('sourceUrlsHelp')}
                              </p>
                            </>
                          ) : (
                            <>
                              <Input
                                {...form.bind('sourceUrl')}
                                id="kb-source-url"
                                type="url"
                                required
                                maxLength={2048}
                                placeholder="https://"
                                value={draft.sourceUrl}
                                onChange={(event) =>
                                  form.field('sourceUrl')[1](
                                    event.target.value as Draft['sourceUrl']
                                  )
                                }
                              />
                              <CatalogueFieldFeedback
                                id={form.errorId('sourceUrl')}
                                error={form.errors.sourceUrl}
                                message={messages.sourceUrl}
                              />
                            </>
                          )}
                        </div>
                      )}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="kb-chunk-size">{label('chunkSize')}</Label>
                          <Input
                            {...form.bind('chunkSize')}
                            id="kb-chunk-size"
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            min={100}
                            max={4000}
                            required
                            value={draft.chunkSize}
                            onChange={(event) =>
                              form.field('chunkSize')[1](event.target.value as Draft['chunkSize'])
                            }
                          />
                          <CatalogueFieldFeedback
                            id={form.errorId('chunkSize')}
                            error={form.errors.chunkSize}
                            message={messages.chunkSize}
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="kb-chunk-overlap">{label('chunkOverlap')}</Label>
                          <Input
                            {...form.bind('chunkOverlap')}
                            id="kb-chunk-overlap"
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            min={0}
                            max={1000}
                            required
                            value={draft.chunkOverlap}
                            onChange={(event) =>
                              form.field('chunkOverlap')[1](
                                event.target.value as Draft['chunkOverlap']
                              )
                            }
                          />
                          <CatalogueFieldFeedback
                            id={form.errorId('chunkOverlap')}
                            error={form.errors.chunkOverlap}
                            message={messages.chunkOverlap}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="kb-embedding-model">{label('embeddingModel')}</Label>
                        <Input
                          {...form.bind('vectorEmbeddingModel')}
                          id="kb-embedding-model"
                          maxLength={120}
                          value={draft.vectorEmbeddingModel}
                          onChange={(event) =>
                            form.field('vectorEmbeddingModel')[1](
                              event.target.value as Draft['vectorEmbeddingModel']
                            )
                          }
                        />
                        <CatalogueFieldFeedback
                          id={form.errorId('vectorEmbeddingModel')}
                          error={form.errors.vectorEmbeddingModel}
                          message={messages.vectorEmbeddingModel}
                        />
                      </div>
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={resetDisabled}
                      onClick={resetDraft}
                    >
                      {copy('reset')}
                    </Button>
                    <CatalogueSaveButton
                      label={label('save')}
                      pending={form.pending}
                      disabled={disabled || changed || uncertain}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uncertain}
                      onClick={() => setDraft(null)}
                    >
                      {label('cancel')}
                    </Button>
                  </div>
                </fieldset>
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
                        {(kind === 'knowledge-bases' ? row.documentCount : row.memberCount) ===
                        undefined
                          ? '—'
                          : numbers.number(
                              (kind === 'knowledge-bases' ? row.documentCount : row.memberCount)!
                            )}
                      </p>
                      {kind === 'knowledge-bases' && (
                        <div className="space-y-1 text-sm text-muted-foreground">
                          <p>
                            {label('contentState')}:{' '}
                            {row.contentState === undefined
                              ? label('unknown')
                              : label(`state${row.contentState}`)}
                            {' · '}
                            {row.isEnabled === undefined
                              ? label('unknown')
                              : label(row.isEnabled ? 'enabled' : 'disabled')}
                          </p>
                          <p>
                            {label('audience')}:{' '}
                            {row.audience === undefined
                              ? label('unknown')
                              : label(`audience${row.audience}`)}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={disabled || form.pending || !!action || pending}
                        onClick={() => open(row.id)}
                        aria-label={`${label('open')} ${row.title}`}
                      >
                        {label('open')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={disabled || form.pending || !!action || pending}
                        onClick={() => edit(row)}
                        aria-label={`${label('edit')} ${row.title}`}
                      >
                        {label('edit')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={disabled || form.pending || !!action || pending}
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
                <CatalogueQueryEditor
                  key={detail.id}
                  locale={locale}
                  value={queryText}
                  epoch={generation.current}
                  disabled={
                    detailDisabled ||
                    !!action ||
                    pending ||
                    (kind === 'knowledge-bases' && detail.contentState !== 'ready')
                  }
                  label={label('testQuery')}
                  saveLabel={label('runQuery')}
                  onChange={(value) => {
                    queryRequest.current?.abort();
                    setQueryState('idle');
                    setQueryResult(null);
                    setQueryText(value);
                  }}
                  onQuery={testQuery}
                />
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
                {operationRecovery}
                {kind === 'kb-groups' ? (
                  <>
                    <CatalogueRelationEditor
                      key={detail.id}
                      mode="kb"
                      locale={locale}
                      id="kb-member"
                      value={member}
                      basis={memberIdsBasis(detail.members ?? [])}
                      epoch={generation.current}
                      options={kbs.filter(
                        (kb) => !detail.members?.some((existing) => existing.id === kb.id)
                      )}
                      disabled={
                        memberDisabled || !!action || pending || form.pending || operationUncertain
                      }
                      labels={{
                        member: label('selectKb'),
                        priority: '',
                        inherit: '',
                        save: label('link'),
                        unavailable: label('unavailable'),
                      }}
                      onChange={(value) => setMember(value)}
                      onSubmit={(value, owner) =>
                        proposeMembership(
                          {
                            groupId: detail.id,
                            memberId: value.memberId,
                            expected: 'present',
                            choicesRequired: true,
                            owner,
                          },
                          'POST',
                          { kbId: value.memberId }
                        )
                      }
                    />
                    <ul className="divide-y">
                      {detail.members?.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                          <span className="min-w-0 break-words">{item.title}</span>
                          <Button
                            variant="outline"
                            onClick={() =>
                              proposeMembership(
                                {
                                  groupId: detail.id,
                                  memberId: item.id,
                                  expected: 'absent',
                                  choicesRequired: false,
                                },
                                'DELETE'
                              )
                            }
                            disabled={detailDisabled || !!action || pending || operationUncertain}
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
                    {(detail.sourceType === 'url' || detail.sourceType === 'api') && (
                      <p className="text-sm text-muted-foreground">{copy('documentSource')}</p>
                    )}
                    <KnowledgeBaseDocumentPicker
                      key={detail.id}
                      attachedKeys={detail.documents?.map((doc) => doc.storageKey) ?? []}
                      disabled={
                        detailDisabled ||
                        !!action ||
                        pending ||
                        form.pending ||
                        operationUncertain ||
                        detail.sourceType === 'url' ||
                        detail.sourceType === 'api'
                      }
                      onDenied={scope.deny}
                      onAttach={((target, version, basis) => (key, owner) => {
                        const current = work.current;
                        if (
                          version !== selectionGeneration.current ||
                          target !== current.selected ||
                          !current.detail ||
                          basis !== retrievalBasis(current.detail) ||
                          current.detailDisabled ||
                          actionRef.current ||
                          networkPending.current ||
                          operationUncertain
                        )
                          return;
                        documentCapture.current = {
                          kbId: target,
                          storageKey: key,
                          expected: 'present',
                          choicesRequired: false,
                          owner,
                        };
                        propose(
                          `/api/admin/knowledge-bases/${target}/documents`,
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
                              disabled={detailDisabled || !!action || pending || operationUncertain}
                              aria-label={`${label('detach')} ${doc.fileName}`}
                              onClick={() => {
                                if (
                                  detailDisabled ||
                                  actionRef.current ||
                                  networkPending.current ||
                                  operationUncertain
                                )
                                  return;
                                documentCapture.current = {
                                  kbId: detail.id,
                                  documentId: doc.id,
                                  storageKey: doc.storageKey,
                                  expected: 'absent',
                                  choicesRequired: false,
                                };
                                propose(
                                  `/api/admin/knowledge-bases/${detail.id}/documents/${doc.id}`,
                                  'DELETE',
                                  label('detach'),
                                  label('confirmDetach')
                                );
                              }}
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
          confirmationDisabled={
            operationUncertain ||
            commandDisabled(action.path, action.body) ||
            (!!formCapture.current && (changed || uncertain))
          }
          onPendingChange={onPendingChange}
          onDenied={scope.deny}
          onValidationError={(fields) =>
            (operationCapture.current?.owner ?? documentCapture.current?.owner)?.fields(fields) ??
            (formCapture.current ? ownedFields(fields) : false)
          }
          onUnconfirmed={unconfirmed}
          summary={recovery}
          onClose={() => {
            generation.current++;
            setAction(null);
            onPendingChange(false);
          }}
          onSuccess={((command, version) => async (value: unknown) => {
            if (actionRef.current !== command) return;
            const operation = operationCapture.current;
            if (operation) {
              const response = await fetch(`/api/admin/kb-groups/${operation.groupId}`, {
                credentials: 'include',
              });
              if (actionRef.current !== command) return;
              if (response.status === 401 || response.status === 403) {
                scope.deny();
                return;
              }
              if (response.status !== 200) throw new Error('Unconfirmed group membership');
              const fresh: unknown = await response.json();
              if (actionRef.current !== command) return;
              if (!validateDetail(fresh) || !matchesMembership(fresh, operation))
                throw new Error('Unconfirmed group membership');
              if (!selectedRead.accept(fresh)) throw new Error('Obsolete group membership');
              operation.owner?.verified(memberIdsBasis(fresh.members ?? []));
              operationCapture.current = null;
              setAction(null);
              onPendingChange(false);
              setNotice(true);
              list.retry();
              choices.retry();
              return;
            }
            const document = documentCapture.current;
            if (document) {
              if (document.expected === 'present') {
                if (!matchesKnowledgeDocumentReceipt(value, document))
                  throw new Error('Unconfirmed document attachment');
                document.documentId = value.id;
              }
              const response = await fetch(`/api/admin/knowledge-bases/${document.kbId}`, {
                credentials: 'include',
              });
              if (actionRef.current !== command) return;
              if (response.status === 401 || response.status === 403) {
                scope.deny();
                return;
              }
              if (response.status !== 200) throw new Error('Unconfirmed document catalogue');
              const fresh: unknown = await response.json();
              if (actionRef.current !== command) return;
              if (!validateDetail(fresh) || !matchesKnowledgeDocuments(fresh, document))
                throw new Error('Unconfirmed document catalogue');
              if (!selectedRead.accept(fresh)) throw new Error('Obsolete document catalogue');
              document.owner?.verified('');
              setAction(null);
              onPendingChange(false);
              setNotice(true);
              list.retry();
              return;
            }
            const captured = formCapture.current;
            if (version !== generation.current && !captured) return;
            if (captured && !matchesAiCatalogueReceipt(value, captured.body, captured.id))
              throw new Error('Unconfirmed catalogue settings');
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

import {
  ChevronDownIcon,
  Eye as TableEyeIcon,
  Pencil as TablePencilIcon,
  Trash2 as TableTrash2Icon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import type { CatalogueRecordWorkspace } from '../lib/catalogue-workspace.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useCatalogueConfirmationRead } from '../hooks/useCatalogueConfirmationRead.js';
import {
  matchesKnowledgeDocumentReceipt,
  matchesKnowledgeDocuments,
  validCatalogueCount,
  type KnowledgeDocumentCommand,
} from '../lib/knowledge-documents.js';
import {
  CatalogueMembershipReview,
  CatalogueRelationEditor,
  type ReviewedMembershipCommand,
} from '../components/CatalogueRelationEditor.js';
import { CatalogueRecordTable } from '../components/CatalogueRecordTable.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import {
  matchesMembership,
  memberIdsBasis,
  type MembershipCommand,
} from '../lib/catalogue-membership.js';
import { CatalogueQueryEditor } from '../components/CatalogueQueryEditor.js';
import { boundedCatalogueInteger } from '../lib/catalogue-form.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { FormField } from '@barghsa/ui/form';
import { RecordListField } from '../components/RecordListField.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import {
  type KnowledgeDraft as Draft,
  invalidKnowledgeFields,
  knowledgeBody,
  matchesAiCatalogueReceipt,
} from '../lib/knowledge-policy-form.js';
import type { KnowledgeCatalogueKind } from '../lib/catalogue-category-query.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useEffect, useState, useRef, useCallback, useMemo, type FormEvent } from 'react';
import {
  Badge,
  Alert,
  LoadingStatus,
  Button,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  NativeSelect,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { toast } from '../lib/toast-api.js';
import { KnowledgeBaseDocumentPicker } from '../components/KnowledgeBaseDocumentPicker.js';
import { t } from '@barghsa/i18n/admin-ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';
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
type DocumentReview = KnowledgeDocumentCommand & { fileName: string; baseTitle: string };
type IndexReview = { title: string; source: string; state: string };
type KnowledgeAction = TeamAction & { indexReview?: IndexReview };
interface Detail extends Entry {
  members?: { id: string; title: string }[];
  groups?: { id: string; title: string }[];
  documents?: KnowledgeDocument[];
}
interface KnowledgeDocument {
  id: string;
  fileName: string;
  storageKey: string;
  processingStatus: string;
  processingError?: string | null;
  sizeBytes?: number | string | null;
  mimeType?: string | null;
  updatedAt?: string;
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
    (value.groups === undefined ||
      (Array.isArray(value.groups) &&
        value.groups.every(
          (v) => record(v) && typeof v.id === 'string' && typeof v.title === 'string'
        ))) &&
    (value.documents === undefined ||
      (Array.isArray(value.documents) &&
        value.documents.every(
          (v) =>
            record(v) &&
            ['id', 'fileName', 'storageKey', 'processingStatus'].every(
              (k) => typeof v[k] === 'string'
            ) &&
            ['mimeType', 'processingError'].every(
              (key) => v[key] === undefined || v[key] === null || typeof v[key] === 'string'
            ) &&
            (v.updatedAt === undefined || typeof v.updatedAt === 'string') &&
            (v.sizeBytes === undefined ||
              v.sizeBytes === null ||
              ((typeof v.sizeBytes === 'number' ||
                (typeof v.sizeBytes === 'string' && /^\d+$/.test(v.sizeBytes))) &&
                Number.isSafeInteger(Number(v.sizeBytes)) &&
                Number(v.sizeBytes) >= 0))
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
type CataloguePageProps = {
  workspace?: CatalogueRecordWorkspace;
  initialKind?: KnowledgeCatalogueKind;
  focusCategory?: boolean;
  onKindChange?: (value: KnowledgeCatalogueKind) => void;
};
export default function AdminKnowledgeBasesPage(props: CataloguePageProps = {}) {
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  return <OwnedKnowledgeBasesPage key={JSON.stringify([actor, contextRevision])} {...props} />;
}
function OwnedKnowledgeBasesPage({
  initialKind = 'knowledge-bases',
  onKindChange,
  focusCategory = false,
  workspace,
}: CataloguePageProps = {}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const time = useAccountTime(locale);
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
  const recordId = workspace?.recordId;
  const isList = !workspace || workspace.view === 'list';
  const heading = useRef<HTMLHeadingElement>(null);
  const passageSettings = useRef<HTMLDetailsElement>(null);
  const editorInitialized = useRef(false);
  const linkTo = (id: string, action?: 'edit' | 'documents' | 'ingestion') => ({
    to:
      kind === 'kb-groups'
        ? ('/admin/knowledge-bases/groups/$recordId/{-$action}' as const)
        : ('/admin/knowledge-bases/$recordId/{-$action}' as const),
    params: { recordId: id, action },
  });
  const listSearch = kind === 'kb-groups' ? { kind: 'kb-groups' as const } : {};
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
  const passageSize = draft ? boundedCatalogueInteger(draft.chunkSize, 100, 4000) : null;
  const passageOverlap = draft ? boundedCatalogueInteger(draft.chunkOverlap, 0, 1000) : null;
  const passageSummary =
    passageSize === null ||
    passageOverlap === null ||
    passageOverlap >= passageSize ||
    form.errors.chunkSize ||
    form.errors.chunkOverlap
      ? copy('reviewPassageSettings')
      : copy('passageSummary')
          .replace('{size}', numbers.number(passageSize))
          .replace('{overlap}', numbers.number(passageOverlap));
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
  const operationCapture = useRef<ReviewedMembershipCommand | null>(null),
    uncertainOperation = useRef<ReviewedMembershipCommand | DocumentReview | null>(null);
  const documentCapture = useRef<DocumentReview | null>(null);
  const requiredOperationRead = useRef<{ detail: number; choices: number | null }>({
    detail: 0,
    choices: null,
  });
  const [operationUncertain, setOperationUncertain] = useState(false);
  const setAction = useCallback((value: KnowledgeAction | null) => {
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

  const [localSelected, setSelected] = useState<string | null>(null);
  const selected = recordId ?? localSelected;
  const [member, setMember] = useState('');
  const [action, updateAction] = useState<KnowledgeAction | null>(null),
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
    editorInitialized.current = false;
  }, [clearDetail, setAction, setDraft, form.setValidationPending, onPendingChange]);
  const scope = useCatalogueScope(clearWork);
  const confirmationRead = useCatalogueConfirmationRead(scope);
  const collection = useCatalogueResource(
    scope,
    recordId ? null : `/api/admin/${kind}`,
    validEntries
  );
  const choices = useCatalogueResource(
    scope,
    kind === 'kb-groups' && (isList || workspace?.view === 'detail')
      ? '/api/admin/knowledge-bases'
      : null,
    validEntries
  );
  const validateDetail = useCallback(
    (value: unknown): value is Detail => validDetail(value) && value.id === selected,
    [selected]
  );
  const selectedRead = useCatalogueResource(
    scope,
    selected ? `/api/admin/${kind}/${encodeURIComponent(selected)}` : null,
    validateDetail,
    { clearOnMissing: true }
  );
  const singleRow = useMemo(
    () => (selectedRead.data ? [selectedRead.data] : null),
    [selectedRead.data]
  );
  const list = recordId ? { ...selectedRead, data: singleRow } : collection;
  const rows = list.data ?? [],
    kbs = kind === 'knowledge-bases' ? rows : (choices.data ?? []),
    detail = selectedRead.data;
  const disabled = scope.denied || list.loading || list.error;
  useEffect(() => {
    if (workspace?.view !== 'list') heading.current?.focus({ preventScroll: true });
  }, [workspace?.view, recordId]);
  useEffect(() => {
    if (disabled || editorInitialized.current) return;
    if (workspace?.view === 'create') edit(undefined, false);
    else if (workspace?.view === 'edit' && detail) edit(detail, false);
    else return;
    editorInitialized.current = true;
  }, [disabled, workspace?.view, detail]);
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
    if (current.selected && !list.data.some((row) => row.id === current.selected)) {
      clearDetail();
    }
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
  function edit(entry?: Entry, publish = true) {
    if (
      publish &&
      (disabled ||
        networkPending.current ||
        validationBusy.current ||
        actionRef.current ||
        uncertain)
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
      if (!recordId) selectedRead.retry();
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
      {list.loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
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
    body?: unknown,
    indexReview?: IndexReview
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
      ...(method === 'PUT' && record(body) && body.isEnabled === false
        ? { risk: 'destructive' as const }
        : {}),
      ...(formCapture.current
        ? { successStatus: method === 'POST' ? 201 : 200, conflictMessage: copy('changed') }
        : {}),
      ...(operationCapture.current ? { successStatus: 204, conflictMessage: copy('changed') } : {}),
      ...(documentCapture.current ? { successStatus: method === 'POST' ? 200 : 204 } : {}),
      title,
      description,
      ...(body === undefined ? {} : { body }),
      ...(indexReview ? { indexReview } : {}),
      forbiddenMessage: label('denied'),
      errorMessages: { 'VALIDATION:PARSE:ZOD_ERROR': label('invalid') },
    });
  }
  function revealPassageErrors(fields: unknown[]) {
    if (
      passageSettings.current &&
      fields.some((field) => field === 'chunkSize' || field === 'chunkOverlap')
    ) {
      passageSettings.current.open = true;
    }
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
      await form.form.handleSubmit(
        (value) => {
          if (
            epoch !== generation.current ||
            work.current.disabled ||
            actionRef.current ||
            uncertain
          )
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
        },
        (errors) => {
          if (epoch === generation.current) revealPassageErrors(Object.keys(errors));
        }
      )();
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
  const reviewDocument = ({ fileName, baseTitle }: DocumentReview) => (
    <dl className="grid min-w-0 gap-3 rounded-lg border bg-muted/25 px-3 py-2.5 sm:grid-cols-2">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label('searchFiles')}</dt>
        <dd className="text-sm font-medium [overflow-wrap:anywhere]">
          <bdi>{fileName}</bdi>
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{copy('documentTarget')}</dt>
        <dd className="text-sm font-medium [overflow-wrap:anywhere]">
          <bdi>{baseTitle}</bdi>
        </dd>
      </div>
    </dl>
  );
  const uncertainDocument =
    uncertainOperation.current && 'fileName' in uncertainOperation.current
      ? uncertainOperation.current
      : null;
  const uncertainMember =
    uncertainOperation.current && 'memberTitle' in uncertainOperation.current
      ? uncertainOperation.current
      : null;
  const operationRecovery = operationUncertain && (
    <div className="space-y-3">
      <Alert variant="warning">{copy(uncertainDocument ? 'documentRecovery' : 'uncertain')}</Alert>
      {uncertainDocument && reviewDocument(uncertainDocument)}
      {uncertainMember && <CatalogueMembershipReview command={uncertainMember} locale={locale} />}
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
    const entry = (operation.choicesRequired ? kbs : detail?.members)?.find(
      (item) => item.id === operation.memberId
    );
    operationCapture.current = {
      ...operation,
      memberTitle: entry?.title ?? operation.memberId,
      groupTitle: detail?.title ?? operation.groupId,
    };
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
      const { status, ok, value } = await readWithDeadline(request.signal, async (signal) => {
        const response = await fetch(`/api/admin/${kind}/${targetId}/query`, {
          method: 'POST',
          signal,
          headers: withCsrf({ 'content-type': 'application/json' }),
          body: JSON.stringify({ query, limit: 5 }),
        });
        const value: unknown =
          response.ok || response.status === 400 ? await response.json() : null;
        return { status: response.status, ok: response.ok, value };
      });
      if (!current()) return;
      if (status === 401 || status === 403) {
        scope.deny();
        return;
      }
      if (
        status === 400 &&
        record(value) &&
        record(value.error) &&
        value.error.code === 'VALIDATION:INPUT:INVALID' &&
        Array.isArray(value.error.fields) &&
        fields(value.error.fields)
      ) {
        setQueryState('idle');
        return;
      }
      if (!ok || !validQuery(value)) throw new Error('Query failed');
      setQueryResult({ id: targetId, rows: value });
      setQueryState('idle');
    } catch {
      if (current()) setQueryState('error');
    } finally {
      if (queryRequest.current === request) {
        queryRequest.current = null;
        if (!request.signal.aborted && commandVersion !== generation.current) setQueryState('idle');
      }
    }
  }
  const view = workspace?.view;
  const showIngestion =
    !workspace || view === 'ingestion' || (kind === 'kb-groups' && view === 'detail');
  const sourceName = (sourceType: Entry['sourceType']) =>
    label(
      sourceType === 'url' ? 'sourceUrl' : sourceType === 'api' ? 'sourceApi' : 'sourceDocument'
    );
  const index =
    showIngestion && kind === 'knowledge-bases' && detail
      ? {
          title: detail.title,
          source: sourceName(detail.sourceType),
          state: label(`state${detail.contentState ?? 'empty'}`),
        }
      : null;
  const hasIndexSource =
    !!detail && (detail.sourceType !== 'document' || !!detail.documents?.length);
  const queryRows = queryResult?.id === detail?.id ? queryResult?.rows : undefined;
  const showDocuments = !workspace || view === 'documents' || view === 'document';
  const showDetail = !workspace || (view !== 'list' && view !== 'edit' && view !== 'create');
  const doc = workspace?.documentId
    ? detail?.documents?.find((item) => item.id === workspace.documentId)
    : undefined;
  const listAction = buttonVariants({ variant: 'outline', className: 'min-h-11' });
  const statusLabel = (status: string) =>
    label(['pending', 'processing', 'ready', 'failed'].includes(status) ? status : 'unknown');
  function removeDocument(source: Detail, document: KnowledgeDocument) {
    if (detailDisabled || actionRef.current || networkPending.current || operationUncertain) return;
    documentCapture.current = {
      kbId: source.id,
      documentId: document.id,
      storageKey: document.storageKey,
      fileName: document.fileName,
      baseTitle: source.title,
      expected: 'absent',
      choicesRequired: false,
    };
    propose(
      `/api/admin/knowledge-bases/${source.id}/documents/${document.id}`,
      'DELETE',
      label('detach'),
      label('confirmDetach')
    );
  }
  const reviewedDocument = action ? documentCapture.current : null;
  const reviewedMembership = action ? operationCapture.current : null;
  const DocumentHeading = workspace ? 'h2' : 'h3';
  const isEditor = view === 'create' || view === 'edit';
  const hasInlineRefresh =
    isEditor ||
    view === 'documents' ||
    view === 'document' ||
    view === 'ingestion' ||
    (view === 'detail' && kind === 'kb-groups');
  const reviewedIndex = action?.indexReview;
  const actionReadIssue = list.error || choices.error || selectedRead.error || selectedRead.loading;
  const actionContext = reviewedDocument ? (
    reviewDocument(reviewedDocument)
  ) : reviewedMembership ? (
    <CatalogueMembershipReview
      command={reviewedMembership}
      locale={locale}
      refresh={
        actionReadIssue
          ? undefined
          : {
              label: label('refresh'),
              disabled: pending || list.loading || choices.loading,
              onClick: refresh,
            }
      }
    />
  ) : (
    reviewedIndex && (
      <dl className="space-y-2 rounded-lg border bg-muted/25 p-3 text-sm [overflow-wrap:anywhere]">
        <div>
          <dt className="text-xs text-muted-foreground">{copy('documentTarget')}</dt>
          <dd className="font-medium">
            <bdi>{reviewedIndex.title}</bdi>
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">{label('sourceType')}</dt>
            <dd>{reviewedIndex.source}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{copy('indexStatus')}</dt>
            <dd>{reviewedIndex.state}</dd>
          </div>
        </div>
      </dl>
    )
  );
  return (
    <div
      className={`mx-auto flex w-full min-w-0 flex-col p-4 md:px-8 ${isEditor ? 'max-w-3xl gap-4' : 'max-w-5xl gap-6 md:py-8'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {!isList && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-primary">
              <Link
                to="/admin/knowledge-bases"
                search={listSearch}
                className="underline-offset-4 hover:underline"
              >
                {label(kind)}
              </Link>
              {detail && view !== 'detail' && (
                <>
                  <span aria-hidden="true">/</span>
                  <Link {...linkTo(detail.id)} className="underline-offset-4 hover:underline">
                    <bdi>{detail.title}</bdi>
                  </Link>
                </>
              )}
            </div>
          )}
          <h1
            ref={heading}
            data-slot="editor-heading"
            tabIndex={isList ? undefined : -1}
            className="text-2xl font-semibold outline-none! [overflow-wrap:anywhere]"
          >
            {view === 'edit'
              ? copy(kind === 'knowledge-bases' ? 'editKnowledge' : 'editGroup')
              : view === 'document'
                ? (doc?.fileName ?? label('documentDetails'))
                : view === 'documents'
                  ? label('documents')
                  : view === 'ingestion'
                    ? label('ingestion')
                    : detail && !isList
                      ? detail.title
                      : label(
                          view === 'create'
                            ? kind === 'knowledge-bases'
                              ? 'addKb'
                              : 'addGroup'
                            : 'title'
                        )}
          </h1>
        </div>
        {hasInlineRefresh && (
          <ListRefreshButton
            label={label('refresh')}
            disabled={pending || list.loading || choices.loading || selectedRead.loading}
            onClick={refresh}
          />
        )}
      </header>
      {!hasInlineRefresh && (
        <div className="flex flex-wrap gap-2">
          {isList &&
            (['knowledge-bases', 'kb-groups'] as const).map((value) => (
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
      )}
      <ListPage>
        {scope.denied ? (
          <p role="alert">{label('denied')}</p>
        ) : (
          <>
            <CommandFeedback message={notice ? label('saved') : null} />
            {isList && (
              <ListPage.Toolbar>
                {workspace && !disabled && !form.pending && !action && !pending && !uncertain ? (
                  <Link {...linkTo('new')} className={buttonVariants({ className: 'min-h-11' })}>
                    {label(kind === 'knowledge-bases' ? 'addKb' : 'addGroup')}
                  </Link>
                ) : (
                  <Button
                    disabled={disabled || form.pending || !!action || pending || uncertain}
                    onClick={() => edit()}
                  >
                    {label(kind === 'knowledge-bases' ? 'addKb' : 'addGroup')}
                  </Button>
                )}
              </ListPage.Toolbar>
            )}
            {choices.loading && <LoadingStatus>{label('optionsLoading')}</LoadingStatus>}
            {choices.error && (
              <div role="alert">
                <p>{label('optionsError')}</p>
                <Button onClick={choices.retry}>{label('optionsRetry')}</Button>
              </div>
            )}
            {selectedRead.loading &&
              (detail ? (
                <LoadingStatus>{label('detailLoading')}</LoadingStatus>
              ) : (
                <RecordDetailSkeleton label={label('detailLoading')} />
              ))}
            {!isList && !recordId && collection.loading && (
              <LoadingStatus>{label('loading')}</LoadingStatus>
            )}
            {!isList && !recordId && collection.error && (
              <div role="alert" className="space-y-2">
                <p>{label('error')}</p>
                <Button onClick={collection.retry}>{label('retry')}</Button>
              </div>
            )}
            {selectedRead.error && (
              <div role="alert">
                <p>{label(selectedRead.missing ? 'missing' : 'detailError')}</p>
                <Button onClick={selectedRead.retry}>{label('detailRetry')}</Button>
              </div>
            )}
            {draft && (
              <form
                noValidate
                aria-busy={form.pending || undefined}
                onSubmit={(event) => void save(event)}
                aria-label={label('editor')}
                className={recordEditorSurface}
              >
                {changed && (
                  <p className="mx-4 mt-4 text-sm text-destructive" role="alert">
                    {copy('changed')}
                  </p>
                )}
                {uncertain && (
                  <p className="mx-4 mt-4 text-sm text-destructive" role="alert">
                    {copy('uncertain')}
                  </p>
                )}
                {catalogueRootMessage(form.errors) && (
                  <p className="mx-4 mt-4 text-sm text-destructive" role="alert">
                    {catalogueRootMessage(form.errors)}
                  </p>
                )}
                <fieldset disabled={form.pending || !!action || pending} className="min-w-0">
                  <legend className="sr-only">{label('editor')}</legend>
                  <RecordEditorSection
                    title={copy(kind === 'knowledge-bases' ? 'knowledgeDetails' : 'groupDetails')}
                  >
                    <div className={recordEditorField}>
                      <Label htmlFor="kb-title">{label('name')}</Label>
                      <Input
                        {...form.bind('title')}
                        id="kb-title"
                        dir="auto"
                        required
                        aria-required="true"
                        maxLength={120}
                        value={draft.title}
                        onChange={(event) =>
                          form.field('title')[1](event.target.value as Draft['title'])
                        }
                      />
                      <CatalogueFieldFeedback
                        compact
                        id={form.errorId('title')}
                        error={form.errors.title}
                        message={messages.title}
                      />
                    </div>
                    <div className={recordEditorField}>
                      <Label htmlFor="kb-description">{label('description')}</Label>
                      <Textarea
                        {...form.bind('description')}
                        id="kb-description"
                        dir="auto"
                        rows={2}
                        placeholder={copy(
                          kind === 'knowledge-bases' ? 'knowledgeDescription' : 'groupDescription'
                        )}
                        className="max-h-40 min-h-14 resize-y placeholder-shown:[direction:inherit]"
                        maxLength={2000}
                        value={draft.description}
                        onChange={(event) =>
                          form.field('description')[1](event.target.value as Draft['description'])
                        }
                      />
                      <CatalogueFieldFeedback
                        compact
                        id={form.errorId('description')}
                        error={form.errors.description}
                        message={messages.description}
                      />
                    </div>
                  </RecordEditorSection>
                  {kind === 'knowledge-bases' && (
                    <>
                      <RecordEditorSection title={copy('sourceSettings')}>
                        <div className="@container">
                          <div className="grid items-start gap-3 @min-[36rem]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @min-[36rem]:gap-6">
                            <div className="min-w-0 space-y-2.5">
                              <fieldset
                                role="radiogroup"
                                aria-labelledby="kb-source-type"
                                aria-required="true"
                                aria-describedby={
                                  [
                                    form.errors.sourceType && form.errorId('sourceType'),
                                    draft.sourceType === 'document' && 'kb-document-source-help',
                                  ]
                                    .filter(Boolean)
                                    .join(' ') || undefined
                                }
                                className="min-w-0 space-y-2"
                              >
                                <legend
                                  id="kb-source-type"
                                  className="mb-1 text-sm leading-none font-medium"
                                >
                                  {label('sourceType')}
                                </legend>
                                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                                  {(
                                    [
                                      ['document', 'sourceFilesChoice'],
                                      ['url', 'sourceWebChoice'],
                                      ['api', 'sourceApiChoice'],
                                    ] as const
                                  ).map(([type, title]) => (
                                    <label
                                      key={type}
                                      className="flex min-h-11 min-w-0 cursor-pointer flex-col items-center justify-center gap-x-1.5 gap-y-1 rounded-lg border px-1.5 py-2 text-center text-sm leading-tight font-medium hover:bg-muted/40 has-checked:border-primary/45 has-checked:bg-primary/5 has-disabled:cursor-not-allowed has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring sm:flex-row"
                                    >
                                      <input
                                        {...form.bind('sourceType')}
                                        id={`kb-source-choice-${type}`}
                                        type="radio"
                                        value={type}
                                        checked={draft.sourceType === type}
                                        className="size-3.5 shrink-0 accent-primary"
                                        onChange={() => {
                                          form.field('sourceType')[1](type);
                                          form.form.clearErrors('sourceUrl');
                                        }}
                                      />
                                      <span>{copy(title)}</span>
                                    </label>
                                  ))}
                                </div>
                                {form.errors.sourceType && (
                                  <CatalogueFieldFeedback
                                    compact
                                    id={form.errorId('sourceType')}
                                    error={form.errors.sourceType}
                                    message={messages.sourceType}
                                  />
                                )}
                                {draft.sourceType === 'document' && (
                                  <p
                                    id="kb-document-source-help"
                                    className="text-xs text-muted-foreground"
                                  >
                                    {copy('sourceFilesNext')}
                                  </p>
                                )}
                              </fieldset>
                              {draft.sourceType !== 'document' && (
                                <div className={recordEditorField}>
                                  {draft.sourceType === 'url' ? (
                                    <>
                                      <FormField
                                        control={form.form.control}
                                        name="sourceUrl"
                                        render={({ field }) => (
                                          <RecordListField
                                            id="kb-source-url"
                                            label={copy('sourceWebAddresses')}
                                            value={field.value}
                                            focusRef={field.ref}
                                            onBlur={form.bind('sourceUrl').onBlur}
                                            onChange={form.field('sourceUrl')[1]}
                                            limit={20}
                                            rowHelp={copy('urlRowsHelp')}
                                            bulkHelp={label('sourceUrlsHelp')}
                                            descriptionId={
                                              form.errors.sourceUrl
                                                ? form.errorId('sourceUrl')
                                                : undefined
                                            }
                                            invalid={!!form.errors.sourceUrl}
                                            urls
                                          />
                                        )}
                                      />
                                      <CatalogueFieldFeedback
                                        compact
                                        id={form.errorId('sourceUrl')}
                                        error={form.errors.sourceUrl}
                                        message={messages.sourceUrl}
                                      />
                                    </>
                                  ) : (
                                    <>
                                      <Label htmlFor="kb-source-url">{label('sourceApi')}</Label>
                                      <Input
                                        {...form.bind('sourceUrl')}
                                        id="kb-source-url"
                                        type="url"
                                        dir="ltr"
                                        required
                                        aria-required="true"
                                        aria-describedby={form.errorId('sourceUrl')}
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
                                        compact
                                        id={form.errorId('sourceUrl')}
                                        error={form.errors.sourceUrl}
                                        message={messages.sourceUrl}
                                        hint={copy('apiSourceHint')}
                                      />
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className={recordEditorField}>
                              <Label htmlFor="kb-audience">{label('audience')}</Label>
                              <NativeSelect
                                {...form.bind('audience')}
                                id="kb-audience"
                                aria-required="true"
                                aria-describedby={form.errorId('audience')}
                                className="w-full"
                                value={draft.audience}
                                onChange={(event) =>
                                  form.field('audience')[1](event.target.value as Draft['audience'])
                                }
                              >
                                {(['admin', 'staff', 'customer', 'public'] as const).map(
                                  (value) => (
                                    <option key={value} value={value}>
                                      {label(`audience${value}`)}
                                    </option>
                                  )
                                )}
                              </NativeSelect>
                              <CatalogueFieldFeedback
                                compact
                                id={form.errorId('audience')}
                                error={form.errors.audience}
                                message={messages.audience}
                                hint={label('audienceHelp')}
                              />
                            </div>
                          </div>
                        </div>
                      </RecordEditorSection>
                      <RecordEditorSection title={copy('indexing')}>
                        <div className={recordEditorField}>
                          <Label htmlFor="kb-embedding-model">{label('embeddingModel')}</Label>
                          <Input
                            {...form.bind('vectorEmbeddingModel')}
                            id="kb-embedding-model"
                            dir="auto"
                            maxLength={120}
                            aria-describedby={form.errorId('vectorEmbeddingModel')}
                            value={draft.vectorEmbeddingModel}
                            onChange={(event) =>
                              form.field('vectorEmbeddingModel')[1](event.target.value)
                            }
                          />
                          <CatalogueFieldFeedback
                            compact
                            id={form.errorId('vectorEmbeddingModel')}
                            error={form.errors.vectorEmbeddingModel}
                            message={messages.vectorEmbeddingModel}
                            hint={copy('embeddingModelHint')}
                          />
                        </div>
                        <details
                          key={draft.id ?? 'new'}
                          id="kb-indexing"
                          ref={passageSettings}
                          className="group rounded-lg border bg-muted/25"
                        >
                          <summary
                            className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
                            aria-labelledby="kb-indexing-label"
                            aria-describedby="kb-indexing-summary"
                          >
                            <span className="min-w-0">
                              <span id="kb-indexing-label" className="block text-sm font-medium">
                                {copy('adjustPassageSize')}
                              </span>
                              <span
                                id="kb-indexing-summary"
                                className="block text-xs text-muted-foreground"
                              >
                                {passageSummary}
                              </span>
                            </span>
                            <ChevronDownIcon
                              aria-hidden="true"
                              className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                            />
                          </summary>
                          <div className="space-y-3 rounded-b-lg border-t bg-card p-3">
                            <p className="text-xs text-muted-foreground">{copy('indexingHelp')}</p>
                            <div className={recordEditorGrid}>
                              <div className={recordEditorField}>
                                <Label htmlFor="kb-chunk-size">{copy('passageSize')}</Label>
                                <Input
                                  {...form.bind('chunkSize')}
                                  id="kb-chunk-size"
                                  inputMode="numeric"
                                  dir="ltr"
                                  className="max-w-36"
                                  required
                                  aria-required="true"
                                  value={draft.chunkSize}
                                  onChange={(event) =>
                                    form.field('chunkSize')[1](event.target.value)
                                  }
                                />
                                <CatalogueFieldFeedback
                                  compact
                                  id={form.errorId('chunkSize')}
                                  error={form.errors.chunkSize}
                                  message={messages.chunkSize}
                                />
                              </div>
                              <div className={recordEditorField}>
                                <Label htmlFor="kb-chunk-overlap">{copy('passageOverlap')}</Label>
                                <Input
                                  {...form.bind('chunkOverlap')}
                                  id="kb-chunk-overlap"
                                  inputMode="numeric"
                                  dir="ltr"
                                  className="max-w-36"
                                  required
                                  aria-required="true"
                                  value={draft.chunkOverlap}
                                  onChange={(event) =>
                                    form.field('chunkOverlap')[1](event.target.value)
                                  }
                                />
                                <CatalogueFieldFeedback
                                  compact
                                  id={form.errorId('chunkOverlap')}
                                  error={form.errors.chunkOverlap}
                                  message={messages.chunkOverlap}
                                />
                              </div>
                            </div>
                          </div>
                        </details>
                      </RecordEditorSection>
                    </>
                  )}
                  <RecordEditorActions
                    secondary={
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={resetDisabled}
                        onClick={resetDraft}
                      >
                        {copy('reset')}
                      </Button>
                    }
                  >
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uncertain}
                      onClick={() => {
                        setDraft(null);
                        if (workspace && workspace.view !== 'list') {
                          if (recordId) workspace.showRecord(recordId);
                          else workspace.showList();
                        }
                      }}
                    >
                      {label('cancel')}
                    </Button>
                    <CatalogueSaveButton
                      label={label('save')}
                      pending={form.pending}
                      disabled={disabled || changed || uncertain}
                    />
                  </RecordEditorActions>
                </fieldset>
              </form>
            )}
            {isList && (
              <ListPage.Content
                loading={list.loading}
                error={list.error}
                empty={!rows.length}
                retainContent={rows.length > 0}
                loadingView={
                  <>
                    <div className="md:hidden">
                      <RecordListSkeleton label={label('loading')} view="card" headings={[]} />
                    </div>
                    <div className="hidden md:block">
                      <RecordListSkeleton
                        label={label('loading')}
                        view="table"
                        headings={[label('name'), copy('tableDetails'), copy('tableActions')]}
                      />
                    </div>
                  </>
                }
                errorView={
                  <div role="alert">
                    <p>{label('error')}</p>
                    <Button onClick={list.retry}>{label('retry')}</Button>
                  </div>
                }
                emptyView={<p>{label('empty')}</p>}
              >
                <CatalogueRecordTable
                  rows={rows}
                  locale={locale}
                  caption={label(kind)}
                  nameLabel={label('name')}
                  detailsLabel={copy('tableDetails')}
                  actionsLabel={copy('tableActions')}
                  {...(workspace && {
                    renderTitle: (row: Entry) => (
                      <Link
                        {...linkTo(row.id)}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        <bdi>{row.title}</bdi>
                      </Link>
                    ),
                  })}
                  renderDetails={(row) => (
                    <div className="space-y-2 text-sm text-muted-foreground">
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
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary">
                              {row.contentState === undefined
                                ? label('unknown')
                                : label(`state${row.contentState}`)}
                            </Badge>
                            <Badge variant="outline">
                              {row.isEnabled === undefined
                                ? label('unknown')
                                : label(row.isEnabled ? 'enabled' : 'disabled')}
                            </Badge>
                          </div>
                          <p>
                            {label('audience')}:{' '}
                            {row.audience === undefined
                              ? label('unknown')
                              : label(`audience${row.audience}`)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  renderActions={(row) => (
                    <>
                      {workspace && !action && !pending && !disabled && !form.pending ? (
                        <>
                          <Link
                            {...linkTo(row.id)}
                            className={listAction}
                            aria-label={`${label('open')} ${row.title}`}
                            data-table-action-tooltip={label('open')}
                          >
                            <TableActionIcon icon={TableEyeIcon}>{label('open')}</TableActionIcon>
                          </Link>
                          <Link
                            {...linkTo(row.id, 'edit')}
                            className={listAction}
                            aria-label={`${label('edit')} ${row.title}`}
                            data-table-action-tooltip={label('edit')}
                          >
                            <TableActionIcon icon={TablePencilIcon}>
                              {label('edit')}
                            </TableActionIcon>
                          </Link>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            disabled={disabled || form.pending || !!action || pending}
                            onClick={() => open(row.id)}
                            aria-label={`${label('open')} ${row.title}`}
                            data-table-action-tooltip={label('open')}
                          >
                            <TableActionIcon icon={TableEyeIcon}>{label('open')}</TableActionIcon>
                          </Button>
                          <Button
                            variant="outline"
                            disabled={disabled || form.pending || !!action || pending}
                            onClick={() => edit(row)}
                            aria-label={`${label('edit')} ${row.title}`}
                            data-table-action-tooltip={label('edit')}
                          >
                            <TableActionIcon icon={TablePencilIcon}>
                              {label('edit')}
                            </TableActionIcon>
                          </Button>
                        </>
                      )}
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
                        data-table-action-tooltip={label('delete')}
                      >
                        <TableActionIcon icon={TableTrash2Icon}>{label('delete')}</TableActionIcon>
                      </Button>
                    </>
                  )}
                />
              </ListPage.Content>
            )}
            {detail && showDetail && (
              <section
                aria-label={detail.title}
                className={
                  view === 'documents' || view === 'ingestion'
                    ? 'flex min-w-0 flex-col gap-4'
                    : 'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-6'
                }
              >
                {!workspace && (
                  <h2 className="break-words text-xl font-semibold">{detail.title}</h2>
                )}
                {workspace && (
                  <div className="flex flex-wrap items-center gap-2">
                    {view !== 'detail' && (
                      <Link {...linkTo(detail.id)} className={listAction}>
                        {label('overview')}
                      </Link>
                    )}
                    {kind === 'knowledge-bases' && view !== 'documents' && (
                      <Link {...linkTo(detail.id, 'documents')} className={listAction}>
                        {label('documents')}
                      </Link>
                    )}
                    {kind === 'knowledge-bases' && view !== 'ingestion' && (
                      <Link {...linkTo(detail.id, 'ingestion')} className={listAction}>
                        {label('ingestion')}
                      </Link>
                    )}
                    {view === 'detail' && (
                      <Link
                        {...linkTo(detail.id, 'edit')}
                        className={listAction}
                        aria-label={`${label('edit')} ${detail.title}`}
                      >
                        {label('edit')}
                      </Link>
                    )}
                    {view === 'detail' && (
                      <Button
                        variant="outline"
                        disabled={detailDisabled || !!action || pending}
                        onClick={() =>
                          propose(
                            `/api/admin/${kind}/${detail.id}`,
                            'DELETE',
                            label('delete'),
                            `${detail.title}. ${label('confirmDelete')}`
                          )
                        }
                      >
                        {label('delete')}
                      </Button>
                    )}
                  </div>
                )}
                {view === 'detail' && detail.description && (
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-muted-foreground">
                    {detail.description}
                  </p>
                )}

                {kind === 'knowledge-bases' && (!index || !workspace) && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="outline">
                      {label('contentState')} · {label(`state${detail.contentState ?? 'empty'}`)}
                    </Badge>
                    {(!workspace || view === 'detail') && (
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
                    )}
                  </div>
                )}
                {kind === 'knowledge-bases' && !index && detail.contentState === 'error' && (
                  <p role="alert">
                    {label('processingError')}: {processingError(detail.contentError)}
                  </p>
                )}
                {view === 'detail' && kind === 'knowledge-bases' && (
                  <dl className="grid gap-4 rounded-lg bg-muted/45 p-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">{label('sourceType')}</dt>
                      <dd>{sourceName(detail.sourceType)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{label('audience')}</dt>
                      <dd>{label(detail.audience ? `audience${detail.audience}` : 'unknown')}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{label('documents')}</dt>
                      <dd>
                        {numbers.number(detail.documents?.length ?? detail.documentCount ?? 0)}
                      </dd>
                    </div>
                    {!!detail.groups?.length && (
                      <div className="sm:col-span-3">
                        <dt className="text-muted-foreground">{label('kb-groups')}</dt>
                        <dd>
                          <ul className="flex flex-wrap gap-3">
                            {detail.groups.map((group) => (
                              <li key={group.id}>
                                <Link
                                  to="/admin/knowledge-bases/groups/$recordId/{-$action}"
                                  params={{ recordId: group.id, action: undefined }}
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  <bdi>{group.title}</bdi>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
                {showIngestion && (
                  <div
                    className={
                      index
                        ? 'grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'
                        : 'min-w-0'
                    }
                  >
                    <CatalogueQueryEditor
                      key={detail.id}
                      locale={locale}
                      value={queryText}
                      epoch={generation.current}
                      headingLevel={workspace ? 2 : 3}
                      notIndexed={kind === 'knowledge-bases' && detail.contentState !== 'ready'}
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
                    >
                      {(queryState !== 'idle' || queryRows) && (
                        <div className="min-w-0 border-t px-4 py-3">
                          {queryState === 'loading' && (
                            <LoadingStatus>{label('queryLoading')}</LoadingStatus>
                          )}
                          {queryState === 'error' && (
                            <Alert variant="warning">{label('queryError')}</Alert>
                          )}
                          {!!queryRows?.length && (
                            <>
                              <p role="status" className="mb-2 text-sm font-semibold">
                                {copy('queryResultCount').replace(
                                  '{count}',
                                  numbers.number(queryRows.length)
                                )}
                              </p>
                              <ol className="divide-y" aria-label={label('queryResults')}>
                                {queryRows.map((item) => {
                                  const source =
                                    item.kbId === detail.id
                                      ? detail.title
                                      : (detail.members?.find((member) => member.id === item.kbId)
                                          ?.title ?? item.kbId);
                                  return (
                                    <li key={item.id} className="space-y-1 py-2.5">
                                      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                        <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                                          <bdi>
                                            {item.metadata.fileName ?? item.metadata.url ?? source}
                                          </bdi>
                                        </p>
                                        <Badge variant="outline">
                                          {label('relevance')}{' '}
                                          <bdi>{numbers.percent(Math.max(0, item.score))}</bdi>
                                        </Badge>
                                      </div>
                                      <p
                                        dir="auto"
                                        className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]"
                                      >
                                        {item.excerpt}
                                      </p>
                                    </li>
                                  );
                                })}
                              </ol>
                            </>
                          )}
                          {queryRows?.length === 0 && (
                            <p role="status" className="text-sm text-muted-foreground">
                              {label('noMatches')}
                            </p>
                          )}
                        </div>
                      )}
                    </CatalogueQueryEditor>
                    {index && (
                      <section className={recordEditorSurface} aria-labelledby="kb-index-title">
                        <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
                          <DocumentHeading id="kb-index-title" className="text-base font-semibold">
                            {copy('indexStatus')}
                          </DocumentHeading>
                          <Badge variant="outline">{index.state}</Badge>
                        </header>
                        <div className="space-y-3 px-4 py-3">
                          <dl className="text-sm">
                            <dt className="text-xs text-muted-foreground">{label('sourceType')}</dt>
                            <dd className="font-medium">{index.source}</dd>
                          </dl>
                          {detail.contentState === 'error' && (
                            <Alert variant="warning">
                              {label('processingError')}: {processingError(detail.contentError)}
                            </Alert>
                          )}
                          {!hasIndexSource && (
                            <p className="text-sm text-muted-foreground">{copy('indexNoFiles')}</p>
                          )}
                        </div>
                        <RecordEditorActions>
                          <Button
                            variant="outline"
                            disabled={detailDisabled || !hasIndexSource || !!action || pending}
                            onClick={() =>
                              propose(
                                `/api/admin/knowledge-bases/${detail.id}/reprocess`,
                                'POST',
                                label('reprocess'),
                                detail.audience && detail.audience !== 'admin'
                                  ? `${label('confirmReprocess')} ${label('audienceWarning')}`
                                  : label('confirmReprocess'),
                                undefined,
                                index
                              )
                            }
                          >
                            {label('reprocess')}
                          </Button>
                        </RecordEditorActions>
                      </section>
                    )}
                  </div>
                )}
                {operationRecovery}
                {kind === 'kb-groups' ? (
                  <>
                    <CatalogueRelationEditor
                      key={detail.id}
                      headingLevel={workspace ? 2 : 3}
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
                    <section
                      className={recordEditorSurface}
                      aria-labelledby="kb-group-members-title"
                    >
                      <DocumentHeading
                        id="kb-group-members-title"
                        className="border-b bg-muted/30 px-4 py-3 text-base font-semibold"
                      >
                        {copy('groupMembers')}
                      </DocumentHeading>
                      {detail.members?.length ? (
                        <ul className="divide-y">
                          {detail.members?.map((item) => (
                            <li
                              key={item.id}
                              className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2"
                            >
                              <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                                <bdi>{item.title}</bdi>
                              </span>
                              <Button
                                variant="ghost"
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
                                disabled={
                                  detailDisabled || !!action || pending || operationUncertain
                                }
                                aria-label={`${label('unlink')} ${item.title}`}
                              >
                                {label('unlink')}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="px-4 py-3 text-sm text-muted-foreground">
                          {copy('emptyMembers')}
                        </p>
                      )}
                    </section>
                  </>
                ) : (
                  showDocuments && (
                    <>
                      {view !== 'document' && (
                        <>
                          {detail.sourceType === 'url' || detail.sourceType === 'api' ? (
                            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                              {copy('documentSource')}
                            </p>
                          ) : (
                            <KnowledgeBaseDocumentPicker
                              key={detail.id}
                              headingLevel={workspace ? 2 : 3}
                              attachedKeys={detail.documents?.map((doc) => doc.storageKey) ?? []}
                              disabled={
                                detailDisabled ||
                                !!action ||
                                pending ||
                                form.pending ||
                                operationUncertain
                              }
                              onDenied={scope.deny}
                              onAttach={(
                                (target, version, basis) =>
                                ({ storageKey, fileName }, owner) => {
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
                                    storageKey,
                                    fileName,
                                    baseTitle: current.detail.title,
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
                                    { storageKey }
                                  );
                                }
                              )(detail.id, selectionGeneration.current, retrievalBasis(detail))}
                            />
                          )}

                          <section
                            className={recordEditorSurface}
                            aria-labelledby="kb-attached-title"
                          >
                            <DocumentHeading
                              id="kb-attached-title"
                              className="border-b bg-muted/30 px-4 py-3 text-base font-semibold"
                            >
                              {copy('attachedDocuments')}
                            </DocumentHeading>
                            {!detail.documents?.length && (
                              <p className="px-4 py-3 text-sm text-muted-foreground">
                                {label('noDocuments')}
                              </p>
                            )}
                            {!!detail.documents?.length && (
                              <ul className="divide-y">
                                {detail.documents?.map((doc) => (
                                  <li
                                    key={doc.id}
                                    className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2"
                                  >
                                    {workspace ? (
                                      <Link
                                        to="/admin/knowledge-bases/$recordId/documents/$documentId"
                                        params={{ recordId: detail.id, documentId: doc.id }}
                                        className="inline-flex min-h-11 min-w-0 items-center text-sm font-medium text-primary underline-offset-4 [overflow-wrap:anywhere] hover:underline"
                                      >
                                        <bdi>{doc.fileName}</bdi>
                                      </Link>
                                    ) : (
                                      <span className="break-words">{doc.fileName}</span>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant="secondary">
                                        {statusLabel(doc.processingStatus)}
                                      </Badge>
                                      <Button
                                        variant="ghost"
                                        disabled={
                                          detailDisabled ||
                                          !!action ||
                                          pending ||
                                          operationUncertain
                                        }
                                        aria-label={`${label('detach')} ${doc.fileName}`}
                                        onClick={() => removeDocument(detail, doc)}
                                      >
                                        {label('detach')}
                                      </Button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </section>
                        </>
                      )}
                      {view === 'document' &&
                        (doc ? (
                          <>
                            {time.notice}
                            <dl className="grid gap-4 rounded-lg bg-muted/45 p-3 text-sm sm:grid-cols-2">
                              <div>
                                <dt className="text-muted-foreground">{label('contentState')}</dt>
                                <dd className="mt-1">
                                  <Badge variant="secondary">
                                    {statusLabel(doc.processingStatus)}
                                  </Badge>
                                </dd>
                              </div>
                              {doc.mimeType && (
                                <div>
                                  <dt className="text-muted-foreground">{label('documentType')}</dt>
                                  <dd>
                                    <bdi>{doc.mimeType}</bdi>
                                  </dd>
                                </div>
                              )}
                              {doc.sizeBytes != null && (
                                <div>
                                  <dt className="text-muted-foreground">{label('documentSize')}</dt>
                                  <dd>
                                    {label('bytes').replace(
                                      '{size}',
                                      numbers.number(Number(doc.sizeBytes))
                                    )}
                                  </dd>
                                </div>
                              )}
                              {doc.updatedAt && Number.isFinite(Date.parse(doc.updatedAt)) && (
                                <div>
                                  <dt className="text-muted-foreground">
                                    {label('documentUpdated')}
                                  </dt>
                                  <dd>
                                    <time dateTime={doc.updatedAt}>
                                      {time.format(doc.updatedAt)}
                                    </time>
                                  </dd>
                                </div>
                              )}
                            </dl>
                            {doc.processingStatus === 'failed' && (
                              <p role="alert">{processingError(doc.processingError)}</p>
                            )}
                            <div>
                              <Button
                                variant="outline"
                                disabled={
                                  detailDisabled || !!action || pending || operationUncertain
                                }
                                aria-label={`${label('detach')} ${doc.fileName}`}
                                onClick={() => removeDocument(detail, doc)}
                              >
                                {label('detach')}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <p role="alert">{label('documentMissing')}</p>
                        ))}
                    </>
                  )
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
          onValidationError={(fields) => {
            const owner = operationCapture.current?.owner ?? documentCapture.current?.owner;
            if (owner) return owner.fields(fields);
            if (!formCapture.current || !ownedFields(fields)) return false;
            revealPassageErrors(fields);
            return true;
          }}
          onUnconfirmed={unconfirmed}
          summary={
            actionContext ? (
              <>
                {actionContext}
                {actionReadIssue && recovery}
              </>
            ) : (
              recovery
            )
          }
          onClose={() => {
            generation.current++;
            setAction(null);
            onPendingChange(false);
          }}
          onSuccess={((command, version) => async (value: unknown) => {
            if (actionRef.current !== command) return;
            const operation = operationCapture.current;
            if (operation) {
              const response = await confirmationRead(`/api/admin/kb-groups/${operation.groupId}`);
              if (actionRef.current !== command) return;
              if (response.status === 401 || response.status === 403) {
                scope.deny();
                return;
              }
              if (response.status !== 200) throw new Error('Unconfirmed group membership');
              const fresh: unknown = response.value;
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
              const response = await confirmationRead(
                `/api/admin/knowledge-bases/${document.kbId}`
              );
              if (actionRef.current !== command) return;
              if (response.status === 401 || response.status === 403) {
                scope.deny();
                return;
              }
              if (response.status !== 200) throw new Error('Unconfirmed document catalogue');
              const fresh: unknown = response.value;
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
              if (workspace && workspace.view !== 'list' && validEntries([value])) {
                toast.success(label('saved'));
                workspace.showRecord((value as Entry).id, true);
                return;
              }
            }
            if (command.path.endsWith('/members')) setMember('');
            if (command.method === 'DELETE' && command.path === `/api/admin/${kind}/${selected}`) {
              clearDetail();
              if (workspace && workspace.view !== 'list') {
                toast.success(label('saved'));
                workspace.showList(true);
                return;
              }
            }
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

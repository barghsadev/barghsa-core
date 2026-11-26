import { Pencil as TablePencilIcon, Trash2 as TableTrash2Icon } from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { CatalogueRecordTable } from '../components/CatalogueRecordTable.js';
import { Link } from '@tanstack/react-router';
import {
  useEffect,
  useLayoutEffect,
  useId,
  useState,
  useRef,
  useCallback,
  useMemo,
  lazy,
  Suspense,
  type FormEvent,
} from 'react';
import {
  LoadingStatus,
  Alert,
  Button,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  Textarea,
  Badge,
  buttonVariants,
} from '@barghsa/ui';
import { toast } from '../lib/toast-api.js';
import { AgentServingSurfaces } from '../components/AgentServingSurfaces.js';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { aiAgentFormText } from '@barghsa/i18n/ai-agent-forms';
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
import { RecordNumberInput } from '../components/RecordNumberInput.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
const TeamActionDialog = lazy(() =>
  import('../components/TeamActionDialog.js').then((module) => ({
    default: module.TeamActionDialog,
  }))
);
import { AgentPromptTextarea } from '../components/AgentPromptTextarea.js';
import { CatalogueChoicePicker } from '../components/CatalogueChoicePicker.js';
import { AgentLinkChoiceList } from '../components/AgentLinkChoiceList.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { AdminAgentTestChat } from '../components/AdminAgentTestChat.js';
import { StaffKnowledgeAssistant } from '../components/PublicKnowledgeAssistant.js';
import {
  type Agent,
  type Detail,
  type Options,
  type Draft,
  sets,
  emptyOptions,
  blank,
  validAgents,
  validOptions,
  validDetail,
  detailSnapshot,
  rowBasis,
  eligible,
  agentDraftFor,
  invalidAgentFields,
  agentBody,
  matchesAgentReceipt,
  matchesAgentDetail,
} from '../lib/ai-agent-form.js';
type AgentActions = { showRecord: (id: string, replace?: boolean) => void; showList: () => void };
type AgentWorkspace =
  | { view: 'list'; agentId?: never }
  | ({ view: 'create'; agentId?: never } & AgentActions)
  | ({ view: 'edit' | 'detail'; agentId: string } & AgentActions);
const agentRoute = (agentId: string, action?: 'edit') => ({
  to: '/admin/agents/$agentId/{-$action}' as const,
  params: { agentId, action },
});
const agentDependencyRoutes = {
  kbs: '/admin/knowledge-bases/$recordId/{-$action}',
  kbGroups: '/admin/knowledge-bases/groups/$recordId/{-$action}',
  policies: '/admin/policies/$recordId/{-$action}',
  policyGroups: '/admin/policies/groups/$recordId/{-$action}',
} as const;
const promptLimit = 8000;

export default function AdminAiAgentsPage({ workspace }: { workspace?: AgentWorkspace } = {}) {
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  return (
    <OwnedAiAgentsPage
      key={JSON.stringify([actor, contextRevision])}
      actor={actor}
      contextRevision={contextRevision}
      {...(workspace ? { workspace } : {})}
    />
  );
}

function OwnedAiAgentsPage({
  actor,
  contextRevision,
  workspace,
}: {
  actor: string | null;
  contextRevision: number;
  workspace?: AgentWorkspace;
}) {
  const client = useQueryClient();
  const reader = useId();
  const sequence = useRef(0);
  const locale = useLocale(),
    label = (key: string) => t(`admin.agents.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const isList = !workspace || workspace.view === 'list';
  const showDetails = workspace?.view === 'detail';
  const requested = workspace?.view === 'create' ? 'new' : workspace?.agentId;
  const heading = useRef<HTMLHeadingElement>(null);
  const [rows, setRows] = useState<Agent[]>([]),
    [options, setOptions] = useState<Options | null>(null),
    [editor, setEditor] = useState<string | null>(null);
  const copy = (key: Parameters<typeof aiAgentFormText>[0]) => aiAgentFormText(key, locale);
  const messages: Record<keyof Draft, string> = {
    title: copy('title'),
    description: copy('description'),
    modelId: copy('modelId'),
    systemPrompt: copy('systemPrompt'),
    temperature: copy('temperature'),
    maxTokens: copy('maxTokens'),
    linkMode: copy('linkMode'),
    enabled: copy('enabled'),
    kbIds: copy('kbIds'),
    policyIds: copy('policyIds'),
    kbGroupIds: copy('kbGroupIds'),
    policyGroupIds: copy('policyGroupIds'),
  };
  const currentOptions = useRef<Options>(emptyOptions);
  currentOptions.current = options ?? emptyOptions;
  const form = useWizardForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema(messages, (value) =>
        invalidAgentFields(value, currentOptions.current)
      );
    },
    blank,
    copy('unavailable')
  );
  const ownedFields = useActionFieldErrors(form.form, messages, copy('invalid'));
  const [draftOpen, setDraftOpen] = useState(false),
    [focusEpoch, setFocusEpoch] = useState(0);
  const draft = draftOpen ? form.values : null;
  const resetForm = form.form.reset,
    register = form.form.register;
  const setDraft = useCallback(
    (value: Draft | null) => {
      resetForm(value ?? blank());
      setDraftOpen(!!value);
      setFocusEpoch((v) => v + 1);
    },
    [resetForm]
  );
  const groupRefs = useMemo(
    () =>
      Object.fromEntries(
        sets.map(([field]) => [
          field,
          (node: HTMLFieldSetElement | null) =>
            register(field).ref(node ? { focus: () => node.focus() } : null),
        ])
      ) as Record<(typeof sets)[number][0], (node: HTMLFieldSetElement | null) => void>,
    [register, focusEpoch]
  );
  const linkModeRef = useCallback(
    (node: HTMLFieldSetElement | null) => {
      register('linkMode').ref(
        node
          ? {
              focus: () =>
                (
                  node.querySelector<HTMLInputElement>('input:checked') ??
                  node.querySelector('input')
                )?.focus(),
            }
          : null
      );
    },
    [register]
  );
  const [changed, setChanged] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [recovered, setRecovered] = useState(false),
    [pending, setPending] = useState(false);
  const uncertainRef = useRef(false),
    networkPending = useRef(false),
    validating = useRef(false),
    actionRef = useRef<TeamAction | null>(null),
    capture = useRef<{ draft: Draft; id?: string } | null>(null);
  const savedDetail = useRef<Detail | null>(null);
  const freshReads = useRef({ list: 0, options: 0, detail: 0 }),
    requiredReads = useRef({ list: 0, options: 0, detail: 0 });
  const onPendingChange = useCallback((value: boolean) => {
    networkPending.current = value;
    setPending(value);
  }, []);
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(isList),
    [error, setError] = useState(false),
    [denied, setDenied] = useState(false),
    [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  const [optionsRevision, setOptionsRevision] = useState(0),
    [optionsLoading, setOptionsLoading] = useState(!showDetails),
    [optionsError, setOptionsError] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState(false),
    [detailMissing, setDetailMissing] = useState(false);
  const requests = useRef(new Set<AbortController>());
  const previousRows = useRef<Agent[]>([]);
  const detailBasis = useRef<string | null>(null);
  const work = useRef({ editor, draft, action });
  work.current = { editor, draft, action };
  const generation = useRef(0),
    commandGeneration = useRef(0);
  const commandRow = useRef<Agent | null>(null);
  const withdraw = useCallback(() => {
    generation.current++;
    validating.current = false;
    form.setValidationPending(false);
    setAction(null);
    actionRef.current = null;
    capture.current = null;
    commandRow.current = null;
    onPendingChange(false);
  }, [form.setValidationPending, onPendingChange]);
  const clearWork = useCallback(() => {
    withdraw();
    setEditor(null);
    setDraft(null);
    setSaved(false);
    detailBasis.current = null;
    savedDetail.current = null;
    setDetailMissing(false);
    setChanged(false);
    setUncertain(false);
    uncertainRef.current = false;
    setRecovered(false);
  }, [withdraw, setDraft]);
  function acceptRead(kind: keyof typeof freshReads.current, revision: number) {
    freshReads.current[kind] = revision;
    if (
      uncertainRef.current &&
      (Object.keys(requiredReads.current) as (keyof typeof freshReads.current)[]).every(
        (key) =>
          freshReads.current[key] >= requiredReads.current[key] ||
          (key === 'detail' &&
            !!work.current.editor &&
            work.current.editor !== 'new' &&
            freshReads.current.list >= requiredReads.current.list &&
            !previousRows.current.some((row) => row.id === work.current.editor))
      )
    )
      setRecovered(true);
  }
  const deny = useCallback(() => {
    for (const request of requests.current) request.abort();
    previousRows.current = [];
    setRows([]);
    setOptions(null);
    setDenied(true);
    setLoading(false);
    setError(false);
    setOptionsLoading(false);
    setOptionsError(false);
    setDetailLoading(false);
    setDetailError(false);
    setDetailMissing(false);
    clearWork();
  }, [clearWork]);
  const read = useCallback(
    async (path: string, controller: AbortController): Promise<unknown> => {
      if (controller.signal.aborted) throw new Error('Obsolete');
      const key = queryKeys.catalogue.detail(
        {
          context: 'staff',
          ownerId: actor ?? 'current-account',
          accountId: actor,
          revision: contextRevision,
        },
        JSON.stringify([reader, 'ai-agents', path, ++sequence.current])
      );
      const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
      controller.signal.addEventListener('abort', cancel, { once: true });
      try {
        const response = await client.fetchQuery({
          queryKey: key,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: ({ signal }) =>
            readWithDeadline(signal, async (transport) => {
              const response = await fetch(path, { signal: transport });
              return {
                status: response.status,
                ok: response.ok,
                value: response.ok ? await response.json() : null,
              };
            }),
        });
        if (controller.signal.aborted) throw new Error('Obsolete');
        if (response.status === 401 || response.status === 403) {
          deny();
          throw new Error('Denied');
        }
        if (!response.ok) throw new Error(response.status === 404 ? 'Missing' : 'Unavailable');
        return response.value;
      } finally {
        controller.signal.removeEventListener('abort', cancel);
      }
    },
    [actor, contextRevision, client, reader, deny]
  );
  useEffect(
    () => () => {
      generation.current++;
      for (const controller of requests.current) controller.abort();
      requests.current.clear();
    },
    []
  );
  useEffect(() => {
    if (!isList) return;
    const controller = new AbortController();
    requests.current.add(controller);
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const data = await read('/api/admin/agents', controller);
        if (controller.signal.aborted) return;
        if (!validAgents(data)) throw new Error('Invalid agents');
        const selected = work.current.editor;
        const old = previousRows.current.find((row) => row.id === selected),
          fresh = data.find((row) => row.id === selected);
        const command = commandRow.current;
        if (
          selected &&
          selected !== 'new' &&
          (!fresh || (old && rowBasis(old) !== rowBasis(fresh)))
        ) {
          withdraw();
          setChanged(true);
        } else if (
          command &&
          !data.some((row) => row.id === command.id && rowBasis(row) === rowBasis(command))
        )
          withdraw();
        previousRows.current = data;
        acceptRead('list', revision);
        setRows(data);
        setDenied(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      requests.current.delete(controller);
    };
  }, [isList, revision, read, withdraw]);
  useEffect(() => {
    if (showDetails) return;
    const controller = new AbortController();
    requests.current.add(controller);
    setOptionsLoading(true);
    setOptionsError(false);
    void (async () => {
      try {
        const data = await read('/api/admin/agents/options', controller);
        if (controller.signal.aborted) return;
        if (!validOptions(data)) throw new Error('Invalid options');
        if (
          work.current.draft &&
          !eligible(work.current.draft, data) &&
          work.current.action?.method !== 'DELETE'
        ) {
          withdraw();
        }
        setOptions(data);
        acceptRead('options', optionsRevision);
        if (!isList && requested === 'new') setDenied(false);
      } catch {
        if (!controller.signal.aborted) setOptionsError(true);
      } finally {
        if (!controller.signal.aborted) setOptionsLoading(false);
      }
    })();
    return () => {
      controller.abort();
      requests.current.delete(controller);
    };
  }, [isList, showDetails, requested, optionsRevision, read, withdraw]);
  useEffect(() => {
    if (!editor || editor === 'new') {
      setDetailLoading(false);
      setDetailError(false);
      return;
    }
    const controller = new AbortController();
    requests.current.add(controller);
    setDetailLoading(true);
    setDetailError(false);
    setDetailMissing(false);
    void (async () => {
      try {
        const data = await read(`/api/admin/agents/${encodeURIComponent(editor)}`, controller);
        if (controller.signal.aborted) return;
        if (!validDetail(data, editor)) throw new Error('Invalid detail');
        const nextBasis = detailSnapshot(data);
        savedDetail.current = data;
        if (!isList) {
          previousRows.current = [data];
          setRows([data]);
          setDenied(false);
        }
        acceptRead('detail', detailRevision);
        if (detailBasis.current && detailBasis.current !== nextBasis) {
          withdraw();
          setChanged(true);
        } else if (!detailBasis.current && !showDetails) setDraft(agentDraftFor(data));
        detailBasis.current = nextBasis;
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!isList && error instanceof Error && error.message === 'Missing') {
          clearWork();
          previousRows.current = [];
          setRows([]);
          setDenied(false);
          setDetailMissing(true);
        } else setDetailError(true);
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    })();
    return () => {
      controller.abort();
      requests.current.delete(controller);
    };
  }, [isList, showDetails, editor, detailRevision, read, withdraw, setDraft, clearWork]);
  function chooseEditor(value: string | null) {
    withdraw();
    detailBasis.current = null;
    savedDetail.current = null;
    setEditor(value);
    setDraft(value === 'new' ? blank() : null);
    setSaved(false);
    setDetailError(false);
    setChanged(false);
    setDetailMissing(false);
  }
  useLayoutEffect(() => {
    if (requested) chooseEditor(requested);
    if (!isList) heading.current?.focus({ preventScroll: true });
  }, [requested]);
  const unavailable =
    denied ||
    loading ||
    error ||
    optionsLoading ||
    optionsError ||
    detailLoading ||
    detailError ||
    detailMissing;
  const disabled = unavailable || changed || uncertain;
  const busy = form.pending || !!action;
  const choices = options ?? emptyOptions;
  const saveDisabled = disabled || !draft;
  const refresh = () => {
    if (networkPending.current) return;
    if (validating.current) withdraw();
    if (requested && !editor) chooseEditor(requested);
    setRevision((v) => v + 1);
    setOptionsRevision((v) => v + 1);
    setDetailRevision((v) => v + 1);
  };
  function unconfirmed() {
    requiredReads.current = {
      list: isList ? revision + 1 : freshReads.current.list,
      options: showDetails ? freshReads.current.options : optionsRevision + 1,
      detail: editor && editor !== 'new' ? detailRevision + 1 : freshReads.current.detail,
    };
    uncertainRef.current = true;
    setUncertain(true);
    setRecovered(false);
    withdraw();
    setRevision((v) => v + 1);
    setOptionsRevision((v) => v + 1);
    setDetailRevision((v) => v + 1);
  }
  const missingEditor =
    !!editor && editor !== 'new' && !loading && !error && !rows.some((row) => row.id === editor);
  const resetUnavailable =
    denied ||
    loading ||
    error ||
    optionsLoading ||
    optionsError ||
    (!missingEditor && (detailLoading || detailError));
  function resetDraft() {
    if (resetUnavailable || busy || (uncertain && !recovered)) return;
    withdraw();
    if (editor === 'new') setDraft(blank());
    else if (editor && !rows.some((row) => row.id === editor)) chooseEditor(null);
    else if (savedDetail.current) setDraft(agentDraftFor(savedDetail.current));
    setChanged(false);
    setUncertain(false);
    uncertainRef.current = false;
    setRecovered(false);
    setSaved(false);
  }
  const recovery = (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={loading || optionsLoading || detailLoading || pending}
        onClick={refresh}
      >
        {label('refresh')}
      </Button>
      {loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
      {error && (
        <div role="alert">
          <p>{label('error')}</p>
          <Button type="button" disabled={pending} onClick={() => setRevision((v) => v + 1)}>
            {label('retry')}
          </Button>
        </div>
      )}
      {optionsLoading && <LoadingStatus>{label('optionsLoading')}</LoadingStatus>}
      {optionsError && (
        <div role="alert">
          <p>{label('optionsError')}</p>
          <Button type="button" disabled={pending} onClick={() => setOptionsRevision((v) => v + 1)}>
            {label('optionsRetry')}
          </Button>
        </div>
      )}
      {detailLoading && <LoadingStatus>{label('detailLoading')}</LoadingStatus>}
      {detailError && (
        <div role="alert">
          <p>{label('detailError')}</p>
          <Button type="button" disabled={pending} onClick={() => setDetailRevision((v) => v + 1)}>
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
      actionRef.current ||
      validating.current ||
      (method === 'DELETE'
        ? denied || loading || error || detailLoading || detailError || changed || uncertain
        : disabled)
    )
      return;
    commandGeneration.current = generation.current;
    setSaved(false);
    const next: TeamAction = {
      path,
      method,
      responseDeadline: true,
      ...(method === 'PUT' &&
      body &&
      typeof body === 'object' &&
      'enabled' in body &&
      body.enabled === false
        ? { risk: 'destructive' as const }
        : {}),
      successStatus: method === 'DELETE' ? 204 : method === 'POST' ? 201 : 200,
      title,
      description,
      ...(body === undefined ? {} : { body }),
      forbiddenMessage: label('denied'),
      conflictMessage: label('changed'),
      errorMessages: {
        'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
        AI_MODEL_NOT_FOUND: label('changed'),
        AI_KB_NOT_FOUND: label('changed'),
        AI_POLICY_NOT_FOUND: label('changed'),
        AI_KB_GROUP_NOT_FOUND: label('changed'),
        AI_POLICY_GROUP_NOT_FOUND: label('changed'),
        AI_AGENT_ASSIGNED_TO_SLOTS: label('assignedToSlots'),
      },
    };
    actionRef.current = next;
    setAction(next);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !editor || saveDisabled || validating.current || actionRef.current) return;
    const epoch = generation.current;
    validating.current = true;
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit((value) => {
        if (epoch !== generation.current) return;
        validating.current = false;
        capture.current = {
          draft: structuredClone(value),
          ...(editor === 'new' ? {} : { id: editor }),
        };
        commandRow.current = null;
        propose(
          `/api/admin/agents${editor === 'new' ? '' : `/${editor}`}`,
          editor === 'new' ? 'POST' : 'PUT',
          label('save'),
          label('confirmSave'),
          agentBody(value)
        );
      })();
    } finally {
      if (epoch === generation.current) {
        validating.current = false;
        form.setValidationPending(false);
      }
    }
  }
  const detail = !isList && requested !== 'new' ? savedDetail.current : null;
  const deleteDisabled =
    denied || loading || error || detailLoading || detailError || changed || uncertain;
  const closeEditor = () => {
    if (workspace && workspace.view !== 'list') {
      if (workspace.agentId) workspace.showRecord(workspace.agentId);
      else workspace.showList();
    } else chooseEditor(null);
  };
  const agentActions = (row: Agent) => (
    <>
      {workspace && !disabled && !busy ? (
        <Link
          {...agentRoute(row.id, 'edit')}
          className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
          aria-label={`${label('edit')} ${row.title}`}
          data-table-action-tooltip={label('edit')}
        >
          <TableActionIcon icon={TablePencilIcon}>{label('edit')}</TableActionIcon>
        </Link>
      ) : (
        <Button
          variant="outline"
          disabled={disabled || busy}
          aria-label={`${label('edit')} ${row.title}`}
          onClick={() => chooseEditor(row.id)}
          data-table-action-tooltip={label('edit')}
        >
          <TableActionIcon icon={TablePencilIcon}>{label('edit')}</TableActionIcon>
        </Button>
      )}
      <Button
        variant="outline"
        disabled={deleteDisabled || busy}
        aria-label={`${label('delete')} ${row.title}`}
        onClick={() => {
          commandRow.current = row;
          propose(
            `/api/admin/agents/${row.id}`,
            'DELETE',
            label('delete'),
            `${row.title}. ${label('confirmDelete')}`
          );
        }}
        data-table-action-tooltip={label('delete')}
      >
        <TableActionIcon icon={TableTrash2Icon}>{label('delete')}</TableActionIcon>
      </Button>
    </>
  );
  function linkChoice(draft: Draft, [field, source]: (typeof sets)[number]) {
    return (
      <fieldset
        key={field}
        id={`agent-links-${field}`}
        ref={groupRefs[field]}
        tabIndex={-1}
        aria-invalid={!!form.errors[field] || undefined}
        aria-describedby={form.errors[field] ? form.errorId(field) : undefined}
        className="min-w-0 rounded-lg border px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-foreground"
      >
        <legend className="px-1 font-semibold">{label(source)}</legend>
        <AgentLinkChoiceList
          key={focusEpoch}
          locale={locale}
          group={label(source)}
          options={[
            ...choices[source],
            ...draft[field]
              .filter((id) => !choices[source].some((item) => item.id === id))
              .map((id) => ({
                id,
                title: `${label('unavailable')} (${savedDetail.current?.[source].find((item) => item.id === id)?.title ?? id})`,
              })),
          ]}
          selected={draft[field]}
          disabled={optionsLoading || optionsError}
          noOptions={label('noChoices')}
          onChange={form.field(field)[1]}
        />
        <CatalogueFieldFeedback
          compact
          id={form.errorId(field)}
          error={form.errors[field]}
          message={messages[field]}
        />
      </fieldset>
    );
  }
  const isEditor = workspace?.view === 'create' || workspace?.view === 'edit';
  const refreshButton = (
    <ListRefreshButton
      label={label('refresh')}
      disabled={loading || optionsLoading || detailLoading || pending}
      onClick={refresh}
    />
  );
  return (
    <div
      className={`mx-auto flex w-full min-w-0 flex-col gap-4 p-4 md:px-8 ${isEditor ? 'max-w-3xl' : 'max-w-5xl md:py-8'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {!isList && (
            <Link to="/admin/agents" className="inline-flex text-sm text-primary hover:underline">
              {label('title')}
            </Link>
          )}
          <h1
            ref={heading}
            data-slot="editor-heading"
            tabIndex={isList ? undefined : -1}
            className="text-2xl font-semibold outline-none! [overflow-wrap:anywhere]"
          >
            {isEditor ? (
              workspace.view === 'create' ? (
                label('add')
              ) : (
                copy('editAgent')
              )
            ) : detail ? (
              <bdi>{detail.title}</bdi>
            ) : (
              label(isList ? 'title' : 'editor')
            )}
          </h1>
          {isEditor && detail && (
            <p className="text-sm text-muted-foreground">
              <bdi>{detail.title}</bdi>
            </p>
          )}
        </div>
        {isEditor && refreshButton}
      </header>
      {isList && !denied && <StaffKnowledgeAssistant locale={locale} />}
      {(changed || uncertain) && (
        <>
          <Alert variant="destructive">{copy(uncertain ? 'uncertain' : 'changed')}</Alert>
          <Button
            type="button"
            variant="outline"
            disabled={resetUnavailable || busy || (uncertain && !recovered)}
            onClick={resetDraft}
          >
            {copy('reset')}
          </Button>
        </>
      )}
      <ListPage>
        {!isEditor && <ListPage.Toolbar>{refreshButton}</ListPage.Toolbar>}
        {denied ? (
          <p role="alert">{label('denied')}</p>
        ) : (
          <>
            <CommandFeedback message={saved ? label('saved') : null} />
            {optionsLoading && <LoadingStatus>{label('optionsLoading')}</LoadingStatus>}
            {optionsError && (
              <div role="alert">
                <p>{label('optionsError')}</p>
                <Button disabled={pending} onClick={() => setOptionsRevision((v) => v + 1)}>
                  {label('optionsRetry')}
                </Button>
              </div>
            )}
            {detailLoading &&
              (showDetails ? (
                <RecordDetailSkeleton label={label('detailLoading')} />
              ) : (
                <LoadingStatus>{label('detailLoading')}</LoadingStatus>
              ))}
            {detailError && (
              <div role="alert">
                <p>{label('detailError')}</p>
                <Button disabled={pending} onClick={() => setDetailRevision((v) => v + 1)}>
                  {label('detailRetry')}
                </Button>
              </div>
            )}
            {detailMissing && <Alert variant="destructive">{label('missing')}</Alert>}
            {workspace?.view === 'list' && !(loading || error || changed || uncertain || busy) && (
              <Link {...agentRoute('new')} className={buttonVariants({ className: 'min-h-11' })}>
                {label('add')}
              </Link>
            )}
            {!workspace && (
              <Button
                disabled={loading || error || changed || uncertain || busy}
                onClick={() => chooseEditor('new')}
              >
                {label('add')}
              </Button>
            )}

            {draft && (
              <form
                aria-label={label('editor')}
                noValidate
                aria-busy={form.pending || undefined}
                onSubmit={(event) => void save(event)}
                className={recordEditorSurface}
              >
                {catalogueRootMessage(form.errors) && (
                  <Alert variant="destructive" className="m-4">
                    {catalogueRootMessage(form.errors)}
                  </Alert>
                )}
                <fieldset disabled={busy} className="min-w-0">
                  <legend className="sr-only">{label('editor')}</legend>
                  <RecordEditorSection title={copy('basics')}>
                    <div className={recordEditorGrid}>
                      <div className={recordEditorField}>
                        <Label htmlFor="agent-title">{label('name')}</Label>
                        <Input
                          {...form.bind('title')}
                          id="agent-title"
                          required
                          aria-required="true"
                          maxLength={120}
                          value={draft.title}
                          dir="auto"
                          onChange={(event) => form.field('title')[1](event.target.value)}
                        />
                        <CatalogueFieldFeedback
                          compact
                          id={form.errorId('title')}
                          error={form.errors.title}
                          message={messages.title}
                        />
                      </div>
                      <div className={recordEditorField}>
                        <Label htmlFor="agent-model">{label('model')}</Label>
                        <CatalogueChoicePicker
                          key={focusEpoch}
                          id="agent-model"
                          locale={locale}
                          options={choices.models}
                          selected={draft.modelId}
                          disabled={busy || optionsLoading || optionsError}
                          field={form.bind('modelId')}
                          labels={{
                            search: copy('modelSearch'),
                            noMatches: copy('modelNoMatches'),
                            empty: copy('modelNone'),
                            unavailable:
                              savedDetail.current?.modelId === draft.modelId &&
                              savedDetail.current.modelTitle
                                ? `${savedDetail.current.modelTitle} · ${label('unavailable')}`
                                : label('unavailable'),
                          }}
                          onChange={form.field('modelId')[1]}
                        />
                        <CatalogueFieldFeedback
                          compact
                          id={form.errorId('modelId')}
                          error={form.errors.modelId}
                          message={messages.modelId}
                        />
                      </div>
                    </div>
                    <div className={recordEditorField}>
                      <Label htmlFor="agent-description">{label('description')}</Label>
                      <Textarea
                        {...form.bind('description')}
                        id="agent-description"
                        maxLength={2000}
                        value={draft.description}
                        placeholder={copy('descriptionPlaceholder')}
                        dir="auto"
                        rows={2}
                        className="max-h-40 min-h-14 resize-y placeholder-shown:[direction:inherit]"
                        onChange={(event) => form.field('description')[1](event.target.value)}
                      />
                      <CatalogueFieldFeedback
                        compact
                        id={form.errorId('description')}
                        error={form.errors.description}
                        message={messages.description}
                      />
                    </div>
                    <label className="flex min-h-8 w-fit cursor-pointer items-center gap-2 font-medium">
                      <input
                        {...form.bind('enabled')}
                        id="agent-enabled"
                        className="size-4 accent-primary"
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) => form.field('enabled')[1](event.target.checked)}
                      />
                      {label('enabled')}
                    </label>
                    {form.errors.enabled && (
                      <CatalogueFieldFeedback
                        compact
                        id={form.errorId('enabled')}
                        error={form.errors.enabled}
                        message={messages.enabled}
                      />
                    )}
                  </RecordEditorSection>
                  <RecordEditorSection title={copy('instructions')}>
                    <div className={recordEditorField}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label htmlFor="agent-system-prompt">{label('systemPrompt')}</Label>
                        {!draft.systemPrompt && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-border"
                            onClick={() => {
                              form.field('systemPrompt')[1](
                                (value) => value || copy('promptExample')
                              );
                              form.form.setFocus('systemPrompt');
                            }}
                          >
                            {copy('promptInsertExample')}
                          </Button>
                        )}
                      </div>
                      <p id="agent-prompt-guidance" className="pb-1 text-sm text-muted-foreground">
                        {copy('promptGuidance')}
                      </p>
                      <AgentPromptTextarea
                        {...form.bind('systemPrompt')}
                        id="agent-system-prompt"
                        maxLength={promptLimit}
                        value={draft.systemPrompt}
                        dir="auto"
                        rows={4}
                        aria-describedby={
                          form.errors.systemPrompt
                            ? `${form.errorId('systemPrompt')} agent-prompt-guidance agent-prompt-help agent-prompt-count`
                            : 'agent-prompt-guidance agent-prompt-help agent-prompt-count'
                        }
                        onChange={(event) => form.field('systemPrompt')[1](event.target.value)}
                      />
                      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                        <p id="agent-prompt-help">{copy('promptHelp')}</p>
                        <p id="agent-prompt-count" className="tabular-nums">
                          {copy('promptCount')
                            .replace('{used}', numbers.number(draft.systemPrompt.length))
                            .replace('{limit}', numbers.number(promptLimit))}
                        </p>
                      </div>
                      <CatalogueFieldFeedback
                        compact
                        id={form.errorId('systemPrompt')}
                        error={form.errors.systemPrompt}
                        message={messages.systemPrompt}
                      />
                    </div>
                  </RecordEditorSection>
                  <RecordEditorSection title={copy('responseSettings')}>
                    <div className={recordEditorGrid}>
                      {(
                        [
                          ['temperature', 'agent-temperature', 0, 2, 'any'],
                          ['maxTokens', 'agent-max-tokens', 1, 8192, '1'],
                        ] as const
                      ).map(([key, id, min, max, step]) => (
                        <div key={key} className={recordEditorField}>
                          <Label htmlFor={id}>{label(key)}</Label>
                          <RecordNumberInput
                            {...form.bind(key)}
                            id={id}
                            locale={locale}
                            min={min}
                            max={max}
                            step={step}
                            placeholder={label('modelDefault')}
                            value={draft[key]}
                            onChange={(value) => form.field(key)[1](value)}
                          />
                          <CatalogueFieldFeedback
                            compact
                            id={form.errorId(key)}
                            error={form.errors[key]}
                            message={messages[key]}
                          />
                        </div>
                      ))}
                    </div>
                  </RecordEditorSection>
                  <RecordEditorSection
                    title={copy('sources')}
                    description={copy('sourceSelectionHelp')}
                  >
                    <fieldset
                      {...form.bind('linkMode')}
                      id="agent-link-mode"
                      ref={linkModeRef}
                      role="radiogroup"
                      aria-labelledby="agent-link-mode-label"
                      aria-required="true"
                      className="min-w-0 space-y-2"
                    >
                      <legend id="agent-link-mode-label" className="mb-2 text-sm font-medium">
                        {label('linkMode')}
                      </legend>
                      <div className={recordEditorGrid}>
                        {(
                          [
                            ['any_kb', 'anyKb', 'anyBaseHelp'],
                            ['all_kbs', 'allKbs', 'allBasesHelp'],
                          ] as const
                        ).map(([value, title, help]) => (
                          <label
                            key={value}
                            className="flex min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 hover:bg-muted/40 has-checked:border-primary/45 has-checked:bg-primary/5 has-disabled:cursor-not-allowed has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
                          >
                            <input
                              name="linkMode"
                              type="radio"
                              value={value}
                              checked={draft.linkMode === value}
                              onChange={() => form.field('linkMode')[1](value)}
                              aria-labelledby={`agent-mode-${value}-label`}
                              aria-describedby={`agent-mode-${value}-help${form.errors.linkMode ? ` ${form.errorId('linkMode')}` : ''}`}
                              className="mt-1 size-4 shrink-0 accent-primary"
                            />
                            <span className="min-w-0 space-y-1">
                              <span
                                id={`agent-mode-${value}-label`}
                                className="block text-sm font-medium"
                              >
                                {label(title)}
                              </span>
                              <span
                                id={`agent-mode-${value}-help`}
                                className="block text-xs text-muted-foreground"
                              >
                                {copy(help)}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <CatalogueFieldFeedback
                        compact
                        id={form.errorId('linkMode')}
                        error={form.errors.linkMode}
                        message={messages.linkMode}
                      />
                    </fieldset>
                    <div className={recordEditorGrid}>
                      {sets
                        .filter(([field]) => field === 'kbIds' || field === 'kbGroupIds')
                        .map((choice) => linkChoice(draft, choice))}
                    </div>
                  </RecordEditorSection>
                  <RecordEditorSection
                    title={copy('responsePolicies')}
                    description={copy('policySelectionHelp')}
                  >
                    <div className={recordEditorGrid}>
                      {sets
                        .filter(([field]) => field === 'policyIds' || field === 'policyGroupIds')
                        .map((choice) => linkChoice(draft, choice))}
                    </div>
                  </RecordEditorSection>
                </fieldset>
                <RecordEditorActions>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || uncertain}
                    onClick={closeEditor}
                  >
                    {label('cancel')}
                  </Button>
                  <CatalogueSaveButton
                    label={label('save')}
                    pending={form.pending}
                    disabled={saveDisabled || busy}
                  />
                </RecordEditorActions>
              </form>
            )}
            {showDetails && detail && (
              <div className="space-y-4">
                <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={detail.enabled ? 'success' : 'outline'}>
                      {label(detail.enabled ? 'enabled' : 'disabled')}
                    </Badge>
                    {detail.description && (
                      <p
                        dir="auto"
                        className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-muted-foreground"
                      >
                        {detail.description}
                      </p>
                    )}
                  </div>
                  <dl className="grid gap-4 border-y py-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">{label('model')}</dt>
                      <dd className="[overflow-wrap:anywhere]">
                        <Link
                          to="/admin/ai-models/$modelId/{-$action}"
                          params={{ modelId: detail.modelId, action: undefined }}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          <bdi>{detail.modelTitle}</bdi>
                        </Link>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{label('linkMode')}</dt>
                      <dd>{label(detail.linkMode === 'any_kb' ? 'anyKb' : 'allKbs')}</dd>
                    </div>
                    {sets
                      .filter(([, source]) => detail[source].length > 0)
                      .map(([, source]) => (
                        <div key={source}>
                          <dt className="text-muted-foreground">{label(source)}</dt>
                          <dd>
                            <ul className="list-inside list-disc [overflow-wrap:anywhere]">
                              {detail[source].map((entry) => (
                                <li key={entry.id}>
                                  <Link
                                    to={agentDependencyRoutes[source]}
                                    params={{ recordId: entry.id, action: undefined }}
                                    className="text-primary underline-offset-4 hover:underline"
                                  >
                                    <bdi>{entry.title}</bdi>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </dd>
                        </div>
                      ))}
                  </dl>
                  <div className="flex flex-wrap gap-2">{agentActions(detail)}</div>
                </section>
                <AgentServingSurfaces agentId={detail.id} locale={locale} />
              </div>
            )}
            {isList && (
              <ListPage.Content
                loading={loading}
                error={error}
                empty={!rows.length}
                retainContent={rows.length > 0}
                loadingView={
                  <RecordListSkeleton label={label('loading')} view="card" headings={[]} />
                }
                errorView={
                  <div role="alert">
                    <p>{label('error')}</p>
                    <Button disabled={pending} onClick={() => setRevision((v) => v + 1)}>
                      {label('retry')}
                    </Button>
                  </div>
                }
                emptyView={<p>{label('empty')}</p>}
              >
                <CatalogueRecordTable
                  rows={rows}
                  locale={locale}
                  caption={label('title')}
                  nameLabel={label('name')}
                  detailsLabel={copy('tableDetails')}
                  actionsLabel={copy('tableActions')}
                  {...(workspace && {
                    renderTitle: (row: Agent) => (
                      <Link
                        {...agentRoute(row.id)}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        <bdi>{row.title}</bdi>
                      </Link>
                    ),
                  })}
                  renderDetails={(row) => (
                    <div className="space-y-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={row.enabled ? 'success' : 'outline'}>
                          {label(row.enabled ? 'enabled' : 'disabled')}
                        </Badge>
                        <p className="wrap-anywhere text-muted-foreground">
                          {label('model')} <bdi className="text-foreground">{row.modelTitle}</bdi>
                        </p>
                      </div>
                      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                        <div className="flex gap-2">
                          <dt>{copy('linkedKbs')}</dt>
                          <dd>{row.kbCount === undefined ? '—' : numbers.number(row.kbCount)}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt>{copy('linkedPolicies')}</dt>
                          <dd>
                            {row.policyCount === undefined ? '—' : numbers.number(row.policyCount)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )}
                  renderActions={agentActions}
                />
              </ListPage.Content>
            )}

            {(isList || showDetails) && (
              <AdminAgentTestChat
                agents={rows}
                locale={locale}
                disabled={denied || loading || error}
                onDenied={deny}
              />
            )}
          </>
        )}
      </ListPage>
      {action && (
        <Suspense fallback={<p role="status">{label('loading')}</p>}>
          <TeamActionDialog
            action={action}
            confirmationDisabled={
              action.method === 'DELETE'
                ? deleteDisabled
                : disabled || saveDisabled || !draft || !eligible(draft, choices)
            }
            summary={recovery}
            onPendingChange={onPendingChange}
            onDenied={deny}
            onUnconfirmed={() => {
              if (actionRef.current === action) unconfirmed();
            }}
            onValidationError={(fields) => (capture.current ? ownedFields(fields) : false)}
            onClose={withdraw}
            onSuccess={((command, epoch) => async (value: unknown) => {
              if (epoch !== generation.current || actionRef.current !== command) return;
              const captured = capture.current;
              if (captured) {
                if (!matchesAgentReceipt(value, captured.draft, captured.id))
                  throw new Error('Unconfirmed agent settings');
                const controller = new AbortController();
                requests.current.add(controller);
                try {
                  const detail = await read(
                    `/api/admin/agents/${encodeURIComponent(value.id)}`,
                    controller
                  );
                  if (
                    controller.signal.aborted ||
                    epoch !== generation.current ||
                    actionRef.current !== command
                  )
                    return;
                  if (!matchesAgentDetail(detail, captured.draft, value.id))
                    throw new Error('Unconfirmed agent links');
                } finally {
                  requests.current.delete(controller);
                }
                if (workspace && workspace.view !== 'list') {
                  toast.success(label('saved'));
                  workspace.showRecord(value.id, true);
                  return;
                }
              }
              if (command.method === 'DELETE' && showDetails && workspace) {
                toast.success(label('saved'));
                workspace.showList();
                return;
              }
              if (command.method !== 'DELETE' || command.path.endsWith(`/${work.current.editor}`)) {
                setEditor(null);
                setDraft(null);
                detailBasis.current = null;
                savedDetail.current = null;
              }
              commandRow.current = null;
              setSaved(true);
              setRevision((v) => v + 1);
              setOptionsRevision((v) => v + 1);
            })(action, commandGeneration.current)}
          />
        </Suspense>
      )}
    </div>
  );
}

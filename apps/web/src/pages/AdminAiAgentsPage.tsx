import { CatalogueRecordTable } from '../components/CatalogueRecordTable.js';
import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  lazy,
  Suspense,
  type FormEvent,
} from 'react';
import { Alert, Button, Input, Label, ListPage } from '@barghsa/ui';
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
const TeamActionDialog = lazy(() =>
  import('../components/TeamActionDialog.js').then((module) => ({
    default: module.TeamActionDialog,
  }))
);
import { AgentPromptTextarea } from '../components/AgentPromptTextarea.js';
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
export default function AdminAiAgentsPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.agents.${key}`, locale);
  const numbers = useNumberFormatting(locale);
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
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [denied, setDenied] = useState(false),
    [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  const [optionsRevision, setOptionsRevision] = useState(0),
    [optionsLoading, setOptionsLoading] = useState(true),
    [optionsError, setOptionsError] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState(false);
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
    clearWork();
  }, [clearWork]);
  const read = useCallback(
    async (path: string, controller: AbortController): Promise<unknown> => {
      const response = await fetch(path, { signal: controller.signal });
      if (controller.signal.aborted) throw new Error('Obsolete');
      if (response.status === 401 || response.status === 403) {
        deny();
        throw new Error('Denied');
      }
      if (!response.ok) throw new Error('Unavailable');
      return response.json();
    },
    [deny]
  );
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  useEffect(() => {
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
  }, [revision, read, withdraw]);
  useEffect(() => {
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
  }, [optionsRevision, read, withdraw]);
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
    void (async () => {
      try {
        const data = await read(`/api/admin/agents/${encodeURIComponent(editor)}`, controller);
        if (controller.signal.aborted) return;
        if (!validDetail(data, editor)) throw new Error('Invalid detail');
        const nextBasis = detailSnapshot(data);
        savedDetail.current = data;
        acceptRead('detail', detailRevision);
        if (detailBasis.current && detailBasis.current !== nextBasis) {
          withdraw();
          setChanged(true);
        } else if (!detailBasis.current) setDraft(agentDraftFor(data));
        detailBasis.current = nextBasis;
      } catch {
        if (!controller.signal.aborted) setDetailError(true);
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    })();
    return () => {
      controller.abort();
      requests.current.delete(controller);
    };
  }, [editor, detailRevision, read, withdraw, setDraft]);
  function chooseEditor(value: string | null) {
    withdraw();
    detailBasis.current = null;
    savedDetail.current = null;
    setEditor(value);
    setDraft(value === 'new' ? blank() : null);
    setSaved(false);
    setDetailError(false);
    setChanged(false);
  }
  const unavailable =
    denied || loading || error || optionsLoading || optionsError || detailLoading || detailError;
  const disabled = unavailable || changed || uncertain;
  const busy = form.pending || !!action;
  const choices = options ?? emptyOptions;
  const saveDisabled = disabled || !draft;
  const refresh = () => {
    if (networkPending.current) return;
    if (validating.current) withdraw();
    setRevision((v) => v + 1);
    setOptionsRevision((v) => v + 1);
    setDetailRevision((v) => v + 1);
  };
  function unconfirmed() {
    requiredReads.current = {
      list: revision + 1,
      options: optionsRevision + 1,
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
      {loading && <p role="status">{label('loading')}</p>}
      {error && (
        <div role="alert">
          <p>{label('error')}</p>
          <Button type="button" disabled={pending} onClick={() => setRevision((v) => v + 1)}>
            {label('retry')}
          </Button>
        </div>
      )}
      {optionsLoading && <p role="status">{label('optionsLoading')}</p>}
      {optionsError && (
        <div role="alert">
          <p>{label('optionsError')}</p>
          <Button type="button" disabled={pending} onClick={() => setOptionsRevision((v) => v + 1)}>
            {label('optionsRetry')}
          </Button>
        </div>
      )}
      {detailLoading && <p role="status">{label('detailLoading')}</p>}
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
      (method === 'DELETE' ? denied || loading || error || changed || uncertain : disabled)
    )
      return;
    commandGeneration.current = generation.current;
    setSaved(false);
    const next: TeamAction = {
      path,
      method,
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
  return (
    <div
      className="mx-auto min-w-0 flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      {!denied && <StaffKnowledgeAssistant locale={locale} />}
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
        <ListPage.Toolbar>
          <Button
            variant="outline"
            disabled={loading || optionsLoading || detailLoading || pending}
            onClick={refresh}
          >
            {label('refresh')}
          </Button>
        </ListPage.Toolbar>
        {denied ? (
          <p role="alert">{label('denied')}</p>
        ) : (
          <>
            {saved && <p role="status">{label('saved')}</p>}
            {optionsLoading && <p role="status">{label('optionsLoading')}</p>}
            {optionsError && (
              <div role="alert">
                <p>{label('optionsError')}</p>
                <Button disabled={pending} onClick={() => setOptionsRevision((v) => v + 1)}>
                  {label('optionsRetry')}
                </Button>
              </div>
            )}
            {detailLoading && <p role="status">{label('detailLoading')}</p>}
            {detailError && (
              <div role="alert">
                <p>{label('detailError')}</p>
                <Button disabled={pending} onClick={() => setDetailRevision((v) => v + 1)}>
                  {label('detailRetry')}
                </Button>
              </div>
            )}
            <Button
              disabled={loading || error || changed || uncertain || busy}
              onClick={() => chooseEditor('new')}
            >
              {label('add')}
            </Button>

            {draft && (
              <form
                aria-label={label('editor')}
                noValidate
                aria-busy={form.pending || undefined}
                onSubmit={(event) => void save(event)}
                className="flex flex-col gap-4 border-y py-5"
              >
                {catalogueRootMessage(form.errors) && (
                  <Alert variant="destructive">{catalogueRootMessage(form.errors)}</Alert>
                )}
                <fieldset disabled={busy} className="min-w-0 space-y-4">
                  <legend className="sr-only">{label('editor')}</legend>
                  {(
                    [
                      ['title', 'name', 'agent-title', 120],
                      ['description', 'description', 'agent-description', 2000],
                      ['systemPrompt', 'systemPrompt', 'agent-system-prompt', 8000],
                    ] as const
                  ).map(([key, labelKey, id, max]) => (
                    <div key={key} className="flex flex-col gap-2">
                      <Label htmlFor={id}>{label(labelKey)}</Label>
                      {key === 'title' ? (
                        <Input
                          {...form.bind(key)}
                          id={id}
                          required
                          maxLength={max}
                          value={draft[key]}
                          dir="auto"
                          onChange={(event) => form.field(key)[1](event.target.value)}
                        />
                      ) : key === 'systemPrompt' ? (
                        <AgentPromptTextarea
                          {...form.bind(key)}
                          id={id}
                          maxLength={max}
                          value={draft[key]}
                          dir="auto"
                          aria-describedby={`${form.errorId(key)} agent-prompt-help`}
                          onChange={(event) => form.field(key)[1](event.target.value)}
                        />
                      ) : (
                        <textarea
                          {...form.bind(key)}
                          id={id}
                          className="min-h-24 rounded-md border bg-background p-3"
                          maxLength={max}
                          value={draft[key]}
                          dir="auto"
                          onChange={(event) => form.field(key)[1](event.target.value)}
                        />
                      )}
                      {key === 'systemPrompt' && (
                        <p id="agent-prompt-help" className="text-sm text-foreground">
                          {copy('promptHelp')}
                        </p>
                      )}
                      <CatalogueFieldFeedback
                        id={form.errorId(key)}
                        error={form.errors[key]}
                        message={messages[key]}
                      />
                    </div>
                  ))}
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor="agent-model">{label('model')}</Label>
                    <select
                      {...form.bind('modelId')}
                      id="agent-model"
                      className="max-w-full rounded-md border bg-background p-2"
                      required
                      value={draft.modelId}
                      onChange={(event) => form.field('modelId')[1](event.target.value)}
                    >
                      <option value="">{label('chooseModel')}</option>
                      {draft.modelId && !choices.models.some((m) => m.id === draft.modelId) && (
                        <option value={draft.modelId}>
                          {label('unavailable')} ({draft.modelId})
                        </option>
                      )}
                      {choices.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.title}
                        </option>
                      ))}
                    </select>
                    <CatalogueFieldFeedback
                      id={form.errorId('modelId')}
                      error={form.errors.modelId}
                      message={messages.modelId}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {(
                      [
                        ['temperature', 'agent-temperature', 0, 2, 'any'],
                        ['maxTokens', 'agent-max-tokens', 1, 8192, '1'],
                      ] as const
                    ).map(([key, id, min, max, step]) => (
                      <div key={key} className="flex flex-col gap-2">
                        <Label htmlFor={id}>{label(key)}</Label>
                        <Input
                          {...form.bind(key)}
                          id={id}
                          type="number"
                          dir="ltr"
                          min={min}
                          max={max}
                          step={step}
                          placeholder={label('modelDefault')}
                          value={draft[key]}
                          onChange={(event) => form.field(key)[1](event.target.value)}
                        />
                        <CatalogueFieldFeedback
                          id={form.errorId(key)}
                          error={form.errors[key]}
                          message={messages[key]}
                        />
                      </div>
                    ))}
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="agent-link-mode">{label('linkMode')}</Label>
                      <select
                        {...form.bind('linkMode')}
                        id="agent-link-mode"
                        className="max-w-full rounded-md border bg-background p-2"
                        value={draft.linkMode}
                        onChange={(event) =>
                          form.field('linkMode')[1](event.target.value as Draft['linkMode'])
                        }
                      >
                        <option value="any_kb">{label('anyKb')}</option>
                        <option value="all_kbs">{label('allKbs')}</option>
                      </select>
                      <CatalogueFieldFeedback
                        id={form.errorId('linkMode')}
                        error={form.errors.linkMode}
                        message={messages.linkMode}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      {...form.bind('enabled')}
                      id="agent-enabled"
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => form.field('enabled')[1](event.target.checked)}
                    />
                    {label('enabled')}
                  </label>
                  <CatalogueFieldFeedback
                    id={form.errorId('enabled')}
                    error={form.errors.enabled}
                    message={messages.enabled}
                  />
                  <div className="grid gap-5 sm:grid-cols-2">
                    {sets.map(([field, source]) => (
                      <fieldset
                        key={field}
                        ref={groupRefs[field]}
                        tabIndex={-1}
                        aria-invalid={!!form.errors[field] || undefined}
                        aria-describedby={form.errors[field] ? form.errorId(field) : undefined}
                        className="min-w-0 rounded-md border p-4 outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                      >
                        <legend className="px-1 font-semibold">{label(source)}</legend>
                        <p className="mb-3 text-sm text-muted-foreground">
                          {label('selectionHelp')}
                        </p>
                        {!choices[source].length && <p>{label('noChoices')}</p>}
                        <div className="flex max-h-60 flex-col gap-3 overflow-y-auto">
                          {[
                            ...choices[source],
                            ...draft[field]
                              .filter((id) => !choices[source].some((item) => item.id === id))
                              .map((id) => ({ id, title: `${label('unavailable')} (${id})` })),
                          ].map((item) => (
                            <label key={item.id} className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={draft[field].includes(item.id)}
                                disabled={
                                  optionsLoading ||
                                  optionsError ||
                                  (!draft[field].includes(item.id) && draft[field].length >= 200)
                                }
                                onChange={(event) =>
                                  form.field(field)[1](
                                    event.target.checked
                                      ? [...draft[field], item.id]
                                      : draft[field].filter((id) => id !== item.id)
                                  )
                                }
                              />
                              <span className="min-w-0 break-words">{item.title}</span>
                            </label>
                          ))}
                        </div>
                        <CatalogueFieldFeedback
                          id={form.errorId(field)}
                          error={form.errors[field]}
                          message={messages[field]}
                        />
                      </fieldset>
                    ))}
                  </div>
                </fieldset>
                <div className="flex gap-2">
                  <CatalogueSaveButton
                    label={label('save')}
                    pending={form.pending}
                    disabled={saveDisabled || busy}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || uncertain}
                    onClick={() => chooseEditor(null)}
                  >
                    {label('cancel')}
                  </Button>
                </div>
              </form>
            )}
            <ListPage.Content
              loading={loading}
              error={error}
              empty={!rows.length}
              retainContent={rows.length > 0}
              loadingView={<p role="status">{label('loading')}</p>}
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
                renderDetails={(row) => (
                  <div className="space-y-2 text-sm">
                    <p className="break-words text-sm">
                      {label('model')}: {row.modelTitle}
                    </p>
                    <span className="text-sm">{label(row.enabled ? 'enabled' : 'disabled')}</span>
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
                renderActions={(row) => (
                  <>
                    <Button
                      variant="outline"
                      disabled={disabled || busy}
                      aria-label={`${label('edit')} ${row.title}`}
                      onClick={() => chooseEditor(row.id)}
                    >
                      {label('edit')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={loading || error || changed || uncertain || busy}
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
                    >
                      {label('delete')}
                    </Button>
                  </>
                )}
              />
            </ListPage.Content>
            <AdminAgentTestChat
              agents={rows}
              locale={locale}
              disabled={denied || loading || error}
              onDenied={deny}
            />
          </>
        )}
      </ListPage>
      {action && (
        <Suspense fallback={<p role="status">{label('loading')}</p>}>
          <TeamActionDialog
            action={action}
            confirmationDisabled={
              action.method === 'DELETE'
                ? denied || loading || error || changed || uncertain
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

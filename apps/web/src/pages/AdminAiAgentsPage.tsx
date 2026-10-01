import { useEffect, useState, useRef, useCallback, type FormEvent } from 'react';
import { Button, Input, Label, ListPage } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { AdminAgentTestChat } from '../components/AdminAgentTestChat.js';
interface Ref {
  id: string;
  title: string;
}
interface Agent extends Ref {
  description: string;
  modelId: string;
  modelTitle: string;
  enabled: boolean;
}
interface Detail extends Agent {
  systemPrompt: string;
  temperature: number | null;
  maxTokens: number | null;
  linkMode: 'any_kb' | 'all_kbs';
  kbs: Ref[];
  policies: Ref[];
  kbGroups: Ref[];
  policyGroups: Ref[];
}
interface Options {
  models: Ref[];
  kbs: Ref[];
  policies: Ref[];
  kbGroups: Ref[];
  policyGroups: Ref[];
}
interface Draft {
  title: string;
  description: string;
  modelId: string;
  systemPrompt: string;
  temperature: number | null;
  maxTokens: number | null;
  linkMode: 'any_kb' | 'all_kbs';
  enabled: boolean;
  kbIds: string[];
  policyIds: string[];
  kbGroupIds: string[];
  policyGroupIds: string[];
}
const sets = [
  ['kbIds', 'kbs'],
  ['policyIds', 'policies'],
  ['kbGroupIds', 'kbGroups'],
  ['policyGroupIds', 'policyGroups'],
] as const;
const emptyOptions: Options = { models: [], kbs: [], policies: [], kbGroups: [], policyGroups: [] };
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function refs(value: unknown): value is Ref[] {
  return (
    Array.isArray(value) &&
    value.every((v) => record(v) && typeof v.id === 'string' && typeof v.title === 'string')
  );
}
function validAgents(value: unknown): value is Agent[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        record(v) &&
        ['id', 'title', 'description', 'modelId', 'modelTitle'].every(
          (k) => typeof v[k] === 'string'
        ) &&
        typeof v.enabled === 'boolean'
    )
  );
}
function validOptions(value: unknown): value is Options {
  return (
    record(value) &&
    ['models', 'kbs', 'policies', 'kbGroups', 'policyGroups'].every((k) => refs(value[k]))
  );
}
function validDetail(value: unknown, id: string): value is Detail {
  return (
    record(value) &&
    validAgents([value]) &&
    value.id === id &&
    typeof value.systemPrompt === 'string' &&
    (value.temperature === null || typeof value.temperature === 'number') &&
    (value.maxTokens === null || typeof value.maxTokens === 'number') &&
    ['any_kb', 'all_kbs'].includes(String(value.linkMode)) &&
    ['kbs', 'policies', 'kbGroups', 'policyGroups'].every((k) => refs(value[k]))
  );
}
function detailSnapshot(data: Detail) {
  return JSON.stringify({
    title: data.title,
    description: data.description,
    modelId: data.modelId,
    enabled: data.enabled,
    systemPrompt: data.systemPrompt,
    temperature: data.temperature,
    maxTokens: data.maxTokens,
    linkMode: data.linkMode,
    kbs: data.kbs.map((v) => v.id).sort(),
    policies: data.policies.map((v) => v.id).sort(),
    kbGroups: data.kbGroups.map((v) => v.id).sort(),
    policyGroups: data.policyGroups.map((v) => v.id).sort(),
  });
}
function rowBasis(row: Agent) {
  return JSON.stringify({
    id: row.id,
    title: row.title,
    description: row.description,
    modelId: row.modelId,
    enabled: row.enabled,
  });
}
function eligible(draft: Draft, options: Options) {
  return (
    options.models.some((m) => m.id === draft.modelId) &&
    sets.every(([field, source]) =>
      draft[field].every((id) => options[source].some((item) => item.id === id))
    )
  );
}
const blank = (): Draft => ({
  title: '',
  description: '',
  modelId: '',
  systemPrompt: '',
  temperature: null,
  maxTokens: null,
  linkMode: 'any_kb',
  enabled: true,
  kbIds: [],
  policyIds: [],
  kbGroupIds: [],
  policyGroupIds: [],
});
export default function AdminAiAgentsPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.agents.${key}`, locale);
  const [rows, setRows] = useState<Agent[]>([]),
    [options, setOptions] = useState<Options | null>(null),
    [editor, setEditor] = useState<string | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
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
  const clearWork = useCallback(() => {
    generation.current++;
    setEditor(null);
    setDraft(null);
    setAction(null);
    setSaved(false);
    detailBasis.current = null;
    commandRow.current = null;
  }, []);
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
          (selected &&
            selected !== 'new' &&
            (!fresh || (old && rowBasis(old) !== rowBasis(fresh)))) ||
          (command &&
            !data.some((row) => row.id === command.id && rowBasis(row) === rowBasis(command)))
        )
          clearWork();
        previousRows.current = data;
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
  }, [revision, read, clearWork]);
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
          generation.current++;
          setAction(null);
          commandRow.current = null;
        }
        setOptions(data);
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
  }, [optionsRevision, read]);
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
        if (detailBasis.current && detailBasis.current !== nextBasis) {
          clearWork();
          return;
        }
        if (!detailBasis.current)
          setDraft({
            title: data.title,
            description: data.description,
            modelId: data.modelId,
            systemPrompt: data.systemPrompt,
            temperature: data.temperature,
            maxTokens: data.maxTokens,
            linkMode: data.linkMode,
            enabled: data.enabled,
            kbIds: data.kbs.map((item) => item.id),
            policyIds: data.policies.map((item) => item.id),
            kbGroupIds: data.kbGroups.map((item) => item.id),
            policyGroupIds: data.policyGroups.map((item) => item.id),
          });
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
  }, [editor, detailRevision, read, clearWork]);
  function chooseEditor(value: string | null) {
    generation.current++;
    setAction(null);
    commandRow.current = null;
    detailBasis.current = null;
    setEditor(value);
    setDraft(value === 'new' ? blank() : null);
    setSaved(false);
    setDetailError(false);
  }
  const disabled =
    denied || loading || error || optionsLoading || optionsError || detailLoading || detailError;
  const choices = options ?? emptyOptions;
  const saveDisabled = disabled || !draft || !eligible(draft, choices);
  const refresh = () => {
    setRevision((v) => v + 1);
    setOptionsRevision((v) => v + 1);
    setDetailRevision((v) => v + 1);
  };
  const recovery = (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={loading || optionsLoading || detailLoading}
        onClick={refresh}
      >
        {label('refresh')}
      </Button>
      {loading && <p role="status">{label('loading')}</p>}
      {error && (
        <div role="alert">
          <p>{label('error')}</p>
          <Button type="button" onClick={() => setRevision((v) => v + 1)}>
            {label('retry')}
          </Button>
        </div>
      )}
      {optionsLoading && <p role="status">{label('optionsLoading')}</p>}
      {optionsError && (
        <div role="alert">
          <p>{label('optionsError')}</p>
          <Button type="button" onClick={() => setOptionsRevision((v) => v + 1)}>
            {label('optionsRetry')}
          </Button>
        </div>
      )}
      {detailLoading && <p role="status">{label('detailLoading')}</p>}
      {detailError && (
        <div role="alert">
          <p>{label('detailError')}</p>
          <Button type="button" onClick={() => setDetailRevision((v) => v + 1)}>
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
    if (method === 'DELETE' ? denied || loading || error : disabled) return;
    commandGeneration.current = generation.current;
    setSaved(false);
    setAction({
      path,
      method,
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
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !editor || saveDisabled) return;
    commandRow.current = null;
    propose(
      `/api/admin/agents${editor === 'new' ? '' : `/${editor}`}`,
      editor === 'new' ? 'POST' : 'PUT',
      label('save'),
      label('confirmSave'),
      { ...draft, title: draft.title.trim() }
    );
  }
  return (
    <div
      className="mx-auto min-w-0 flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <ListPage>
        <ListPage.Toolbar>
          <Button
            variant="outline"
            disabled={loading || optionsLoading || detailLoading}
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
                <Button onClick={() => setOptionsRevision((v) => v + 1)}>
                  {label('optionsRetry')}
                </Button>
              </div>
            )}
            {detailLoading && <p role="status">{label('detailLoading')}</p>}
            {detailError && (
              <div role="alert">
                <p>{label('detailError')}</p>
                <Button onClick={() => setDetailRevision((v) => v + 1)}>
                  {label('detailRetry')}
                </Button>
              </div>
            )}
            <Button disabled={loading || error} onClick={() => chooseEditor('new')}>
              {label('add')}
            </Button>
            {draft && (
              <form
                aria-label={label('editor')}
                onSubmit={save}
                className="flex flex-col gap-4 border-y py-5"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="agent-title">{label('name')}</Label>
                  <Input
                    id="agent-title"
                    required
                    maxLength={120}
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="agent-description">{label('description')}</Label>
                  <textarea
                    id="agent-description"
                    className="min-h-24 rounded-md border bg-background p-3"
                    maxLength={2000}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor="agent-model">{label('model')}</Label>
                  <select
                    id="agent-model"
                    className="max-w-full rounded-md border bg-background p-2"
                    required
                    value={draft.modelId}
                    onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
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
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="agent-system-prompt">{label('systemPrompt')}</Label>
                  <textarea
                    id="agent-system-prompt"
                    className="min-h-40 rounded-md border bg-background p-3"
                    maxLength={8000}
                    value={draft.systemPrompt}
                    onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="agent-temperature">{label('temperature')}</Label>
                    <Input
                      id="agent-temperature"
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      placeholder={label('modelDefault')}
                      value={draft.temperature ?? ''}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          temperature:
                            event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="agent-max-tokens">{label('maxTokens')}</Label>
                    <Input
                      id="agent-max-tokens"
                      type="number"
                      min={1}
                      max={8192}
                      step={1}
                      placeholder={label('modelDefault')}
                      value={draft.maxTokens ?? ''}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          maxTokens: event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="agent-link-mode">{label('linkMode')}</Label>
                    <select
                      id="agent-link-mode"
                      className="max-w-full rounded-md border bg-background p-2"
                      value={draft.linkMode}
                      onChange={(event) =>
                        setDraft({ ...draft, linkMode: event.target.value as Draft['linkMode'] })
                      }
                    >
                      <option value="any_kb">{label('anyKb')}</option>
                      <option value="all_kbs">{label('allKbs')}</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                  />
                  {label('enabled')}
                </label>
                <div className="grid gap-5 sm:grid-cols-2">
                  {sets.map(([field, source]) => (
                    <fieldset key={field} className="min-w-0 rounded-md border p-4">
                      <legend className="px-1 font-semibold">{label(source)}</legend>
                      <p className="mb-3 text-sm text-muted-foreground">{label('selectionHelp')}</p>
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
                                setDraft({
                                  ...draft,
                                  [field]: event.target.checked
                                    ? [...draft[field], item.id]
                                    : draft[field].filter((id) => id !== item.id),
                                })
                              }
                            />
                            <span className="min-w-0 break-words">{item.title}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={saveDisabled || !draft.title.trim()}>
                    {label('save')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => chooseEditor(null)}>
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
                  <Button onClick={() => setRevision((v) => v + 1)}>{label('retry')}</Button>
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
                      <p className="break-words text-sm">
                        {label('model')}: {row.modelTitle}
                      </p>
                      <span className="text-sm">{label(row.enabled ? 'enabled' : 'disabled')}</span>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={disabled}
                        aria-label={`${label('edit')} ${row.title}`}
                        onClick={() => chooseEditor(row.id)}
                      >
                        {label('edit')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={loading || error}
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
                    </div>
                  </li>
                ))}
              </ul>
            </ListPage.Content>
            <AdminAgentTestChat agents={rows} locale={locale} />
          </>
        )}
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={
            action.method === 'DELETE' ? denied || loading || error : disabled || saveDisabled
          }
          summary={recovery}
          onClose={() => {
            generation.current++;
            setAction(null);
            commandRow.current = null;
          }}
          onSuccess={((command, commandVersion) => async () => {
            if (commandVersion !== generation.current) return;
            if (command.method !== 'DELETE' || command.path.endsWith(`/${work.current.editor}`)) {
              setEditor(null);
              setDraft(null);
              detailBasis.current = null;
            }
            commandRow.current = null;
            setSaved(true);
            setRevision((v) => v + 1);
            setOptionsRevision((v) => v + 1);
          })(action, commandGeneration.current)}
        />
      )}
    </div>
  );
}

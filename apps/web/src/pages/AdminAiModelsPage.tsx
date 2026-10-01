import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useEffect, useState, useRef, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label, ListPage, ScrollArea } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
interface Model {
  id: string;
  title: string;
  providerType: 'openai_compatible' | 'anthropic';
  baseUrl: string;
  modelName: string;
  config: { max_tokens: number; temperature: number };
  isEnabled: boolean;
  apiTokenMasked: string;
  status: 'reachable' | 'unreachable' | 'unknown';
  lastTestedAt: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  circuitOpen: boolean;
  circuitCooldownUntil: string | null;
  budget: {
    monthlyTokenLimit: number | null;
    monthlyCostLimitMicros: number | null;
    inputPricePerMillionMicros: number;
    outputPricePerMillionMicros: number;
    usedInputTokens: number;
    usedOutputTokens: number;
    usedCostMicros: number;
    periodStart: string;
    alertedAt: string | null;
  } | null;
}
interface BudgetDraft {
  modelId: string;
  modelTitle: string;
  monthlyTokenLimit: string;
  monthlyCostUsd: string;
  inputPriceUsd: string;
  outputPriceUsd: string;
}
interface Draft {
  id?: string;
  title: string;
  providerType: Model['providerType'];
  baseUrl: string;
  modelName: string;
  maxTokens: number;
  temperature: number;
  apiToken: string;
  tokenChoice: 'keep' | 'replace' | 'clear';
  masked: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validModels(value: unknown): value is Model[] {
  return (
    Array.isArray(value) &&
    value.every((m) => {
      if (!record(m)) return false;
      const budget = m.budget;
      return (
        ['id', 'title', 'baseUrl', 'modelName', 'apiTokenMasked'].every(
          (k) => typeof m[k] === 'string'
        ) &&
        ['openai_compatible', 'anthropic'].includes(String(m.providerType)) &&
        typeof m.isEnabled === 'boolean' &&
        ['reachable', 'unreachable', 'unknown'].includes(String(m.status)) &&
        record(m.config) &&
        typeof m.config.max_tokens === 'number' &&
        typeof m.config.temperature === 'number' &&
        (budget === null ||
          (record(budget) &&
            ['monthlyTokenLimit', 'monthlyCostLimitMicros'].every(
              (k) => budget[k] === null || typeof budget[k] === 'number'
            ) &&
            [
              'inputPricePerMillionMicros',
              'outputPricePerMillionMicros',
              'usedInputTokens',
              'usedOutputTokens',
              'usedCostMicros',
            ].every((k) => typeof budget[k] === 'number')))
      );
    })
  );
}
function modelBasis(model: Model, kind: 'model' | 'budget' | 'command') {
  if (kind === 'budget')
    return JSON.stringify({
      monthlyTokenLimit: model.budget?.monthlyTokenLimit ?? null,
      monthlyCostLimitMicros: model.budget?.monthlyCostLimitMicros ?? null,
      inputPricePerMillionMicros: model.budget?.inputPricePerMillionMicros ?? 0,
      outputPricePerMillionMicros: model.budget?.outputPricePerMillionMicros ?? 0,
    });
  return JSON.stringify({
    title: model.title,
    providerType: model.providerType,
    baseUrl: model.baseUrl,
    modelName: model.modelName,
    config: model.config,
    isEnabled: model.isEnabled,
    apiTokenMasked: model.apiTokenMasked,
    ...(kind === 'command' ? { status: model.status } : {}),
  });
}
const blank = (): Draft => ({
  title: '',
  providerType: 'openai_compatible',
  baseUrl: '',
  modelName: '',
  maxTokens: 256,
  temperature: 0,
  apiToken: '',
  tokenChoice: 'replace',
  masked: '',
});
export default function AdminAiModelsPage() {
  const time = useAccountTime();
  const locale = useLocale(),
    label = (key: string) => t(`admin.aiModels.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const [models, setModels] = useState<Model[]>([]),
    [loading, setLoading] = useState(true),
    [denied, setDenied] = useState(false),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null),
    [budgetDraft, setBudgetDraft] = useState<BudgetDraft | null>(null),
    [action, setAction] = useState<TeamAction | null>(null),
    [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const currentWork = useRef({ draft, budgetDraft });
  currentWork.current = { draft, budgetDraft };
  const previousModels = useRef<Model[]>([]);
  const generation = useRef(0);
  const commandGeneration = useRef(0);
  const commandBasis = useRef<{ id: string; basis: string } | null>(null);
  function clearWork() {
    generation.current++;
    setDraft(null);
    setBudgetDraft(null);
    setAction(null);
    setResult(null);
    commandBasis.current = null;
  }
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const response = await fetch('/api/admin/ai-models', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          clearWork();
          previousModels.current = [];
          setModels([]);
          setDenied(true);
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const rows: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (!validModels(rows)) throw new Error('Invalid models');
        const { draft: editing, budgetDraft: budget } = currentWork.current;
        const changed = (id: string, kind: 'model' | 'budget') => {
          const old = previousModels.current.find((m) => m.id === id),
            fresh = rows.find((m) => m.id === id);
          return !old || !fresh || modelBasis(old, kind) !== modelBasis(fresh, kind);
        };
        const command = commandBasis.current;
        if (
          (editing?.id && changed(editing.id, 'model')) ||
          (budget && changed(budget.modelId, 'budget')) ||
          (command &&
            !rows.some((m) => m.id === command.id && modelBasis(m, 'command') === command.basis))
        )
          clearWork();
        previousModels.current = rows;
        setModels(rows);
        setDenied(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);
  const disabled = loading || error || denied;
  const recovery = (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={() => setRevision((v) => v + 1)}
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
    </div>
  );
  const errors = {
    AI_MODEL_TOKEN_REENTRY_REQUIRED: label('reentry'),
    AI_MODEL_ENCRYPTION_UNAVAILABLE: label('encryption'),
    AI_MODEL_IN_USE: (response: unknown) => {
      const agents = (response as { error?: { agents?: Array<{ title: string }> } } | null)?.error
        ?.agents;
      return agents?.length
        ? label('inUseAgents').replace('{agents}', agents.map((agent) => agent.title).join(', '))
        : label('inUse');
    },
    AI_MODEL_CHANGED: label('changed'),
    AI_MODEL_TEST_REQUIRED: label('testRequired'),
    AI_MODEL_TEST_UNAVAILABLE: label('workerUnavailable'),
    AI_MODEL_TEST_EXPIRED: label('workerUnavailable'),
    'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
  };
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || disabled) return;
    commandGeneration.current = generation.current;
    commandBasis.current = null;
    setResult(null);
    setAction({
      title: label('save'),
      description: label('confirmSave'),
      path: `/api/admin/ai-models${draft.id ? `/${draft.id}` : ''}`,
      method: draft.id ? 'PUT' : 'POST',
      body: {
        title: draft.title.trim(),
        providerType: draft.providerType,
        baseUrl: draft.baseUrl.trim(),
        modelName: draft.modelName.trim(),
        config: { max_tokens: draft.maxTokens, temperature: draft.temperature },
        ...(draft.tokenChoice === 'clear'
          ? { apiToken: '' }
          : draft.tokenChoice === 'replace'
            ? { apiToken: draft.apiToken }
            : {}),
      },
      forbiddenMessage: label('forbidden'),
      errorMessages: errors,
    });
  }
  function perform(model: Model, kind: 'test' | 'delete' | 'enable' | 'disable') {
    if (disabled) return;
    commandGeneration.current = generation.current;
    commandBasis.current = { id: model.id, basis: modelBasis(model, 'command') };
    setResult(null);
    setAction({
      title: `${label(kind)}: ${model.title}`,
      description: label(
        kind === 'test' ? 'confirmTest' : kind === 'delete' ? 'confirmDelete' : 'confirmToggle'
      ),
      path: `/api/admin/ai-models/${model.id}${kind === 'test' ? '/test' : ''}`,
      method: kind === 'test' ? 'POST' : kind === 'delete' ? 'DELETE' : 'PUT',
      ...(['enable', 'disable'].includes(kind) ? { body: { isEnabled: kind === 'enable' } } : {}),
      forbiddenMessage: label('forbidden'),
      errorMessages: errors,
    });
  }
  function editBudget(model: Model) {
    if (disabled) return;
    generation.current++;
    setDraft(null);
    setBudgetDraft({
      modelId: model.id,
      modelTitle: model.title,
      monthlyTokenLimit: model.budget?.monthlyTokenLimit?.toString() ?? '',
      monthlyCostUsd:
        model.budget?.monthlyCostLimitMicros === null || model.budget === null
          ? ''
          : (model.budget.monthlyCostLimitMicros / 1_000_000).toString(),
      inputPriceUsd: ((model.budget?.inputPricePerMillionMicros ?? 0) / 1_000_000).toString(),
      outputPriceUsd: ((model.budget?.outputPricePerMillionMicros ?? 0) / 1_000_000).toString(),
    });
  }
  function submitBudget(event: FormEvent) {
    event.preventDefault();
    if (!budgetDraft || disabled) return;
    commandGeneration.current = generation.current;
    commandBasis.current = null;
    setResult(null);
    setAction({
      title: `${label('budgetSave')}: ${budgetDraft.modelTitle}`,
      description: label('budgetConfirm'),
      path: `/api/admin/ai-models/${budgetDraft.modelId}/budget`,
      method: 'PUT',
      body: {
        monthlyTokenLimit: budgetDraft.monthlyTokenLimit
          ? Number(budgetDraft.monthlyTokenLimit)
          : null,
        monthlyCostLimitMicros: budgetDraft.monthlyCostUsd
          ? Math.round(Number(budgetDraft.monthlyCostUsd) * 1_000_000)
          : null,
        inputPricePerMillionMicros: Math.round(Number(budgetDraft.inputPriceUsd) * 1_000_000),
        outputPricePerMillionMicros: Math.round(Number(budgetDraft.outputPriceUsd) * 1_000_000),
      },
      forbiddenMessage: label('forbidden'),
      errorMessages: errors,
    });
  }
  return (
    <section className="min-w-0 space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="text-muted-foreground">{label('description')}</p>
        </div>
      </header>
      <ListPage>
        <ListPage.Toolbar>
          <Button variant="outline" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
            {label('refresh')}
          </Button>
        </ListPage.Toolbar>
        {denied ? (
          <p role="alert">{label('forbidden')}</p>
        ) : (
          <>
            {result && (
              <div
                role={result.ok ? 'status' : 'alert'}
                className="rounded border bg-background p-4"
              >
                <p>{label(result.ok ? 'success' : 'testFailed')}</p>
                {result.text && (
                  <p className="mt-2 whitespace-pre-wrap break-words" dir="auto">
                    {result.text}
                  </p>
                )}
              </div>
            )}
            <Button
              disabled={disabled}
              onClick={() => {
                generation.current++;
                setDraft(blank());
                setBudgetDraft(null);
                setResult(null);
              }}
            >
              {label('add')}
            </Button>
            {draft && (
              <form
                onSubmit={submit}
                className="max-w-2xl space-y-4 rounded-lg border bg-background p-5"
                aria-label={label('form')}
              >
                <h2 className="text-lg font-semibold">{label(draft.id ? 'edit' : 'add')}</h2>
                {(['title', 'baseUrl', 'modelName'] as const).map((key) => (
                  <div className="space-y-2" key={key}>
                    <Label htmlFor={`ai-model-${key}`}>
                      {label(key === 'title' ? 'name' : key)}
                    </Label>
                    <Input
                      id={`ai-model-${key}`}
                      autoFocus={key === 'title'}
                      type={key === 'baseUrl' ? 'url' : 'text'}
                      required
                      maxLength={key === 'title' ? 120 : key === 'baseUrl' ? 500 : 200}
                      value={draft[key]}
                      dir={key === 'title' ? 'auto' : 'ltr'}
                      onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                    />
                  </div>
                ))}
                <div className="space-y-2">
                  <Label htmlFor="ai-model-provider">{label('provider')}</Label>
                  <select
                    id="ai-model-provider"
                    className="w-full rounded border bg-background p-2"
                    value={draft.providerType}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        providerType: event.target.value as Model['providerType'],
                      })
                    }
                  >
                    <option value="openai_compatible">{label('openai')}</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
                {draft.id && (
                  <div className="space-y-2">
                    <Label htmlFor="ai-model-token-choice">{label('tokenChoice')}</Label>
                    <p className="break-all text-sm" dir="ltr">
                      {draft.masked || label('noToken')}
                    </p>
                    <select
                      id="ai-model-token-choice"
                      className="w-full rounded border bg-background p-2"
                      value={draft.tokenChoice}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          tokenChoice: event.target.value as Draft['tokenChoice'],
                          apiToken: '',
                        })
                      }
                    >
                      <option value="keep">{label('keep')}</option>
                      <option value="replace">{label('replace')}</option>
                      <option value="clear">{label('clear')}</option>
                    </select>
                  </div>
                )}
                {draft.tokenChoice === 'replace' && (
                  <div className="space-y-2">
                    <Label htmlFor="ai-model-token">{label('token')}</Label>
                    <Input
                      id="ai-model-token"
                      type="password"
                      autoComplete="new-password"
                      maxLength={4000}
                      value={draft.apiToken}
                      onChange={(event) => setDraft({ ...draft, apiToken: event.target.value })}
                      dir="ltr"
                      aria-describedby="ai-model-token-help"
                    />
                  </div>
                )}
                <p id="ai-model-token-help" className="text-sm text-muted-foreground">
                  {label('tokenHelp')}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ai-model-max-tokens">{label('maxTokens')}</Label>
                    <Input
                      id="ai-model-max-tokens"
                      type="number"
                      min={1}
                      max={4096}
                      step={1}
                      required
                      value={draft.maxTokens}
                      onChange={(event) =>
                        setDraft({ ...draft, maxTokens: Number(event.target.value) })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-model-temperature">{label('temperature')}</Label>
                    <Input
                      id="ai-model-temperature"
                      type="number"
                      min={0}
                      max={2}
                      step="any"
                      required
                      value={draft.temperature}
                      onChange={(event) =>
                        setDraft({ ...draft, temperature: Number(event.target.value) })
                      }
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button type="submit" disabled={disabled}>
                    {label('save')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                    {label('cancel')}
                  </Button>
                </div>
              </form>
            )}
            {budgetDraft && (
              <form
                onSubmit={submitBudget}
                className="max-w-2xl space-y-4 rounded-lg border bg-background p-5"
                aria-label={label('budgetForm')}
              >
                <h2 className="text-lg font-semibold">
                  {label('budgetTitle')}: {budgetDraft.modelTitle}
                </h2>
                <p className="text-sm text-muted-foreground">{label('budgetHelp')}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ['monthlyTokenLimit', 'budgetTokens', '1', '1000000000', '1'],
                      ['monthlyCostUsd', 'budgetCost', '0.01', '1000000', '0.01'],
                      ['inputPriceUsd', 'budgetInputPrice', '0', '1000', '0.000001'],
                      ['outputPriceUsd', 'budgetOutputPrice', '0', '1000', '0.000001'],
                    ] as const
                  ).map(([key, labelKey, min, max, step]) => (
                    <div className="space-y-2" key={key}>
                      <Label htmlFor={`ai-model-${key}`}>{label(labelKey)}</Label>
                      <Input
                        id={`ai-model-${key}`}
                        type="number"
                        dir="ltr"
                        min={min}
                        max={max}
                        step={step}
                        required={key === 'inputPriceUsd' || key === 'outputPriceUsd'}
                        value={budgetDraft[key]}
                        onChange={(event) =>
                          setBudgetDraft({ ...budgetDraft, [key]: event.target.value })
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <Button type="submit" disabled={disabled}>
                    {label('budgetSave')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setBudgetDraft(null)}>
                    {label('cancel')}
                  </Button>
                </div>
              </form>
            )}
            <ListPage.Content
              loading={loading}
              error={error}
              empty={models.length === 0}
              retainContent={models.length > 0}
              loadingView={<p role="status">{label('loading')}</p>}
              errorView={
                <div role="alert">
                  <p>{label('error')}</p>
                  <Button onClick={() => setRevision((v) => v + 1)}>{label('retry')}</Button>
                </div>
              }
              emptyView={<p>{label('empty')}</p>}
            >
              <ScrollArea
                scrollbarOrientation="horizontal"
                className="max-w-full min-w-0 rounded-lg border bg-background"
                role="region"
                aria-label={label('title')}
              >
                <table className="w-full min-w-[760px] table-fixed text-start text-sm">
                  <thead className="border-b bg-muted">
                    <tr>
                      {['name', 'provider', 'modelName', 'status', 'actions'].map((key) => (
                        <th key={key} scope="col" className="p-4 text-start font-semibold">
                          {label(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model) => (
                      <tr
                        key={model.id}
                        aria-label={model.title}
                        className="border-b align-top last:border-0"
                      >
                        <th scope="row" className="space-y-2 p-4 text-start font-normal">
                          <p className="font-semibold break-words" dir="auto">
                            {model.title}
                          </p>
                          <p className="break-all" dir="ltr">
                            {model.baseUrl}
                          </p>
                        </th>
                        <td className="space-y-2 p-4">
                          <p>
                            {model.providerType === 'anthropic' ? 'Anthropic' : label('openai')}
                          </p>
                          <p>
                            {label('token')}:{' '}
                            <span dir="ltr">{model.apiTokenMasked || label('noToken')}</span>
                          </p>
                        </td>
                        <td className="break-all p-4" dir="ltr">
                          {model.modelName}
                        </td>
                        <td className="space-y-2 p-4">
                          <p className="font-medium">
                            {label(model.isEnabled ? 'enabled' : 'disabled')}
                          </p>
                          <p>{label(model.status)}</p>
                          {model.circuitOpen && (
                            <p className="font-medium text-destructive" role="status">
                              {label('circuitOpen')}
                              {model.circuitCooldownUntil && (
                                <span className="block font-normal">
                                  {label('circuitRetry')}: {time.format(model.circuitCooldownUntil)}
                                </span>
                              )}
                            </p>
                          )}
                          {model.lastTestedAt && (
                            <p>
                              {label('lastTest')}: {time.format(model.lastTestedAt)}
                            </p>
                          )}
                          {model.lastTestLatencyMs !== null && (
                            <p>
                              {label('latency')}: {numbers.number(model.lastTestLatencyMs)} ms
                            </p>
                          )}
                          {model.lastTestError && (
                            <p className="break-words text-destructive" dir="auto">
                              {model.lastTestError}
                            </p>
                          )}
                          <div className="border-t pt-2 text-xs text-muted-foreground">
                            <p className="font-medium text-foreground">{label('budgetTitle')}</p>
                            {model.budget ? (
                              <>
                                {model.budget.monthlyTokenLimit !== null && (
                                  <p>
                                    {label('budgetTokens')}:{' '}
                                    {numbers.number(
                                      model.budget.usedInputTokens + model.budget.usedOutputTokens
                                    )}{' '}
                                    / {numbers.number(model.budget.monthlyTokenLimit)}
                                  </p>
                                )}
                                {model.budget.monthlyCostLimitMicros !== null && (
                                  <p>
                                    {label('budgetCost')}:{' '}
                                    {new Intl.NumberFormat(locale, {
                                      style: 'currency',
                                      currency: 'USD',
                                    }).format(model.budget.usedCostMicros / 1_000_000)}{' '}
                                    /{' '}
                                    {new Intl.NumberFormat(locale, {
                                      style: 'currency',
                                      currency: 'USD',
                                    }).format(model.budget.monthlyCostLimitMicros / 1_000_000)}
                                  </p>
                                )}
                              </>
                            ) : (
                              <p>{label('budgetNone')}</p>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          {' '}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              disabled={disabled}
                              onClick={() => {
                                generation.current++;
                                setBudgetDraft(null);
                                setDraft({
                                  id: model.id,
                                  title: model.title,
                                  providerType: model.providerType,
                                  baseUrl: model.baseUrl,
                                  modelName: model.modelName,
                                  maxTokens: model.config.max_tokens,
                                  temperature: model.config.temperature,
                                  apiToken: '',
                                  tokenChoice: 'keep',
                                  masked: model.apiTokenMasked,
                                });
                                setResult(null);
                              }}
                            >
                              {label('edit')}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={disabled}
                              onClick={() => perform(model, 'test')}
                            >
                              {label('test')}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={disabled}
                              onClick={() => editBudget(model)}
                            >
                              {label('budgetEdit')}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={
                                disabled || (!model.isEnabled && model.status !== 'reachable')
                              }
                              title={
                                !model.isEnabled && model.status !== 'reachable'
                                  ? label('testRequired')
                                  : undefined
                              }
                              onClick={() => perform(model, model.isEnabled ? 'disable' : 'enable')}
                            >
                              {label(model.isEnabled ? 'disable' : 'enable')}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={disabled}
                              onClick={() => perform(model, 'delete')}
                            >
                              {label('delete')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </ListPage.Content>
          </>
        )}
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={disabled}
          summary={recovery}
          onClose={() => {
            generation.current++;
            setAction(null);
            commandBasis.current = null;
          }}
          onSuccess={((command, commandVersion) => async (value: unknown) => {
            if (commandVersion !== generation.current) return;
            const data = value as {
              test?: { ok: boolean; responsePreview?: string; error?: string };
            } | null;
            setResult(
              data?.test
                ? { ok: data.test.ok, text: data.test.responsePreview ?? data.test.error ?? '' }
                : { ok: true, text: '' }
            );
            if (command.body && typeof command.body === 'object' && 'config' in command.body)
              setDraft(null);
            if (command.path.endsWith('/budget')) setBudgetDraft(null);
            commandBasis.current = null;
            setRevision((v) => v + 1);
          })(action, commandGeneration.current)}
        />
      )}
    </section>
  );
}

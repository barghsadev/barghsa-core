import { AiModelRecordTable } from '../components/AiModelRecordTable.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useEffect, useState, useRef, useCallback, lazy, Suspense, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label, ListPage } from '@barghsa/ui';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { aiModelFormText } from '@barghsa/i18n/ai-model-forms';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { Alert } from '@barghsa/ui';
const TeamActionDialog = lazy(() =>
  import('../components/TeamActionDialog.js').then((module) => ({
    default: module.TeamActionDialog,
  }))
);
import { useLocale } from '../hooks/useLocale.js';
import {
  type Model,
  type Draft,
  type BudgetDraft,
  blank,
  validModels,
  modelBasis,
  modelDraftFor,
  budgetDraftFor,
  invalidModelFields,
  invalidBudgetFields,
  budgetBody,
  modelBody,
  matchesModelReceipt,
  matchesBudgetReceipt,
} from '../lib/ai-model-form.js';
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
  const previousModels = useRef<Model[]>([]);
  const copy = (key: Parameters<typeof aiModelFormText>[0]) => aiModelFormText(key, locale);
  const modelMessages = {
    title: copy('title'),
    providerType: copy('providerType'),
    baseUrl: copy('baseUrl'),
    modelName: copy('modelName'),
    maxTokens: copy('maxTokens'),
    temperature: copy('temperature'),
    apiToken: copy('apiTokenMessage'),
    tokenChoice: copy('tokenChoice'),
  };
  const budgetMessages = {
    monthlyTokenLimit: copy('monthlyTokenLimit'),
    monthlyCostUsd: copy('monthlyCostUsd'),
    inputPriceUsd: copy('inputPriceUsd'),
    outputPriceUsd: copy('outputPriceUsd'),
  };
  const modelForm = useWizardForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema(
        { ...modelMessages, id: copy('invalid'), masked: copy('invalid') },
        (value: Draft) =>
          invalidModelFields(
            value,
            previousModels.current.find((model) => model.id === value.id)
          )
      );
    },
    blank,
    copy('unavailable')
  );
  const budgetForm = useWizardForm<BudgetDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema(
        { ...budgetMessages, modelId: copy('invalid'), modelTitle: copy('invalid') },
        invalidBudgetFields
      );
    },
    () => ({
      modelId: '',
      modelTitle: '',
      monthlyTokenLimit: '',
      monthlyCostUsd: '',
      inputPriceUsd: '0',
      outputPriceUsd: '0',
    }),
    copy('unavailable')
  );
  const modelFields = useActionFieldErrors(modelForm.form, modelMessages, copy('invalid'));
  const budgetFields = useActionFieldErrors(budgetForm.form, budgetMessages, copy('invalid'));
  const [draftOpen, setDraftOpen] = useState(false),
    [budgetOpen, setBudgetOpen] = useState(false);
  const draft = draftOpen ? modelForm.values : null,
    budgetDraft = budgetOpen ? budgetForm.values : null;
  function setDraft(value: Draft | null) {
    modelForm.form.reset(value ?? blank());
    setDraftOpen(!!value);
  }
  function setBudgetDraft(value: BudgetDraft | null) {
    budgetForm.form.reset(
      value ?? {
        modelId: '',
        modelTitle: '',
        monthlyTokenLimit: '',
        monthlyCostUsd: '',
        inputPriceUsd: '0',
        outputPriceUsd: '0',
      }
    );
    setBudgetOpen(!!value);
  }
  const [action, setAction] = useState<TeamAction | null>(null),
    [result, setResult] = useState<{ ok: boolean; text: string } | null>(null),
    [changed, setChanged] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [recovered, setRecovered] = useState(false),
    [pending, setPending] = useState(false);
  const uncertainRef = useRef(false),
    recoveryRevision = useRef(0),
    validating = useRef(false),
    networkPending = useRef(false),
    actionRef = useRef<TeamAction | null>(null),
    capture = useRef<
      { kind: 'model'; value: Draft } | { kind: 'budget'; value: BudgetDraft } | null
    >(null);
  const onPendingChange = useCallback((value: boolean) => {
    networkPending.current = value;
    setPending(value);
  }, []);
  const currentWork = useRef({ draft, budgetDraft });
  currentWork.current = { draft, budgetDraft };
  const generation = useRef(0);
  const commandGeneration = useRef(0);
  const commandBasis = useRef<{ id: string; basis: string } | null>(null);
  function withdraw() {
    generation.current++;
    validating.current = false;
    modelForm.setValidationPending(false);
    budgetForm.setValidationPending(false);
    setAction(null);
    actionRef.current = null;
    capture.current = null;
    commandBasis.current = null;
    onPendingChange(false);
  }
  function clearWork() {
    withdraw();
    setChanged(false);
    setUncertain(false);
    uncertainRef.current = false;
    setRecovered(false);
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
          (budget && changed(budget.modelId, 'budget'))
        ) {
          withdraw();
          setChanged(true);
        } else if (
          command &&
          !rows.some((m) => m.id === command.id && modelBasis(m, 'command') === command.basis)
        )
          withdraw();
        if (uncertainRef.current && revision >= recoveryRevision.current) setRecovered(true);
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
  const unavailable = loading || error || denied;
  const disabled = unavailable || changed || uncertain;
  const busy = modelForm.pending || budgetForm.pending || !!action;
  function refresh() {
    if (networkPending.current) return;
    if (validating.current) withdraw();
    setRevision((v) => v + 1);
  }
  function unconfirmed() {
    recoveryRevision.current = revision + 1;
    uncertainRef.current = true;
    setUncertain(true);
    setRecovered(false);
    withdraw();
    setRevision((v) => v + 1);
  }
  function resetDraft() {
    if (unavailable || busy || (uncertain && !recovered)) return;
    withdraw();
    if (draft) {
      const fresh = models.find((m) => m.id === draft.id);
      setDraft(draft.id ? (fresh ? modelDraftFor(fresh) : null) : blank());
    }
    if (budgetDraft) {
      const fresh = models.find((m) => m.id === budgetDraft.modelId);
      setBudgetDraft(fresh ? budgetDraftFor(fresh) : null);
    }
    setChanged(false);
    setUncertain(false);
    uncertainRef.current = false;
    setRecovered(false);
    setResult(null);
  }
  const recovery = (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={loading || pending} onClick={refresh}>
        {label('refresh')}
      </Button>
      {loading && <p role="status">{label('loading')}</p>}
      {error && (
        <div role="alert">
          <p>{label('error')}</p>
          <Button type="button" onClick={refresh}>
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || disabled || validating.current || actionRef.current) return;
    const epoch = generation.current;
    validating.current = true;
    modelForm.setValidationPending(true);
    setResult(null);
    try {
      await modelForm.form.handleSubmit((value) => {
        if (epoch !== generation.current) return;
        commandGeneration.current = epoch;
        commandBasis.current = null;
        capture.current = { kind: 'model', value: { ...value } };
        const next: TeamAction = {
          title: label('save'),
          description: label('confirmSave'),
          path: `/api/admin/ai-models${value.id ? `/${value.id}` : ''}`,
          method: value.id ? 'PUT' : 'POST',
          body: modelBody(value),
          successStatus: value.id ? 200 : 201,
          forbiddenMessage: label('forbidden'),
          errorMessages: errors,
        };
        actionRef.current = next;
        setAction(next);
      })();
    } finally {
      if (epoch === generation.current) {
        validating.current = false;
        modelForm.setValidationPending(false);
      }
    }
  }
  function perform(model: Model, kind: 'test' | 'delete' | 'enable' | 'disable') {
    if (disabled || busy || actionRef.current) return;
    commandGeneration.current = generation.current;
    commandBasis.current = { id: model.id, basis: modelBasis(model, 'command') };
    setResult(null);
    const next: TeamAction = {
      title: `${label(kind)}: ${model.title}`,
      description: label(
        kind === 'test' ? 'confirmTest' : kind === 'delete' ? 'confirmDelete' : 'confirmToggle'
      ),
      path: `/api/admin/ai-models/${model.id}${kind === 'test' ? '/test' : ''}`,
      method: kind === 'test' ? 'POST' : kind === 'delete' ? 'DELETE' : 'PUT',
      ...(['enable', 'disable'].includes(kind) ? { body: { isEnabled: kind === 'enable' } } : {}),
      forbiddenMessage: label('forbidden'),
      errorMessages: errors,
    };
    capture.current = null;
    actionRef.current = next;
    setAction(next);
  }
  function editBudget(model: Model) {
    if (disabled || busy) return;
    generation.current++;
    setDraft(null);
    setBudgetDraft(budgetDraftFor(model));
    setChanged(false);
    setResult(null);
  }
  async function submitBudget(event: FormEvent) {
    event.preventDefault();
    if (!budgetDraft || disabled || validating.current || actionRef.current) return;
    const epoch = generation.current;
    validating.current = true;
    budgetForm.setValidationPending(true);
    setResult(null);
    try {
      await budgetForm.form.handleSubmit((value) => {
        if (epoch !== generation.current) return;
        commandGeneration.current = epoch;
        commandBasis.current = null;
        capture.current = { kind: 'budget', value: { ...value } };
        const next: TeamAction = {
          title: `${label('budgetSave')}: ${value.modelTitle}`,
          description: label('budgetConfirm'),
          path: `/api/admin/ai-models/${value.modelId}/budget`,
          method: 'PUT',
          body: budgetBody(value),
          successStatus: 200,
          forbiddenMessage: label('forbidden'),
          errorMessages: errors,
        };
        actionRef.current = next;
        setAction(next);
      })();
    } finally {
      if (epoch === generation.current) {
        validating.current = false;
        budgetForm.setValidationPending(false);
      }
    }
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
      {(changed || uncertain) && (
        <Alert variant="destructive">{copy(uncertain ? 'uncertain' : 'changed')}</Alert>
      )}
      {(changed || uncertain) && (
        <Button
          type="button"
          variant="outline"
          disabled={unavailable || busy || (uncertain && !recovered)}
          onClick={resetDraft}
        >
          {copy('reset')}
        </Button>
      )}
      <ListPage>
        <ListPage.Toolbar>
          <Button variant="outline" disabled={loading || pending} onClick={refresh}>
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
              disabled={disabled || busy}
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
                noValidate
                aria-busy={modelForm.pending || undefined}
                onSubmit={(event) => void submit(event)}
                className="max-w-2xl space-y-4 rounded-lg border bg-background p-5"
                aria-label={label('form')}
              >
                {catalogueRootMessage(modelForm.errors) && (
                  <Alert variant="destructive">{catalogueRootMessage(modelForm.errors)}</Alert>
                )}
                <fieldset disabled={busy} className="min-w-0 space-y-4">
                  <legend className="sr-only">{label('form')}</legend>
                  <h2 className="text-lg font-semibold">{label(draft.id ? 'edit' : 'add')}</h2>
                  {(['title', 'baseUrl', 'modelName'] as const).map((key) => (
                    <div className="space-y-2" key={key}>
                      <Label htmlFor={`ai-model-${key}`}>
                        {label(key === 'title' ? 'name' : key)}
                      </Label>
                      <Input
                        {...modelForm.bind(key)}
                        id={`ai-model-${key}`}
                        autoFocus={key === 'title'}
                        type={key === 'baseUrl' ? 'url' : 'text'}
                        required
                        maxLength={key === 'title' ? 120 : key === 'baseUrl' ? 500 : 200}
                        value={draft[key]}
                        dir={key === 'title' ? 'auto' : 'ltr'}
                        onChange={(event) => modelForm.field(key)[1](event.target.value)}
                      />
                      <CatalogueFieldFeedback
                        id={modelForm.errorId(key)}
                        error={modelForm.errors[key]}
                        message={modelMessages[key]!}
                      />
                    </div>
                  ))}
                  <div className="space-y-2">
                    <Label htmlFor="ai-model-provider">{label('provider')}</Label>
                    <select
                      {...modelForm.bind('providerType')}
                      id="ai-model-provider"
                      className="w-full rounded border bg-background p-2"
                      value={draft.providerType}
                      onChange={(event) =>
                        modelForm.field('providerType')[1](
                          event.target.value as Model['providerType']
                        )
                      }
                    >
                      <option value="openai_compatible">{label('openai')}</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                    <CatalogueFieldFeedback
                      id={modelForm.errorId('providerType')}
                      error={modelForm.errors.providerType}
                      message={modelMessages.providerType!}
                    />
                  </div>
                  {draft.id && (
                    <div className="space-y-2">
                      <Label htmlFor="ai-model-token-choice">{label('tokenChoice')}</Label>
                      <p className="break-all text-sm" dir="ltr">
                        {draft.masked || label('noToken')}
                      </p>
                      <select
                        {...modelForm.bind('tokenChoice')}
                        id="ai-model-token-choice"
                        className="w-full rounded border bg-background p-2"
                        value={draft.tokenChoice}
                        onChange={(event) => {
                          modelForm.field('tokenChoice')[1](
                            event.target.value as Draft['tokenChoice']
                          );
                          modelForm.field('apiToken')[1]('');
                        }}
                      >
                        <option value="keep">{label('keep')}</option>
                        <option value="replace">{label('replace')}</option>
                        <option value="clear">{label('clear')}</option>
                      </select>
                      <CatalogueFieldFeedback
                        id={modelForm.errorId('tokenChoice')}
                        error={modelForm.errors.tokenChoice}
                        message={modelMessages.tokenChoice!}
                      />
                    </div>
                  )}
                  {draft.tokenChoice === 'replace' && (
                    <div className="space-y-2">
                      <Label htmlFor="ai-model-token">{label('token')}</Label>
                      <Input
                        {...modelForm.bind('apiToken')}
                        id="ai-model-token"
                        type="password"
                        autoComplete="new-password"
                        maxLength={4000}
                        value={draft.apiToken}
                        onChange={(event) => modelForm.field('apiToken')[1](event.target.value)}
                        dir="ltr"
                        aria-describedby={[
                          modelForm.bind('apiToken')['aria-describedby'],
                          'ai-model-token-help',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                      <CatalogueFieldFeedback
                        id={modelForm.errorId('apiToken')}
                        error={modelForm.errors.apiToken}
                        message={modelMessages.apiToken!}
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
                        {...modelForm.bind('maxTokens')}
                        id="ai-model-max-tokens"
                        type="number"
                        min={1}
                        max={4096}
                        step={1}
                        required
                        value={draft.maxTokens}
                        onChange={(event) => modelForm.field('maxTokens')[1](event.target.value)}
                      />
                      <CatalogueFieldFeedback
                        id={modelForm.errorId('maxTokens')}
                        error={modelForm.errors.maxTokens}
                        message={modelMessages.maxTokens!}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ai-model-temperature">{label('temperature')}</Label>
                      <Input
                        {...modelForm.bind('temperature')}
                        id="ai-model-temperature"
                        type="number"
                        min={0}
                        max={2}
                        step="any"
                        required
                        value={draft.temperature}
                        onChange={(event) => modelForm.field('temperature')[1](event.target.value)}
                      />
                      <CatalogueFieldFeedback
                        id={modelForm.errorId('temperature')}
                        error={modelForm.errors.temperature}
                        message={modelMessages.temperature!}
                      />
                    </div>
                  </div>
                </fieldset>
                <div className="flex gap-3">
                  <CatalogueSaveButton
                    label={label('save')}
                    pending={modelForm.pending}
                    disabled={disabled || busy}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      withdraw();
                      setDraft(null);
                    }}
                  >
                    {label('cancel')}
                  </Button>
                </div>
              </form>
            )}
            {budgetDraft && (
              <form
                noValidate
                aria-busy={budgetForm.pending || undefined}
                onSubmit={(event) => void submitBudget(event)}
                className="max-w-2xl space-y-4 rounded-lg border bg-background p-5"
                aria-label={label('budgetForm')}
              >
                {catalogueRootMessage(budgetForm.errors) && (
                  <Alert variant="destructive">{catalogueRootMessage(budgetForm.errors)}</Alert>
                )}
                <fieldset disabled={busy} className="min-w-0 space-y-4">
                  <legend className="sr-only">{label('budgetForm')}</legend>
                  <h2 className="text-lg font-semibold">
                    {label('budgetTitle')}: {budgetDraft.modelTitle}
                  </h2>
                  <p className="text-sm text-muted-foreground">{label('budgetHelp')}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(
                      [
                        ['monthlyTokenLimit', 'budgetTokens', '1', '1000000000', '1'],
                        ['monthlyCostUsd', 'budgetCost', '0.000001', '1000000', '0.000001'],
                        ['inputPriceUsd', 'budgetInputPrice', '0', '1000', '0.000001'],
                        ['outputPriceUsd', 'budgetOutputPrice', '0', '1000', '0.000001'],
                      ] as const
                    ).map(([key, labelKey, min, max, step]) => (
                      <div className="space-y-2" key={key}>
                        <Label htmlFor={`ai-model-${key}`}>{label(labelKey)}</Label>
                        <Input
                          {...budgetForm.bind(key)}
                          id={`ai-model-${key}`}
                          type="number"
                          dir="ltr"
                          min={min}
                          max={max}
                          step={step}
                          required={key === 'inputPriceUsd' || key === 'outputPriceUsd'}
                          value={budgetDraft[key]}
                          onChange={(event) => budgetForm.field(key)[1](event.target.value)}
                        />
                        <CatalogueFieldFeedback
                          id={budgetForm.errorId(key)}
                          error={budgetForm.errors[key]}
                          message={budgetMessages[key]!}
                        />
                      </div>
                    ))}
                  </div>
                </fieldset>
                <div className="flex gap-3">
                  <CatalogueSaveButton
                    label={label('budgetSave')}
                    pending={budgetForm.pending}
                    disabled={disabled || busy}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      withdraw();
                      setBudgetDraft(null);
                    }}
                  >
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
                  <Button onClick={refresh}>{label('retry')}</Button>
                </div>
              }
              emptyView={<p>{label('empty')}</p>}
            >
              <AiModelRecordTable
                models={models}
                locale={locale}
                caption={copy('list')}
                label={label}
                numerals={
                  numbers.numberStyle === 'western'
                    ? 'latn'
                    : numbers.numberStyle === 'persian'
                      ? 'arabext'
                      : locale === 'fa'
                        ? 'arabext'
                        : 'latn'
                }
                formatNumber={numbers.number}
                formatTime={time.format}
                renderActions={(model) => (
                  <>
                    <Button
                      variant="outline"
                      disabled={disabled || busy}
                      onClick={() => {
                        generation.current++;
                        setBudgetDraft(null);
                        setDraft(modelDraftFor(model));
                        setChanged(false);
                        setResult(null);
                      }}
                    >
                      {label('edit')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={disabled || busy}
                      onClick={() => perform(model, 'test')}
                    >
                      {label('test')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={disabled || busy}
                      onClick={() => editBudget(model)}
                    >
                      {label('budgetEdit')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        disabled || busy || (!model.isEnabled && model.status !== 'reachable')
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
                      disabled={disabled || busy}
                      onClick={() => perform(model, 'delete')}
                    >
                      {label('delete')}
                    </Button>
                  </>
                )}
              />
            </ListPage.Content>
          </>
        )}
      </ListPage>
      {action && (
        <Suspense fallback={<p role="status">{label('loading')}</p>}>
          <TeamActionDialog
            action={action}
            confirmationDisabled={disabled}
            onPendingChange={onPendingChange}
            onUnconfirmed={unconfirmed}
            onValidationError={(fields) =>
              capture.current?.kind === 'model'
                ? modelFields(fields)
                : capture.current?.kind === 'budget'
                  ? budgetFields(fields)
                  : false
            }
            onDenied={() => {
              clearWork();
              previousModels.current = [];
              setModels([]);
              setDenied(true);
            }}
            summary={recovery}
            onClose={withdraw}
            onSuccess={((command, commandVersion) => async (value: unknown) => {
              if (commandVersion !== generation.current || actionRef.current !== command) return;
              const captured = capture.current;
              if (captured) {
                const matches =
                  captured.kind === 'model'
                    ? matchesModelReceipt(value, captured.value)
                    : matchesBudgetReceipt(value, captured.value);
                if (!matches) throw new Error('Unconfirmed model settings');
                const model = value as Model;
                previousModels.current = [
                  ...previousModels.current.filter((row) => row.id !== model.id),
                  model,
                ];
                setModels(previousModels.current);
              }
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
        </Suspense>
      )}
    </section>
  );
}

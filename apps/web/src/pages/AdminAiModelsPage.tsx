import {
  Ban as TableBanIcon,
  CheckCircle as TableCheckCircleIcon,
  FlaskConical as TableFlaskConicalIcon,
  Pencil as TablePencilIcon,
  Trash2 as TableTrash2Icon,
  Wallet as TableWalletIcon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { Link } from '@tanstack/react-router';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { AiModelRecordTable } from '../components/AiModelRecordTable.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  useEffect,
  useState,
  useRef,
  useId,
  useCallback,
  lazy,
  Suspense,
  type FormEvent,
} from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import {
  Badge,
  LoadingStatus,
  Button,
  Input,
  Label,
  ListPage,
  ListRefreshButton,
  NativeSelect,
  buttonVariants,
} from '@barghsa/ui';
import { toast } from '../lib/toast-api.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { aiModelFormText } from '@barghsa/i18n/ai-model-forms';
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
  readModelTestReceipt,
} from '../lib/ai-model-form.js';
type RecordActions = {
  showRecord: (id: string, replace?: boolean) => void;
  showList: () => void;
};
type ModelWorkspace =
  | { view: 'list'; modelId?: never }
  | ({ view: 'create'; modelId?: never } & RecordActions)
  | ({ view: 'detail' | 'edit' | 'budget'; modelId: string } & RecordActions);
const modelRoute = (modelId: string, action?: 'edit' | 'budget') => ({
  to: '/admin/ai-models/$modelId/{-$action}' as const,
  params: { modelId, action },
});

export default function AdminAiModelsPage({ workspace }: { workspace?: ModelWorkspace } = {}) {
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  return (
    <OwnedAiModelsPage
      key={JSON.stringify([actor, contextRevision])}
      actor={actor}
      contextRevision={contextRevision}
      {...(workspace ? { workspace } : {})}
    />
  );
}

function OwnedAiModelsPage({
  actor,
  contextRevision,
  workspace,
}: {
  actor: string | null;
  contextRevision: number;
  workspace?: ModelWorkspace;
}) {
  const client = useQueryClient();
  const reader = useId();
  const time = useAccountTime();
  const locale = useLocale(),
    label = (key: string) => t(`admin.aiModels.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const modelId = workspace?.modelId;
  const initialized = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [models, setModels] = useState<Model[]>([]),
    [loading, setLoading] = useState(true),
    [denied, setDenied] = useState(false),
    [missing, setMissing] = useState(false),
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
    initialized.current = false;
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
    const key = queryKeys.catalogue.detail(
      {
        context: 'staff',
        ownerId: actor ?? 'current-account',
        accountId: actor,
        revision: contextRevision,
      },
      JSON.stringify([reader, 'ai-models', modelId, revision])
    );
    const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    setLoading(true);
    setError(false);
    setMissing(false);
    void (async () => {
      try {
        const response = await client.fetchQuery({
          queryKey: key,
          staleTime: 0,
          gcTime: 0,
          retry: false,
          queryFn: ({ signal }) =>
            readWithDeadline(signal, async (transport) => {
              const response = await fetch(
                modelId
                  ? `/api/admin/ai-models/${encodeURIComponent(modelId)}`
                  : '/api/admin/ai-models',
                { signal: transport }
              );
              return {
                status: response.status,
                ok: response.ok,
                value: response.ok ? await response.json() : null,
              };
            }),
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          clearWork();
          previousModels.current = [];
          setModels([]);
          setDenied(true);
          return;
        }
        if (modelId && response.status === 404) {
          clearWork();
          previousModels.current = [];
          setModels([]);
          setDenied(false);
          setMissing(true);
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const rows: unknown = modelId ? [response.value] : response.value;
        if (controller.signal.aborted) return;
        if (!validModels(rows) || (modelId && rows[0]?.id !== modelId))
          throw new Error('Invalid models');
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
    return () => {
      controller.abort();
      controller.signal.removeEventListener('abort', cancel);
    };
  }, [revision, actor, contextRevision, client, reader, modelId]);
  const unavailable = loading || error || denied || missing;
  const disabled = unavailable || changed || uncertain;
  const busy = modelForm.pending || budgetForm.pending || !!action;
  const currentModel = modelId ? models[0] : undefined;
  useEffect(() => {
    if (workspace && workspace.view !== 'list') heading.current?.focus({ preventScroll: true });
  }, [workspace?.view, modelId]);
  useEffect(() => {
    if (unavailable || initialized.current) return;
    if (workspace?.view === 'create') setDraft(blank());
    else if (workspace?.view === 'edit' && currentModel) editModel(currentModel);
    else if (workspace?.view === 'budget' && currentModel) editBudget(currentModel);
    else return;
    initialized.current = true;
  }, [unavailable, currentModel, workspace?.view]);
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
      {loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
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
          responseDeadline: true,
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
      ...(kind === 'delete' || kind === 'disable' ? { risk: 'destructive' as const } : {}),
      title: `${label(kind)}: ${model.title}`,
      description: label(
        kind === 'test' ? 'confirmTest' : kind === 'delete' ? 'confirmDelete' : 'confirmToggle'
      ),
      path: `/api/admin/ai-models/${model.id}${kind === 'test' ? '/test' : ''}`,
      method: kind === 'test' ? 'POST' : kind === 'delete' ? 'DELETE' : 'PUT',
      // The model worker can wait up to 90 seconds before returning an outcome.
      responseDeadline: kind === 'test' ? 100_000 : true,
      successStatus: kind === 'delete' ? 204 : 200,
      ...(['enable', 'disable'].includes(kind) ? { body: { isEnabled: kind === 'enable' } } : {}),
      forbiddenMessage: label('forbidden'),
      errorMessages: errors,
    };
    capture.current = null;
    actionRef.current = next;
    setAction(next);
  }
  function editModel(model: Model) {
    generation.current++;
    setBudgetDraft(null);
    setDraft(modelDraftFor(model));
    setChanged(false);
    setResult(null);
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
          responseDeadline: true,
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
  const isList = !workspace || workspace.view === 'list';
  const actionClass = buttonVariants({ variant: 'outline', className: 'min-h-11' });
  const numeralSystem =
    numbers.numberStyle === 'western'
      ? 'latn'
      : numbers.numberStyle === 'persian' || locale === 'fa'
        ? 'arabext'
        : 'latn';
  const dollar = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    numberingSystem: numeralSystem,
    maximumFractionDigits: 6,
  });
  const modelActions = (model: Model) => (
    <>
      {workspace && !disabled && !busy ? (
        <Link
          {...modelRoute(model.id, 'edit')}
          className={actionClass}
          data-table-action-tooltip={label('edit')}
        >
          <TableActionIcon icon={TablePencilIcon}>{label('edit')}</TableActionIcon>
        </Link>
      ) : (
        <Button
          variant="outline"
          disabled={disabled || busy}
          onClick={() => editModel(model)}
          data-table-action-tooltip={label('edit')}
        >
          <TableActionIcon icon={TablePencilIcon}>{label('edit')}</TableActionIcon>
        </Button>
      )}
      <Button
        variant="outline"
        disabled={disabled || busy}
        onClick={() => perform(model, 'test')}
        data-table-action-tooltip={label('test')}
      >
        <TableActionIcon icon={TableFlaskConicalIcon}>{label('test')}</TableActionIcon>
      </Button>
      {workspace && !disabled && !busy ? (
        <Link
          {...modelRoute(model.id, 'budget')}
          className={actionClass}
          data-table-action-tooltip={label('budgetEdit')}
        >
          <TableActionIcon icon={TableWalletIcon}>{label('budgetEdit')}</TableActionIcon>
        </Link>
      ) : (
        <Button
          variant="outline"
          disabled={disabled || busy}
          onClick={() => editBudget(model)}
          data-table-action-tooltip={label('budgetEdit')}
        >
          <TableActionIcon icon={TableWalletIcon}>{label('budgetEdit')}</TableActionIcon>
        </Button>
      )}
      <Button
        variant="outline"
        disabled={disabled || busy || (!model.isEnabled && model.status !== 'reachable')}
        data-table-action-tooltip={
          !model.isEnabled && model.status !== 'reachable' ? label('testRequired') : undefined
        }
        onClick={() => perform(model, model.isEnabled ? 'disable' : 'enable')}
      >
        <TableActionIcon icon={model.isEnabled ? TableBanIcon : TableCheckCircleIcon}>
          {label(model.isEnabled ? 'disable' : 'enable')}
        </TableActionIcon>
      </Button>
      <Button
        variant="outline"
        disabled={disabled || busy}
        onClick={() => perform(model, 'delete')}
        data-table-action-tooltip={label('delete')}
      >
        <TableActionIcon icon={TableTrash2Icon}>{label('delete')}</TableActionIcon>
      </Button>
    </>
  );
  function closeEditor() {
    withdraw();
    if (workspace && workspace.view !== 'list') {
      if (modelId) workspace.showRecord(modelId);
      else workspace.showList();
    } else {
      setDraft(null);
      setBudgetDraft(null);
    }
  }
  const isEditor =
    workspace?.view === 'create' || workspace?.view === 'edit' || workspace?.view === 'budget';
  const refreshButton = (
    <ListRefreshButton label={label('refresh')} disabled={loading || pending} onClick={refresh} />
  );
  return (
    <section
      className={isEditor ? 'mx-auto w-full min-w-0 max-w-3xl space-y-4' : 'min-w-0 space-y-5'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <header className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {!isList && (
            <Link
              to="/admin/ai-models"
              className="inline-flex text-sm text-primary hover:underline"
            >
              {label('title')}
            </Link>
          )}
          <h1
            ref={heading}
            data-slot="editor-heading"
            tabIndex={isList ? undefined : -1}
            className="break-words text-2xl font-semibold outline-none!"
          >
            {workspace?.view === 'edit' ? (
              copy('editModel')
            ) : workspace?.view === 'budget' ? (
              label('budgetTitle')
            ) : workspace?.view === 'create' ? (
              label('add')
            ) : currentModel ? (
              <bdi>{currentModel.title}</bdi>
            ) : (
              label(isList ? 'title' : 'form')
            )}
          </h1>
          {isEditor && currentModel && (
            <p className="text-sm text-muted-foreground">
              <bdi>{currentModel.title}</bdi>
            </p>
          )}
          {isList && <p className="text-muted-foreground">{label('description')}</p>}
        </div>
        {isEditor && refreshButton}
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
        {!isEditor && <ListPage.Toolbar>{refreshButton}</ListPage.Toolbar>}
        {denied ? (
          <p role="alert">{label('forbidden')}</p>
        ) : (
          <>
            {!isList && loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
            {!isList && error && (
              <Alert variant="destructive">
                <p>{label('error')}</p>
                <Button type="button" variant="outline" onClick={refresh}>
                  {label('retry')}
                </Button>
              </Alert>
            )}
            {missing && <Alert variant="destructive">{label('missing')}</Alert>}
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
            {workspace?.view === 'list' && !disabled && !busy && (
              <Link {...modelRoute('new')} className={buttonVariants({ className: 'min-h-11' })}>
                {label('add')}
              </Link>
            )}
            {!workspace && (
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
            )}
            {draft && (
              <form
                noValidate
                aria-busy={modelForm.pending || undefined}
                onSubmit={(event) => void submit(event)}
                className={recordEditorSurface}
                aria-label={label('form')}
              >
                {catalogueRootMessage(modelForm.errors) && (
                  <Alert variant="destructive" className="m-4">
                    {catalogueRootMessage(modelForm.errors)}
                  </Alert>
                )}
                <fieldset disabled={busy} className="min-w-0">
                  <legend className="sr-only">{label('form')}</legend>
                  <RecordEditorSection title={copy('connection')}>
                    <div className={recordEditorGrid}>
                      <div className={recordEditorField}>
                        <Label htmlFor="ai-model-provider">{label('provider')}</Label>
                        <NativeSelect
                          {...modelForm.bind('providerType')}
                          id="ai-model-provider"
                          aria-required="true"
                          className="w-full"
                          value={draft.providerType}
                          onChange={(event) =>
                            modelForm.field('providerType')[1](
                              event.target.value as Model['providerType']
                            )
                          }
                        >
                          <option value="openai_compatible">{label('openai')}</option>
                          <option value="anthropic">Anthropic</option>
                        </NativeSelect>
                        <CatalogueFieldFeedback
                          compact
                          id={modelForm.errorId('providerType')}
                          error={modelForm.errors.providerType}
                          message={modelMessages.providerType!}
                        />
                      </div>
                      {(['title', 'modelName', 'baseUrl'] as const).map((key) => (
                        <div className={recordEditorField} key={key}>
                          <Label htmlFor={`ai-model-${key}`}>
                            {label(key === 'title' ? 'name' : key)}
                          </Label>
                          <Input
                            {...modelForm.bind(key)}
                            id={`ai-model-${key}`}
                            type={key === 'baseUrl' ? 'url' : 'text'}
                            required
                            aria-required="true"
                            aria-describedby={modelForm.errorId(key)}
                            maxLength={key === 'title' ? 120 : key === 'baseUrl' ? 500 : 200}
                            value={draft[key]}
                            dir={key === 'title' ? 'auto' : 'ltr'}
                            onChange={(event) => modelForm.field(key)[1](event.target.value)}
                          />
                          <CatalogueFieldFeedback
                            compact
                            id={modelForm.errorId(key)}
                            error={modelForm.errors[key]}
                            message={modelMessages[key]!}
                            hint={
                              key === 'baseUrl' ? (
                                <>
                                  {copy('requestPathHint')}{' '}
                                  <bdi dir="ltr" className="font-mono text-foreground">
                                    {draft.providerType === 'anthropic'
                                      ? '/messages'
                                      : '/chat/completions'}
                                  </bdi>
                                </>
                              ) : (
                                copy(key === 'title' ? 'titleHint' : 'modelNameHint')
                              )
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </RecordEditorSection>
                  <RecordEditorSection title={copy('authentication')}>
                    {draft.id && (
                      <div className={recordEditorField}>
                        <Label htmlFor="ai-model-token-choice">{label('tokenChoice')}</Label>
                        <NativeSelect
                          {...modelForm.bind('tokenChoice')}
                          id="ai-model-token-choice"
                          aria-describedby={[
                            modelForm.bind('tokenChoice')['aria-describedby'],
                            'ai-model-token-help',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          aria-required="true"
                          className="w-full"
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
                        </NativeSelect>
                        <p className="text-xs text-muted-foreground">
                          {draft.masked ? (
                            <bdi dir="ltr" className="font-mono">
                              {draft.masked}
                            </bdi>
                          ) : (
                            label('noToken')
                          )}
                        </p>
                        <CatalogueFieldFeedback
                          compact
                          id={modelForm.errorId('tokenChoice')}
                          error={modelForm.errors.tokenChoice}
                          message={modelMessages.tokenChoice!}
                        />
                      </div>
                    )}
                    {draft.tokenChoice === 'replace' && (
                      <div className={recordEditorField}>
                        <Label htmlFor="ai-model-token">{label('token')}</Label>
                        <Input
                          {...modelForm.bind('apiToken')}
                          id="ai-model-token"
                          aria-required={!!draft.masked || undefined}
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
                          compact
                          id={modelForm.errorId('apiToken')}
                          error={modelForm.errors.apiToken}
                          message={modelMessages.apiToken!}
                        />
                      </div>
                    )}
                    <p id="ai-model-token-help" className="text-xs text-muted-foreground">
                      {label('tokenHelp')}
                    </p>
                  </RecordEditorSection>
                  <RecordEditorSection title={copy('responseSettings')}>
                    <div className={recordEditorGrid}>
                      <div className={recordEditorField}>
                        <Label htmlFor="ai-model-max-tokens">{label('maxTokens')}</Label>
                        <Input
                          {...modelForm.bind('maxTokens')}
                          id="ai-model-max-tokens"
                          type="number"
                          min={1}
                          max={4096}
                          step={1}
                          required
                          aria-required="true"
                          value={draft.maxTokens}
                          onChange={(event) => modelForm.field('maxTokens')[1](event.target.value)}
                        />
                        <CatalogueFieldFeedback
                          compact
                          id={modelForm.errorId('maxTokens')}
                          error={modelForm.errors.maxTokens}
                          message={modelMessages.maxTokens!}
                        />
                      </div>
                      <div className={recordEditorField}>
                        <Label htmlFor="ai-model-temperature">{label('temperature')}</Label>
                        <Input
                          {...modelForm.bind('temperature')}
                          id="ai-model-temperature"
                          type="number"
                          min={0}
                          max={2}
                          step="any"
                          required
                          aria-required="true"
                          aria-describedby={modelForm.errorId('temperature')}
                          value={draft.temperature}
                          onChange={(event) =>
                            modelForm.field('temperature')[1](event.target.value)
                          }
                        />
                        <CatalogueFieldFeedback
                          compact
                          id={modelForm.errorId('temperature')}
                          error={modelForm.errors.temperature}
                          message={modelMessages.temperature!}
                          hint={copy('temperatureHint')}
                        />
                      </div>
                    </div>
                  </RecordEditorSection>
                </fieldset>
                <RecordEditorActions>
                  <Button type="button" variant="outline" disabled={pending} onClick={closeEditor}>
                    {label('cancel')}
                  </Button>
                  <CatalogueSaveButton
                    label={label('save')}
                    pending={modelForm.pending}
                    disabled={disabled || busy}
                  />
                </RecordEditorActions>
              </form>
            )}
            {budgetDraft && (
              <form
                noValidate
                aria-busy={budgetForm.pending || undefined}
                onSubmit={(event) => void submitBudget(event)}
                className={recordEditorSurface}
                aria-label={label('budgetForm')}
              >
                {catalogueRootMessage(budgetForm.errors) && (
                  <Alert variant="destructive" className="m-4">
                    {catalogueRootMessage(budgetForm.errors)}
                  </Alert>
                )}
                <fieldset disabled={busy} className="min-w-0">
                  <legend className="sr-only">{label('budgetForm')}</legend>
                  {(
                    [
                      {
                        title: copy('budgetLimits'),
                        description: label('budgetHelp'),
                        fields: [
                          ['monthlyTokenLimit', copy('tokenLimit'), '1', '1000000000', '1'],
                          ['monthlyCostUsd', copy('costLimit'), '0.000001', '1000000', '0.000001'],
                        ],
                      },
                      {
                        title: copy('budgetPricing'),
                        fields: [
                          ['inputPriceUsd', label('budgetInputPrice'), '0', '1000', '0.000001'],
                          ['outputPriceUsd', label('budgetOutputPrice'), '0', '1000', '0.000001'],
                        ],
                      },
                    ] as const
                  ).map(({ title, fields, ...section }) => (
                    <RecordEditorSection key={title} title={title} {...section}>
                      <div className={recordEditorGrid}>
                        {fields.map(([key, fieldLabel, min, max, step]) => (
                          <div className={recordEditorField} key={key}>
                            <Label htmlFor={`ai-model-${key}`}>{fieldLabel}</Label>
                            <Input
                              {...budgetForm.bind(key)}
                              id={`ai-model-${key}`}
                              type="number"
                              dir="ltr"
                              min={min}
                              max={max}
                              step={step}
                              required={key === 'inputPriceUsd' || key === 'outputPriceUsd'}
                              aria-required={
                                key === 'inputPriceUsd' || key === 'outputPriceUsd' || undefined
                              }
                              value={budgetDraft[key]}
                              onChange={(event) => budgetForm.field(key)[1](event.target.value)}
                            />
                            <CatalogueFieldFeedback
                              compact
                              id={budgetForm.errorId(key)}
                              error={budgetForm.errors[key]}
                              message={budgetMessages[key]!}
                            />
                          </div>
                        ))}
                      </div>
                    </RecordEditorSection>
                  ))}
                </fieldset>
                <RecordEditorActions>
                  <Button type="button" variant="outline" disabled={pending} onClick={closeEditor}>
                    {label('cancel')}
                  </Button>
                  <CatalogueSaveButton
                    label={label('budgetSave')}
                    pending={budgetForm.pending}
                    disabled={disabled || busy}
                  />
                </RecordEditorActions>
              </form>
            )}
            {workspace?.view === 'detail' && currentModel && (
              <section className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={currentModel.isEnabled ? 'default' : 'secondary'}>
                    {label(currentModel.isEnabled ? 'enabled' : 'disabled')}
                  </Badge>
                  <Badge variant="outline">{label(currentModel.status)}</Badge>
                  {currentModel.circuitOpen && (
                    <Badge variant="outline">{label('circuitOpen')}</Badge>
                  )}
                </div>
                <dl className="grid gap-4 border-y py-4 text-sm sm:grid-cols-2">
                  {Object.entries({
                    provider:
                      currentModel.providerType === 'anthropic' ? 'Anthropic' : label('openai'),
                    modelName: currentModel.modelName,
                    baseUrl: currentModel.baseUrl,
                    token: currentModel.apiTokenMasked || label('noToken'),
                    maxTokens: numbers.number(currentModel.config.max_tokens),
                    temperature: numbers.number(currentModel.config.temperature),
                  }).map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-muted-foreground">{label(key)}</dt>
                      <dd className="[overflow-wrap:anywhere]">
                        <bdi>{value}</bdi>
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-muted-foreground">{label('lastTest')}</dt>
                    <dd>
                      {currentModel.lastTestedAt ? (
                        <time dateTime={currentModel.lastTestedAt}>
                          {time.format(currentModel.lastTestedAt)}
                        </time>
                      ) : (
                        label('unknown')
                      )}
                    </dd>
                  </div>
                  {currentModel.circuitOpen && currentModel.circuitCooldownUntil && (
                    <div>
                      <dt className="text-muted-foreground">{label('circuitRetry')}</dt>
                      <dd>
                        <time dateTime={currentModel.circuitCooldownUntil}>
                          {time.format(currentModel.circuitCooldownUntil)}
                        </time>
                      </dd>
                    </div>
                  )}
                  {currentModel.lastTestLatencyMs !== null && (
                    <div>
                      <dt className="text-muted-foreground">{label('latency')}</dt>
                      <dd>
                        <bdi>{numbers.number(currentModel.lastTestLatencyMs)} ms</bdi>
                      </dd>
                    </div>
                  )}
                </dl>
                {currentModel.lastTestError && (
                  <p className="[overflow-wrap:anywhere] text-sm text-destructive" dir="auto">
                    {currentModel.lastTestError}
                  </p>
                )}
                <section className="space-y-2 border-b pb-4 text-sm">
                  <h2 className="font-semibold">{label('budgetTitle')}</h2>
                  {currentModel.budget ? (
                    <dl className="grid gap-2 sm:grid-cols-2">
                      {currentModel.budget.monthlyTokenLimit !== null && (
                        <div>
                          <dt className="text-muted-foreground">{label('budgetTokens')}</dt>
                          <dd>
                            <bdi>
                              {numbers.number(
                                currentModel.budget.usedInputTokens +
                                  currentModel.budget.usedOutputTokens
                              )}{' '}
                              / {numbers.number(currentModel.budget.monthlyTokenLimit)}
                            </bdi>
                          </dd>
                        </div>
                      )}
                      {currentModel.budget.monthlyCostLimitMicros !== null && (
                        <div>
                          <dt className="text-muted-foreground">{label('budgetCost')}</dt>
                          <dd>
                            <bdi>
                              {dollar.format(currentModel.budget.usedCostMicros / 1_000_000)} /{' '}
                              {dollar.format(
                                currentModel.budget.monthlyCostLimitMicros / 1_000_000
                              )}
                            </bdi>
                          </dd>
                        </div>
                      )}
                    </dl>
                  ) : (
                    <p className="text-muted-foreground">{label('budgetNone')}</p>
                  )}
                </section>
                <div role="group" aria-label={currentModel.title} className="flex flex-wrap gap-2">
                  {modelActions(currentModel)}
                </div>
              </section>
            )}
            {isList && (
              <ListPage.Content
                loading={loading}
                error={error}
                empty={models.length === 0}
                retainContent={models.length > 0}
                loadingView={<LoadingStatus>{label('loading')}</LoadingStatus>}
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
                  numerals={numeralSystem}
                  formatNumber={numbers.number}
                  formatTime={time.format}
                  {...(workspace && {
                    renderTitle: (model: Model) => (
                      <Link
                        {...modelRoute(model.id)}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        <bdi>{model.title}</bdi>
                      </Link>
                    ),
                  })}
                  renderActions={modelActions}
                />
              </ListPage.Content>
            )}
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
              let result = { ok: true, text: '' };
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
                if (workspace && workspace.view !== 'list') {
                  toast.success(label('success'));
                  workspace.showRecord(model.id, true);
                  return;
                }
              } else if (command.method === 'DELETE' && workspace?.view === 'detail') {
                toast.success(label('success'));
                workspace.showList();
                return;
              } else if (command.method !== 'DELETE') {
                const id = commandBasis.current?.id;
                if (!id) throw new Error('Missing reviewed model');
                if (command.method === 'POST') {
                  const tested = readModelTestReceipt(value, id);
                  if (!tested) throw new Error('Unconfirmed model test');
                  result = tested;
                } else {
                  const rows = [value];
                  const settings = command.body as { isEnabled: boolean };
                  if (
                    !validModels(rows) ||
                    rows[0]?.id !== id ||
                    rows[0].isEnabled !== settings.isEnabled
                  )
                    throw new Error('Unconfirmed model availability');
                }
              }
              setResult(result);
              if (command.body && typeof command.body === 'object' && 'config' in command.body) {
                setDraft(null);
              }
              if (command.path.endsWith('/budget')) {
                setBudgetDraft(null);
              }
              commandBasis.current = null;
              setRevision((v) => v + 1);
              return result.ok ? label('success') : undefined;
            })(action, commandGeneration.current)}
          />
        </Suspense>
      )}
    </section>
  );
}

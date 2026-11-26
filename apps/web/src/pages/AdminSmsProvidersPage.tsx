import {
  Ban as TableBanIcon,
  CheckCircle as TableCheckCircleIcon,
  Copy as TableCopyIcon,
  Eye as TableEyeIcon,
  Pencil as TablePencilIcon,
  Plus as TablePlusIcon,
  RotateCcw as TableRotateCcwIcon,
  Trash2 as TableTrash2Icon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { Link } from '@tanstack/react-router';
import { CommandFeedback } from '../components/CommandFeedback.js';
import {
  providerDestination,
  providerSelectionKey,
  type ProviderSelection,
  type ProviderWorkspace,
} from '../lib/provider-workspace.js';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import {
  useProviderCatalogue,
  providerBasis,
  useProviderCommandGuard,
  useProviderCommandRecovery,
} from '../hooks/useProviderCatalogue.js';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  LoadingStatus,
  Button,
  buttonVariants,
  DateCell,
  Input,
  Label,
  ListPage,
  NativeSelect,
  TextCell,
} from '@barghsa/ui';
import { buildSmsTestParameters } from '@barghsa/shared/notifications';
import { providerText, smsProviderText } from '@barghsa/i18n/providers';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { DeliveryProviderDetail } from '../components/DeliveryProviderDetail.js';
import { DeliveryProviderTable } from '../components/DeliveryProviderTable.js';
import { ProviderHealthMetrics } from '../components/ProviderHealthMetrics.js';
import { ProviderAlertHistory } from '../components/ProviderAlertHistory.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
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
import {
  StickyRecordEditorActions,
  keepRecordFieldVisible,
  recordEditorFormSurface,
} from '../components/StickyRecordEditorActions.js';
import { providerFormText } from '@barghsa/i18n/provider-forms';
import {
  editorFor,
  configFor,
  mapping,
  variable,
  smsInvalidFields,
  type SmsEditor,
  type Mapping,
} from '../lib/provider-form.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  ProviderStepUpError,
  ProviderRequestError,
  type Status,
} from '../lib/email-providers-api.js';
import {
  listSmsProviders,
  listSmsEventKeys,
  listSmsTemplateVariableChoices,
  smsVariableChoices,
  readSmsProvider,
  sameSmsConfig,
  smsRequest,
  type SmsProvider,
} from '../lib/sms-providers-api.js';

export default function AdminSmsProvidersPage({
  embedded = false,
  workspace,
}: { embedded?: boolean; workspace?: ProviderWorkspace } = {}) {
  const Heading = embedded ? 'h2' : 'h1';
  const locale = useLocale(),
    time = useAccountTime();
  const { number } = useNumberFormatting(locale);
  const text = (key: Parameters<typeof smsProviderText>[0]) => smsProviderText(key, locale);
  const healthLabel = (provider: SmsProvider) => {
    if (!provider.degraded) return text('healthHealthy');
    if (provider.degradedReason === 'provider_configuration_pause')
      return text('healthConfiguration');
    if (provider.breakerCooldownUntil && Date.parse(provider.breakerCooldownUntil) > Date.now())
      return `${text('healthPaused')} ${time.format(provider.breakerCooldownUntil)}`;
    return text('healthProbe');
  };
  const [busy, setBusy] = useState(false);
  const [editSource, setEditSource] = useState<{ id: string; basis: string } | null>(null);
  const [showEditor, setShowEditor] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [firstEvent, setFirstEvent] = useState('');
  const address = useRef('');
  const requested = useRef({ key: '', restore: false });
  const requestedPanel = workspace?.selection?.panel;
  const requestedId = workspace?.selection?.id;
  const [testContact, setTestContact] = useState<{ basis: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [protectedAction, setProtectedAction] = useState<{
    action: TeamAction;
    basis: string;
    onSuccess: (result: unknown) => Promise<void>;
    kind: 'save' | 'test' | 'change';
  } | null>(null);
  const inFlight = useRef(false);
  const protectedDispatched = useRef(false);
  const generation = useRef(0);
  const validationOwner = useRef(0);
  const eventNames = useRef<string[]>([]);
  const messages: Record<keyof SmsEditor, string> = {
    id: '',
    keyConfigured: '',
    label: providerFormText('label', locale),
    key: providerFormText('apiKeyMessage', locale),
    sender: providerFormText('sender', locale),
    timeout: providerFormText('timeout', locale),
    throughput: providerFormText('throughput', locale),
    credit: providerFormText('credit', locale),
    mappings: providerFormText('mappings', locale),
  };
  const form = useWizardForm<SmsEditor>(
    async () => {
      const { providerFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return providerFormSchema(messages, (draft) => smsInvalidFields(draft, eventNames.current));
    },
    () => editorFor(),
    providerFormText('validationUnavailable', locale)
  );
  const editor = showEditor ? form.values : null;
  const setEditor = (value: SmsEditor | null) => {
    resetForm(value ?? editorFor());
    setShowEditor(value !== null);
  };
  const registerMapping = form.form.register;
  const mappingRef = useCallback(
    (node: HTMLElement | null) => {
      registerMapping('mappings').ref(node ? { focus: () => node.focus() } : null);
    },
    [registerMapping]
  );
  const fieldErrors = useActionFieldErrors(
    form.form,
    {
      label: messages.label,
      key: messages.key,
      sender: messages.sender,
      timeout: messages.timeout,
      throughput: messages.throughput,
      credit: messages.credit,
      mappings: messages.mappings,
    },
    text('invalid')
  );
  const resetForm = form.form.reset;
  const clearPrivate = useCallback(() => {
    address.current = '';
    requested.current = { key: '', restore: false };
    form.form.reset(editorFor());
    setShowEditor(false);
    generation.current++;
    validationOwner.current++;
    inFlight.current = false;
    form.setValidationPending(false);
    setEditSource(null);
    setSelected(null);
    setFirstEvent('');
    setTestContact(null);
    protectedDispatched.current = false;
    setProtectedAction(null);
    setError(null);
    setNotice(null);
    setBusy(false);
  }, [resetForm, form.setValidationPending]);
  const scope = useCatalogueScope(clearPrivate);
  const catalogue = useProviderCatalogue(scope, listSmsProviders);
  const command = useProviderCommandRecovery(catalogue.ownerKey, catalogue);
  const previousOwner = useRef(catalogue.ownerKey);
  useEffect(() => {
    if (previousOwner.current === catalogue.ownerKey) return;
    previousOwner.current = catalogue.ownerKey;
    clearPrivate();
  }, [catalogue.ownerKey, clearPrivate]);
  const uncertain = command.pending === 'save';
  const eventKeys = useProviderCatalogue(scope, listSmsEventKeys);
  const templateVariables = useProviderCatalogue(scope, listSmsTemplateVariableChoices);
  const providers = catalogue.data ?? [],
    events = eventKeys.data ?? [];
  eventNames.current = events;
  const loading = catalogue.loading,
    loadFailed = catalogue.error;
  const refresh = catalogue.refresh;
  const rowBasis = (p: SmsProvider, test = true) =>
    providerBasis({
      id: p.id,
      label: p.label,
      status: p.status,
      keyConfigured: p.keyConfigured,
      keyRevision: p.keyRevision,
      ...(test ? { lastTestStatus: p.lastTestStatus } : {}),
      config: p.config,
    });
  const basis = providerBasis([providers.map((p) => rowBasis(p)).sort(), events]);
  const capture = useProviderCommandGuard(basis, catalogue.ownerKey, scope.live);
  const staleEditor =
    !!editor &&
    !!editSource &&
    !providers.some((p) => p.id === editSource.id && rowBasis(p, false) === editSource.basis);
  const disabled =
    loading || loadFailed || scope.denied || busy || !!protectedAction || !!command.pending;
  const eventsReady =
    eventKeys.data !== null && !eventKeys.loading && !eventKeys.error && !scope.denied;
  useEffect(() => {
    if (protectedAction && protectedAction.basis !== basis && !protectedDispatched.current)
      setProtectedAction(null);
  }, [basis, protectedAction]);
  const invalidEvents =
    !!editor && editor.mappings.some((m) => m.event && !events.includes(m.event));
  useEffect(() => {
    if (
      catalogue.data &&
      selected &&
      !catalogue.data.some((p) => p.id === selected && p.status === 'draft')
    ) {
      setSelected(null);
      setFirstEvent('');
    }
  }, [catalogue.data, selected]);
  const recovery = (compact = false) => (
    <div className="flex flex-wrap gap-x-2 gap-y-1">
      <div>
        <Button
          type="button"
          variant={compact ? 'ghost' : 'outline'}
          size={compact ? 'sm' : 'default'}
          disabled={loading || busy}
          onClick={async () => {
            if (scope.denied) return scope.recover();
            await refresh();
          }}
        >
          {text(loadFailed || scope.denied ? 'retry' : 'refresh')}
        </Button>
      </div>
      {!scope.denied && (
        <div>
          {templateVariables.loading && <LoadingStatus>{text('variablesLoading')}</LoadingStatus>}
          {templateVariables.error && <p role="alert">{text('variablesFailed')}</p>}
          <Button
            type="button"
            variant={compact ? 'ghost' : 'outline'}
            size={compact ? 'sm' : 'default'}
            disabled={templateVariables.loading || busy}
            onClick={() => void templateVariables.refresh()}
          >
            {text('retryVariables')}
          </Button>
        </div>
      )}
      {!scope.denied && (
        <div>
          {eventKeys.loading && <LoadingStatus>{text('eventsLoading')}</LoadingStatus>}
          {eventKeys.error && <p role="alert">{text('eventsFailed')}</p>}
          <Button
            type="button"
            variant={compact ? 'ghost' : 'outline'}
            size={compact ? 'sm' : 'default'}
            disabled={eventKeys.loading || busy}
            onClick={() => void eventKeys.refresh()}
          >
            {text('retryEvents')}
          </Button>
        </div>
      )}
    </div>
  );
  const testProvider = providers.find((p) => p.id === selected);
  const testContactBasis = testProvider ? rowBasis(testProvider, false) : '';
  const testRecipient = testContact?.basis === testContactBasis ? testContact.value : '';
  const validTestRecipient = /^\+?[1-9][0-9]{9,14}$/.test(testRecipient.trim());
  const testMappings = [...(testProvider?.config.template_mappings ?? [])].sort(
    (a, b) => Number(b.event_key === firstEvent) - Number(a.event_key === firstEvent)
  );

  async function mutate(
    action: Pick<TeamAction, 'path' | 'method' | 'body'>,
    accept: (result: unknown) => Promise<void>,
    kind: 'save' | 'test'
  ) {
    if (inFlight.current || disabled || !eventsReady) return;
    const guard = capture();
    const ticket = ++generation.current;
    const owned = () => ticket === generation.current && guard.owned();
    const current = () => owned() && guard.current();
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await smsRequest(action.path, action.method as 'POST' | 'PUT', action.body);
      if (!current()) throw new ProviderRequestError(false, [], true);
      await accept(result);
    } catch (e) {
      if (!owned()) return;
      if (e instanceof ProviderRequestError && e.denied) {
        scope.deny();
        return;
      }
      if (!current() || (e instanceof ProviderRequestError && e.uncertain)) {
        command.mark(kind);
        if (kind === 'save') setError(text('unavailable'));
        return;
      }
      if (kind === 'save' && e instanceof ProviderRequestError && fieldErrors(e.fields)) return;
      if (e instanceof ProviderStepUpError)
        setProtectedAction({
          basis,
          kind,
          action: {
            ...e.action,
            title: text('title'),
            description: text('confirm'),
            requiresOtp: true,
            responseDeadline: true,
          },
          onSuccess: async (result) => {
            if (!current()) throw new ProviderRequestError(false, [], true);
            await accept(result);
          },
        });
      else setError(text('unavailable'));
    } finally {
      if (ticket === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      !editor ||
      inFlight.current ||
      form.isPending() ||
      disabled ||
      !eventsReady ||
      staleEditor ||
      uncertain
    )
      return;
    const owner = ++validationOwner.current;
    const ticket = generation.current,
      { current } = capture();
    form.setValidationPending(true);
    const captured: { value?: SmsEditor } = {};
    try {
      await form.form.handleSubmit((value) => {
        captured.value = value;
      })();
      if (!captured.value || ticket !== generation.current || !current()) return;
      const draft = captured.value,
        config = configFor(draft),
        label = draft.label.trim();
      await mutate(
        {
          path: draft.id ? `/${encodeURIComponent(draft.id)}` : '',
          method: draft.id ? 'PUT' : 'POST',
          body: { label, config: { ...config, ...(draft.key ? { api_key: draft.key } : {}) } },
        },
        async (result) => {
          let saved: SmsProvider;
          try {
            saved = readSmsProvider(result, {
              status: 'draft',
              ...(draft.id ? { id: draft.id } : {}),
            });
            if (
              saved.label !== label ||
              !saved.keyConfigured ||
              !sameSmsConfig(saved.config, config)
            )
              throw new ProviderRequestError();
          } catch {
            throw new ProviderRequestError(false, [], true);
          }
          setEditor(null);
          setSelected(saved.id);
          setFirstEvent(saved.config.template_mappings[0]?.event_key ?? '');
          navigateEditor({ panel: workspace ? 'detail' : 'preview', id: saved.id }, true);
          setNotice(text('saved'));
          await refresh();
        },
        'save'
      );
    } finally {
      if (owner === validationOwner.current) form.setValidationPending(false);
    }
  }
  function lifecycle(row: SmsProvider, operation: 'activate' | 'disable' | 'rollback') {
    if (disabled || !eventsReady) return;
    const { current } = capture();
    setError(null);
    setNotice(null);
    const status: Status =
      operation === 'rollback' ? 'draft' : operation === 'disable' ? 'disabled' : 'active';
    setProtectedAction({
      basis,
      kind: 'change',
      action: {
        ...(operation === 'disable' ? { risk: 'destructive' as const } : {}),
        title: text(operation),
        description: text(operation === 'rollback' ? 'rollbackNotice' : 'confirm'),
        path: `/api/admin/sms-providers/${encodeURIComponent(row.id)}/${operation}`,
        method: 'POST',
        responseDeadline: true,
      },
      onSuccess: async (result) => {
        if (!current()) throw new ProviderRequestError(false, [], true);
        const saved = readSmsProvider(result, {
          status,
          ...(operation !== 'rollback' ? { id: row.id } : {}),
        });
        if (
          operation === 'rollback' &&
          (saved.id === row.id || saved.lastTestStatus !== 'pending' || saved.activatedAt != null)
        )
          throw new ProviderRequestError(false, [], true);
        setSelected(null);
        if (workspace) navigateEditor({ panel: 'detail', id: saved.id }, true);
        else navigateEditor(undefined, true);
        setNotice(text(operation === 'rollback' ? 'restoredDraft' : 'changed'));
        await refresh();
      },
    });
  }
  async function test() {
    if (
      disabled ||
      !eventsReady ||
      !testProvider ||
      testProvider.status !== 'draft' ||
      !validTestRecipient ||
      !testMappings.length ||
      !testMappings.some((m) => m.event_key === firstEvent)
    )
      return;
    const id = testProvider.id;
    await mutate(
      {
        path: `/${encodeURIComponent(id)}/test-connection`,
        method: 'POST',
        body: { eventKey: firstEvent, recipient: testRecipient.trim() },
      },
      async (result) => {
        let saved: SmsProvider;
        try {
          saved = readSmsProvider(result, { status: 'draft', id });
        } catch {
          throw new ProviderRequestError(false, [], true);
        }
        const outcome = (result as { test?: { ok?: unknown; error?: unknown } }).test;
        if (
          !outcome ||
          typeof outcome.ok !== 'boolean' ||
          !(outcome.error === null || typeof outcome.error === 'string') ||
          saved.lastTestStatus !== (outcome.ok ? 'passed' : 'failed') ||
          (outcome.ok && outcome.error !== null)
        )
          throw new ProviderRequestError(false, [], true);
        if (outcome.ok) setNotice(text('passed'));
        else setError(text('failed'));
        await refresh();
      },
      'test'
    );
  }
  function field(
    key: 'label' | 'sender' | 'timeout' | 'throughput' | 'credit' | 'key' | 'mappings',
    value: string | Mapping[]
  ) {
    form.field(key)[1](value);
  }
  function changeMapping(id: string, change: Partial<Mapping>) {
    field(
      'mappings',
      form.form.getValues('mappings').map((m) => (m.id === id ? { ...m, ...change } : m))
    );
  }
  function navigateEditor(selection: ProviderSelection | undefined, replace = false) {
    address.current = providerSelectionKey(selection);
    requested.current.restore = false;
    workspace?.set(selection, replace);
  }
  function open(row?: SmsProvider, clone = false, publish = true) {
    generation.current++;
    command.reset();
    form.setValidationPending(false);
    setEditor(editorFor(row, clone));
    setEditSource(row ? { id: row.id, basis: rowBasis(row, false) } : null);
    setSelected(null);
    setError(null);
    setNotice(null);
    if (publish)
      navigateEditor(row ? { panel: clone ? 'clone' : 'edit', id: row.id } : { panel: 'new' });
  }
  function openPreview(row: SmsProvider, publish = true) {
    setSelected(row.id);
    setFirstEvent(row.config.template_mappings[0]?.event_key ?? '');
    setNotice(null);
    setError(null);
    if (publish) navigateEditor({ panel: 'preview', id: row.id });
  }
  useLayoutEffect(() => {
    if (!workspace || scope.denied) return;
    const selection = workspace.selection;
    const key = providerSelectionKey(selection);
    if (requested.current.key !== key) {
      const restore = address.current !== key;
      if (restore) {
        clearPrivate();
        command.reset();
      }
      requested.current = { key, restore };
    }
    if (!requested.current.restore) return;
    if (selection && (loading || loadFailed || !catalogue.data)) return;
    requested.current.restore = false;
    address.current = key;
    if (selection?.panel === 'new') open(undefined, false, false);
    else if (selection) {
      const row = catalogue.data?.find((provider) => provider.id === selection.id);
      if (row && selection.panel === 'clone' && row.status !== 'draft') open(row, true, false);
      else if (row?.status === 'draft' && selection.panel === 'edit') open(row, false, false);
      else if (row?.status === 'draft' && selection.panel === 'preview') openPreview(row, false);
      else if (selection.panel !== 'detail') setError(text('stale'));
    }
  }, [requestedPanel, requestedId, scope.denied, loading, loadFailed, catalogue.data]);

  const providerFields = [
    {
      id: 'status',
      label: text('status'),
      render: (p: SmsProvider) => (
        <>
          {text(p.status)}
          {p.status === 'active' && (
            <>
              {p.activatedAt && (
                <p className="text-xs text-muted-foreground">
                  {providerText('admin.providers.meta.activatedAt', locale)}{' '}
                  <DateCell value={p.activatedAt} format={(value) => time.format(value)} />
                </p>
              )}
              <p className={`text-xs ${p.degraded ? 'text-destructive' : 'text-muted-foreground'}`}>
                {healthLabel(p)}
              </p>
              {p.degraded && p.lastFailureAt && (
                <p className="text-xs text-muted-foreground">
                  {text('healthLastFailure')}:{' '}
                  <DateCell value={p.lastFailureAt} format={(value) => time.format(value)} />
                </p>
              )}
              {p.creditCheckedAt && p.lowCreditBalance !== null && (
                <p
                  className={`text-xs ${p.lowCreditAlertActive ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {text('creditBalance')}:{' '}
                  <bdi className="tabular-nums">{number(p.lowCreditBalance)}</bdi> ·{' '}
                  {text('creditChecked')}:{' '}
                  <DateCell value={p.creditCheckedAt} format={(value) => time.format(value)} />
                </p>
              )}
              {p.lowCreditAlertActive && (
                <p className="text-xs font-medium text-destructive">{text('creditLow')}</p>
              )}
            </>
          )}
          <ProviderHealthMetrics metrics={p.healthMetrics} active={p.status === 'active'} />
          <ProviderAlertHistory events={p.alertHistory} />
        </>
      ),
    },
    {
      id: 'lastTest',
      label: text('lastTest'),
      render: (p: SmsProvider) => (
        <>
          {text(
            p.lastTestStatus === 'passed'
              ? 'testPassed'
              : p.lastTestStatus === 'failed'
                ? 'testFailed'
                : 'pending'
          )}
        </>
      ),
    },
    {
      id: 'version',
      label: text('version'),
      render: (p: SmsProvider) => (
        <>
          <DateCell value={p.createdAt} format={(value) => time.format(value)} />
        </>
      ),
    },
  ];
  const providerActions = (p: SmsProvider) => (
    <div className="flex flex-wrap gap-2">
      {p.status === 'draft' ? (
        <>
          {workspace && !disabled ? (
            <Link
              {...providerDestination('sms', { panel: 'edit', id: p.id })}
              className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
              data-table-action-tooltip={text('edit')}
            >
              <TableActionIcon icon={TablePencilIcon}>{text('edit')}</TableActionIcon>
            </Link>
          ) : (
            <Button
              variant="outline"
              disabled={disabled || !!editor}
              onClick={() => open(p)}
              data-table-action-tooltip={text('edit')}
            >
              <TableActionIcon icon={TablePencilIcon}>{text('edit')}</TableActionIcon>
            </Button>
          )}
          {workspace && !disabled && p.config.template_mappings.length > 0 ? (
            <Link
              {...providerDestination('sms', { panel: 'preview', id: p.id })}
              className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
              data-table-action-tooltip={text('preview')}
            >
              <TableActionIcon icon={TableEyeIcon}>{text('preview')}</TableActionIcon>
            </Link>
          ) : (
            <Button
              variant="outline"
              disabled={disabled || !!editor || !p.config.template_mappings.length}
              onClick={() => openPreview(p)}
              data-table-action-tooltip={text('preview')}
            >
              <TableActionIcon icon={TableEyeIcon}>{text('preview')}</TableActionIcon>
            </Button>
          )}
          <Button
            disabled={disabled || !eventsReady || !!editor || p.lastTestStatus !== 'passed'}
            onClick={() => lifecycle(p, 'activate')}
            data-table-action-tooltip={text('activate')}
          >
            <TableActionIcon icon={TableCheckCircleIcon}>{text('activate')}</TableActionIcon>
          </Button>
        </>
      ) : workspace && !disabled ? (
        <Link
          {...providerDestination('sms', { panel: 'clone', id: p.id })}
          className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
          data-table-action-tooltip={text('clone')}
        >
          <TableActionIcon icon={TableCopyIcon}>{text('clone')}</TableActionIcon>
        </Link>
      ) : (
        <Button
          variant="outline"
          disabled={disabled || !!editor}
          onClick={() => open(p, true)}
          data-table-action-tooltip={text('clone')}
        >
          <TableActionIcon icon={TableCopyIcon}>{text('clone')}</TableActionIcon>
        </Button>
      )}
      {p.status === 'active' && (
        <Button
          variant="outline"
          disabled={disabled || !eventsReady || !!editor}
          onClick={() => lifecycle(p, 'disable')}
          data-table-action-tooltip={text('disable')}
        >
          <TableActionIcon icon={TableBanIcon}>{text('disable')}</TableActionIcon>
        </Button>
      )}
      {(p.status === 'superseded' || p.status === 'disabled') && (
        <Button
          variant="outline"
          disabled={disabled || !eventsReady || !!editor}
          onClick={() => lifecycle(p, 'rollback')}
          data-table-action-tooltip={text('rollback')}
        >
          <TableActionIcon icon={TableRotateCcwIcon}>{text('rollback')}</TableActionIcon>
        </Button>
      )}
    </div>
  );

  const showingRecord = workspace?.selection !== undefined;
  const detail =
    requestedPanel === 'detail' && providers.find((provider) => provider.id === requestedId);
  const failed = loadFailed || scope.denied;

  return (
    <section
      aria-labelledby={showingRecord ? undefined : 'sms-title'}
      className="min-w-0 space-y-5 text-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      {protectedAction && (
        <TeamActionDialog
          action={protectedAction.action}
          onClose={() => {
            protectedDispatched.current = false;
            setProtectedAction(null);
          }}
          onSuccess={protectedAction.onSuccess}
          {...(protectedAction.kind === 'save' ? { onValidationError: fieldErrors } : {})}
          summary={
            <>
              {(loadFailed || scope.denied) && (
                <p role="alert">{text(scope.denied ? 'denied' : 'loadFailed')}</p>
              )}
              {recovery()}
            </>
          }
          onUnconfirmed={() => command.mark(protectedAction.kind)}
          onCommandDispatch={(sent) => {
            protectedDispatched.current = sent;
          }}
          onPendingChange={(pending) => {
            if (!pending) protectedDispatched.current = false;
          }}
          onDenied={scope.deny}
          finalFocus={() =>
            document.querySelector<HTMLButtonElement>('[data-slot="list-page"] button')
          }
          confirmationDisabled={
            !!command.pending ||
            loading ||
            loadFailed ||
            scope.denied ||
            !eventsReady ||
            staleEditor ||
            protectedAction.basis !== basis
          }
        />
      )}
      {!showingRecord && (
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading id="sms-title" className="text-xl font-semibold">
              {text('title')}
            </Heading>
            <p className="text-muted-foreground">{text('subtitle')}</p>
          </div>
          {workspace && !disabled ? (
            <Link
              {...providerDestination('sms', { panel: 'new' })}
              className={buttonVariants({ className: 'min-h-11' })}
            >
              {text('new')}
            </Link>
          ) : (
            <Button disabled={disabled || !!editor} onClick={() => open()}>
              {text('new')}
            </Button>
          )}
        </header>
      )}
      {!showingRecord && <p className="text-sm text-muted-foreground">{text('recovery')}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <CommandFeedback message={notice} />
      {command.pending && command.pending !== 'save' && (
        <div className="space-y-2">
          <p role="alert">
            {providerFormText(
              command.pending === 'test' ? 'testUnconfirmed' : 'changeUnconfirmed',
              locale
            )}
          </p>
          <Button
            variant="outline"
            disabled={!command.canReview || !!protectedAction}
            onClick={command.reset}
          >
            {providerFormText(command.pending === 'test' ? 'reviewTest' : 'reviewChange', locale)}
          </Button>
        </div>
      )}
      {showingRecord && !failed && recovery(true)}
      {showingRecord && loading && <LoadingStatus>{text('tabs')}…</LoadingStatus>}
      {showingRecord && failed && (
        <div role="alert" className="space-y-2">
          {text(scope.denied ? 'denied' : 'loadFailed')}
          {recovery()}
        </div>
      )}
      {requestedPanel === 'detail' &&
        !loading &&
        !failed &&
        (detail ? (
          <DeliveryProviderDetail provider={detail} fields={providerFields}>
            {providerActions(detail)}
          </DeliveryProviderDetail>
        ) : (
          <p role="alert">{providerText('admin.providers.missing', locale)}</p>
        ))}
      {!showingRecord && (
        <ListPage>
          <ListPage.Toolbar>{recovery()}</ListPage.Toolbar>
          <ListPage.Content
            loading={loading}
            error={loadFailed || scope.denied}
            retainContent={providers.length > 0}
            loadingView={<LoadingStatus>{smsProviderText('tabs', locale)}…</LoadingStatus>}
            errorView={<p role="alert">{text(scope.denied ? 'denied' : 'loadFailed')}</p>}
            empty={!providers.length}
            emptyView={<p>{text('empty')}</p>}
          >
            <DeliveryProviderTable
              rows={providers}
              caption={text('title')}
              scrollLabel={text('table')}
              labelHeader={text('label')}
              actionHeader={text('actions')}
              fields={providerFields}
              {...(workspace
                ? {
                    renderLabel: (p: SmsProvider) => (
                      <Link
                        {...providerDestination('sms', { panel: 'detail', id: p.id })}
                        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                      >
                        <TextCell value={p.label} />
                      </Link>
                    ),
                  }
                : { renderActions: providerActions })}
              loading={loading}
              emptyMessage=""
              tableClassName="min-w-[52rem]"
            />
          </ListPage.Content>
        </ListPage>
      )}
      {editor && (
        <form
          noValidate
          onSubmit={save}
          onFocus={keepRecordFieldVisible}
          aria-label={text(editor.id ? 'edit' : 'new')}
          className={recordEditorFormSurface}
        >
          {(staleEditor ||
            (invalidEvents && eventsReady) ||
            uncertain ||
            catalogueRootMessage(form.errors)) && (
            <div className="space-y-2 border-b px-4 py-3 sm:px-6">
              {staleEditor && <p role="alert">{text('stale')}</p>}
              {invalidEvents && eventsReady && <p role="alert">{text('eventsChanged')}</p>}
              {uncertain && <p role="alert">{providerFormText('uncertain', locale)}</p>}
              {(staleEditor || uncertain) && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    loading ||
                    loadFailed ||
                    busy ||
                    !!protectedAction ||
                    (uncertain && !command.canReview)
                  }
                  onClick={() => {
                    const row = providers.find((p) => p.id === editSource?.id);
                    if (editor.id && row?.status !== 'draft') {
                      command.reset();
                      setEditor(null);
                      navigateEditor(undefined, true);
                    } else open(row, editor.id === null && !!row);
                  }}
                >
                  {providerFormText('reset', locale)}
                </Button>
              )}
              {catalogueRootMessage(form.errors) && (
                <p role="alert">{catalogueRootMessage(form.errors)}</p>
              )}
            </div>
          )}
          <fieldset
            disabled={
              busy || form.pending || !!protectedAction || scope.denied || staleEditor || uncertain
            }
            className="min-w-0"
          >
            <legend className="sr-only">{text(editor.id ? 'edit' : 'new')}</legend>
            <RecordEditorSection title={providerFormText('providerDetails', locale)}>
              <div className={recordEditorGrid}>
                {(['label', 'sender'] as const).map((key) => (
                  <div key={key} className={recordEditorField}>
                    <Label htmlFor={`sms-${key}`}>{text(key)}</Label>
                    <Input
                      {...form.bind(key)}
                      id={`sms-${key}`}
                      dir={key === 'label' ? 'auto' : 'ltr'}
                      value={editor[key]}
                      onChange={(e) => field(key, e.target.value)}
                      required
                      aria-required="true"
                      type="text"
                      maxLength={key === 'sender' ? 64 : 120}
                    />
                    {form.errors[key] && (
                      <p id={form.errorId(key)} role="alert" className="text-sm text-destructive">
                        {form.errors[key]?.message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </RecordEditorSection>
            <RecordEditorSection title={providerFormText('credentials', locale)}>
              <div className={recordEditorField}>
                <Label htmlFor="sms-key">{text('key')}</Label>
                <Input
                  {...form.bind('key')}
                  id="sms-key"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  value={editor.key}
                  required={!editor.keyConfigured}
                  aria-required={!editor.keyConfigured || undefined}
                  maxLength={1024}
                  onChange={(e) => field('key', e.target.value)}
                  aria-describedby={[form.bind('key')['aria-describedby'], 'sms-key-hint']
                    .filter(Boolean)
                    .join(' ')}
                />
                {form.errors.key && (
                  <p id={form.errorId('key')} role="alert" className="text-sm text-destructive">
                    {form.errors.key.message}
                  </p>
                )}
                <p id="sms-key-hint" className="text-xs text-muted-foreground">
                  {text(editor.keyConfigured ? 'keyHint' : 'keyMissing')}
                </p>
              </div>
            </RecordEditorSection>
            <RecordEditorSection title={providerFormText('limits', locale)}>
              <div className="grid max-w-xl gap-3 min-[375px]:grid-cols-2 sm:grid-cols-3">
                {(['timeout', 'throughput', 'credit'] as const).map((key) => (
                  <div key={key} className={recordEditorField}>
                    <Label htmlFor={`sms-${key}`}>{text(key)}</Label>
                    <RecordNumberInput
                      {...form.bind(key)}
                      id={`sms-${key}`}
                      value={editor[key]}
                      onChange={(value) => field(key, value)}
                      required
                      aria-required="true"
                      locale={locale}
                      {...(key === 'timeout'
                        ? { min: 1, max: 300 }
                        : key === 'throughput'
                          ? { min: 1, max: 10000 }
                          : { min: 0, max: 1_000_000_000 })}
                    />
                    {form.errors[key] && (
                      <p id={form.errorId(key)} role="alert" className="text-sm text-destructive">
                        {form.errors[key]?.message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </RecordEditorSection>
            <RecordEditorSection title={text('mappings')}>
              {form.errors.mappings && (
                <p id={form.errorId('mappings')} role="alert" className="text-sm text-destructive">
                  {form.errors.mappings.message}
                </p>
              )}
              {editor.mappings.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {providerFormText('noMappings', locale)}
                </p>
              )}
              {editor.mappings.map((m, index) => {
                const id = `sms-mapping-${m.id}`;
                const title = `${providerFormText('mappingTitle', locale)} ${new Intl.NumberFormat(locale).format(index + 1)}`;
                return (
                  <div
                    key={m.id}
                    role="group"
                    aria-labelledby={`${id}-title`}
                    className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 id={`${id}-title`} className="text-sm font-semibold">
                        {title}
                      </h3>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`${text('remove')} ${text('event')} ${index + 1}`}
                        title={text('remove')}
                        onClick={() =>
                          field(
                            'mappings',
                            editor.mappings.filter((entry) => entry.id !== m.id)
                          )
                        }
                      >
                        <TableTrash2Icon aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                      <div className={recordEditorField}>
                        <Label htmlFor={`${id}-event`}>{text('event')}</Label>
                        <NativeSelect
                          {...(index === 0 ? { ...form.bind('mappings'), ref: mappingRef } : {})}
                          id={`${id}-event`}
                          className="w-full min-w-0"
                          aria-invalid={form.errors.mappings ? true : undefined}
                          aria-describedby={
                            form.errors.mappings ? form.errorId('mappings') : undefined
                          }
                          aria-label={`${text('event')} ${index + 1}`}
                          disabled={!eventsReady}
                          value={m.event}
                          required
                          aria-required="true"
                          onChange={(e) => changeMapping(m.id, { event: e.target.value })}
                        >
                          <option value="" disabled>
                            {providerFormText('chooseEvent', locale)}
                          </option>
                          {m.event && !events.includes(m.event) && (
                            <option value={m.event} disabled>
                              {m.event}
                              {eventsReady && ` · ${providerFormText('unavailableEvent', locale)}`}
                            </option>
                          )}
                          {events.map((event) => (
                            <option key={event} value={event}>
                              {event}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                      <div className={recordEditorField}>
                        <Label htmlFor={`${id}-language`}>{text('language')}</Label>
                        <NativeSelect
                          id={`${id}-language`}
                          className="w-full"
                          aria-label={`${text('language')} ${index + 1}`}
                          aria-required="true"
                          value={m.locale}
                          onChange={(e) =>
                            changeMapping(m.id, { locale: e.target.value as Mapping['locale'] })
                          }
                        >
                          <option value="all">{text('allLanguages')}</option>
                          <option value="fa">{text('persian')}</option>
                          <option value="en">{text('english')}</option>
                        </NativeSelect>
                      </div>
                      <div className={recordEditorField}>
                        <Label htmlFor={`${id}-template`}>{text('template')}</Label>
                        <Input
                          id={`${id}-template`}
                          dir="ltr"
                          aria-label={`${text('template')} ${index + 1}`}
                          value={m.template}
                          maxLength={128}
                          inputMode="numeric"
                          required
                          aria-required="true"
                          onChange={(e) => changeMapping(m.id, { template: e.target.value })}
                        />
                      </div>
                    </div>
                    <datalist id={`sms-variables-${m.id}`}>
                      {smsVariableChoices(templateVariables.data ?? [], m.event, m.locale).map(
                        (name) => (
                          <option key={name} value={name} />
                        )
                      )}
                    </datalist>
                    <div className="space-y-2 border-t pt-3">
                      <p className="text-sm font-medium">
                        {providerFormText('variablePairs', locale)}
                      </p>
                      <p
                        id={`sms-variables-hint-${m.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        {text('variablesHint')}
                      </p>
                      {m.variables.map((v, vi) => (
                        <div
                          key={v.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                        >
                          <div className={`${recordEditorField} col-span-2 sm:col-span-1`}>
                            <Label htmlFor={`${id}-variable-${v.id}`}>{text('variable')}</Label>
                            <Input
                              id={`${id}-variable-${v.id}`}
                              dir="ltr"
                              aria-label={`${text('variable')} ${index + 1}.${vi + 1}`}
                              list={`sms-variables-${m.id}`}
                              aria-describedby={`sms-variables-hint-${m.id}`}
                              value={v.internal}
                              maxLength={255}
                              required
                              aria-required="true"
                              onChange={(e) =>
                                changeMapping(m.id, {
                                  variables: m.variables.map((entry) =>
                                    entry.id === v.id
                                      ? { ...entry, internal: e.target.value }
                                      : entry
                                  ),
                                })
                              }
                            />
                          </div>
                          <div className={recordEditorField}>
                            <Label htmlFor={`${id}-parameter-${v.id}`}>{text('parameter')}</Label>
                            <Input
                              id={`${id}-parameter-${v.id}`}
                              dir="ltr"
                              aria-label={`${text('parameter')} ${index + 1}.${vi + 1}`}
                              value={v.parameter}
                              maxLength={255}
                              required
                              aria-required="true"
                              onChange={(e) =>
                                changeMapping(m.id, {
                                  variables: m.variables.map((entry) =>
                                    entry.id === v.id
                                      ? { ...entry, parameter: e.target.value }
                                      : entry
                                  ),
                                })
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`${text('remove')} ${text('variable')} ${index + 1}.${vi + 1}`}
                            title={text('remove')}
                            onClick={() =>
                              changeMapping(m.id, {
                                variables: m.variables.filter((entry) => entry.id !== v.id),
                              })
                            }
                          >
                            <TableTrash2Icon aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          changeMapping(m.id, { variables: [...m.variables, variable()] })
                        }
                      >
                        <TablePlusIcon aria-hidden="true" />
                        {text('addVariable')}
                      </Button>
                    </div>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                {...(!editor.mappings.length ? { ...form.bind('mappings'), ref: mappingRef } : {})}
                onClick={() => field('mappings', [...editor.mappings, mapping()])}
              >
                {text('addMapping')}
              </Button>
            </RecordEditorSection>
            <StickyRecordEditorActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditor(null);
                  navigateEditor(
                    workspace && editSource ? { panel: 'detail', id: editSource.id } : undefined
                  );
                }}
              >
                {text('cancel')}
              </Button>
              <CatalogueSaveButton
                pending={form.pending}
                disabled={disabled || !eventsReady || staleEditor || uncertain}
                label={text('save')}
              />
            </StickyRecordEditorActions>
          </fieldset>
        </form>
      )}
      {testProvider && !editor && (!workspace || requestedPanel === 'preview') && (
        <section aria-labelledby="sms-preview-title" className={recordEditorSurface}>
          <div className="space-y-3 px-4 py-4 sm:px-6">
            <h2 id="sms-preview-title" className="text-base font-semibold">
              {text('preview')}: {testProvider.label}
            </h2>
            <div className={recordEditorField}>
              <Label htmlFor="sms-test-event">{text('firstEvent')}</Label>
              <NativeSelect
                id="sms-test-event"
                disabled={disabled}
                value={firstEvent}
                onChange={(e) => setFirstEvent(e.target.value)}
                className="w-full max-w-sm"
              >
                {[...new Set(testProvider.config.template_mappings.map((m) => m.event_key))].map(
                  (event) => (
                    <option key={event} value={event}>
                      {event}
                    </option>
                  )
                )}
              </NativeSelect>
            </div>
            <p className="text-sm text-muted-foreground">
              {text('testNotice').replace(
                '{count}',
                new Intl.NumberFormat(locale).format(testMappings.length)
              )}
            </p>
            {testMappings.map((m) => (
              <div
                key={`${m.event_key}:${m.locale ?? '*'}`}
                className="space-y-2 rounded-lg border bg-muted/35 p-3"
              >
                <h3 className="text-sm font-medium [overflow-wrap:anywhere]">
                  {m.event_key} · {m.template_id} ·{' '}
                  {text(
                    m.locale === 'fa' ? 'persian' : m.locale === 'en' ? 'english' : 'allLanguages'
                  )}
                </h3>
                <dl>
                  {buildSmsTestParameters(m.variables).map((p) => (
                    <div key={p.name} className="flex gap-4 font-mono" dir="ltr">
                      <dt>{p.name}</dt>
                      <dd>{p.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            <div className={recordEditorField}>
              <Label htmlFor="sms-test-recipient">{text('testRecipient')}</Label>
              <Input
                id="sms-test-recipient"
                dir="ltr"
                type="tel"
                autoComplete="off"
                maxLength={16}
                value={testRecipient}
                disabled={disabled}
                onChange={(event) =>
                  setTestContact({ basis: testContactBasis, value: event.target.value })
                }
              />
            </div>
          </div>
          <RecordEditorActions>
            <Button
              disabled={
                disabled ||
                !eventsReady ||
                testProvider.status !== 'draft' ||
                !testMappings.length ||
                !validTestRecipient
              }
              onClick={() => void test()}
            >
              {text('test')}
            </Button>
          </RecordEditorActions>
        </section>
      )}
    </section>
  );
}

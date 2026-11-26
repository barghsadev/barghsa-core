import {
  Ban as TableBanIcon,
  CheckCircle as TableCheckCircleIcon,
  Pencil as TablePencilIcon,
  RotateCcw as TableRotateCcwIcon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { FlaskConical } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useDestructiveConfirm } from '../hooks/useDestructiveConfirm.js';
import {
  providerDestination,
  providerSelectionKey,
  type ProviderSelection,
  type ProviderWorkspace,
} from '../lib/provider-workspace.js';
import {
  LoadingStatus,
  Button,
  Input,
  Label,
  NativeSelect,
  buttonVariants,
  DateCell,
  ListPage,
  TextCell,
  cn,
} from '@barghsa/ui';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import {
  useProviderCatalogue,
  providerBasis,
  useProviderCommandGuard,
  useProviderCommandRecovery,
} from '../hooks/useProviderCatalogue.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { DeliveryProviderDetail } from '../components/DeliveryProviderDetail.js';
import { DeliveryProviderTable } from '../components/DeliveryProviderTable.js';
import { ProviderHealthMetrics } from '../components/ProviderHealthMetrics.js';
import { ProviderAlertHistory } from '../components/ProviderAlertHistory.js';
import { providerText } from '@barghsa/i18n/providers';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { cloneElement, type FormEvent, type ReactElement } from 'react';
import { useWizardForm, type WizardFieldBinding } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import {
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
} from '../components/RecordEditorLayout.js';
import {
  StickyRecordEditorActions,
  keepRecordFieldVisible,
  recordEditorFormSurface,
} from '../components/StickyRecordEditorActions.js';
import { providerFormText } from '@barghsa/i18n/provider-forms';
import {
  emptyEmailDraft,
  savedForm,
  smtpConfig,
  smtpSubmissionPorts,
  resendConfig,
  emailInvalidFields,
  emailConfigFor,
  type EmailDraft,
  type SmtpForm,
  type ResendForm,
  type TransportForm,
} from '../lib/provider-form.js';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import {
  activateProvider,
  createProvider,
  disableProvider,
  listProviders,
  ProviderRequestError,
  ProviderStepUpError,
  validateProviderResult,
  validateConnectionResult,
  validateRestoredDraft,
  rollbackProvider,
  testConnection,
  updateProvider,
  type EmailProvider,
  type Status,
  type TestStatus,
  type Transport,
  type TestConnectionOutcome,
} from '../lib/email-providers-api.js';

// ---------------------------------------------------------------------------
// Types (mirror apps/api EmailProviderConfigResult + schemas)
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<Status, string> = {
  draft: 'bg-warning-soft text-warning',
  active: 'bg-success-soft text-success',
  superseded: 'bg-muted text-muted-foreground',
  disabled: 'bg-danger-soft text-destructive',
};

const TEST_COLORS: Record<TestStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  passed: 'bg-success-soft text-success',
  failed: 'bg-danger-soft text-destructive',
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transport-specific form state
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminEmailProvidersPage({
  embedded = false,
  workspace,
}: { embedded?: boolean; workspace?: ProviderWorkspace } = {}) {
  const Heading = embedded ? 'h2' : 'h1';
  const time = useAccountTime();
  const uiLocale = useLocale();
  const [invalidConfigRead, setInvalidConfigRead] = useState<number | null>(null);
  const [editBasis, setEditBasis] = useState<string | null>(null);
  const inFlight = useRef(false);
  const protectedDispatched = useRef(false);
  const [busy, setBusy] = useState(false);
  const [protectedAction, setProtectedAction] = useState<{
    action: TeamAction;
    basis: string;
    onSuccess: (result: unknown) => Promise<void>;
    kind: 'save' | 'test' | 'change';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const customPort = useRef(false);
  const address = useRef('');
  const requested = useRef({ key: '', restore: false });
  const onSelect = workspace?.set;
  const requestedPanel = workspace?.selection?.panel;
  const requestedId = workspace?.selection?.id;
  const [, setEditStatus] = useState<Status | null>(null);
  const [transport, setTransport] = useState<Transport>('smtp');
  const messages = Object.fromEntries(
    Object.keys(emptyEmailDraft()).map((key) => [
      key,
      providerFormText(
        key === 'password'
          ? 'passwordMessage'
          : key === 'apiKey'
            ? 'apiKeyMessage'
            : (key as Exclude<keyof EmailDraft, 'password' | 'apiKey'>),
        uiLocale
      ),
    ])
  ) as Record<keyof EmailDraft, string>;
  const editor = useWizardForm<EmailDraft>(
    async () => {
      const { providerFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return providerFormSchema(messages, (draft) =>
        emailInvalidFields(draft, transport, editId !== null)
      );
    },
    emptyEmailDraft,
    providerFormText('validationUnavailable', uiLocale)
  );
  const form = editor.values;
  const [label, setLabel] = editor.field('label');
  const generation = useRef(0);
  const fieldErrors = useActionFieldErrors(
    editor.form,
    messages,
    providerText('admin.providers.error.save', uiLocale)
  );

  // Per-row test outcome cache
  const [testOutcome, setTestOutcome] = useState<Record<string, TestConnectionOutcome>>({});
  const [testRecipients, setTestRecipients] = useState<
    Record<string, { basis: string; value: string }>
  >({});

  const resetForm = editor.form.reset;
  const clearPrivate = useCallback(() => {
    address.current = '';
    requested.current = { key: '', restore: false };
    setShowEditor(false);
    setEditId(null);
    setEditBasis(null);
    resetForm(emptyEmailDraft());
    generation.current++;
    inFlight.current = false;
    editor.setValidationPending(false);
    setTransport('smtp');
    setProtectedAction(null);
    setTestOutcome({});
    setTestRecipients({});
    setError(null);
    setNotice(null);
    setInvalidConfigRead(null);
    setBusy(false);
  }, [resetForm, editor.setValidationPending]);
  const scope = useCatalogueScope(clearPrivate);
  const confirmDestruction = useDestructiveConfirm(uiLocale, scope.version);
  const catalogue = useProviderCatalogue(scope, listProviders);
  const command = useProviderCommandRecovery(catalogue.ownerKey, catalogue);
  const previousOwner = useRef(catalogue.ownerKey);
  useEffect(() => {
    if (previousOwner.current === catalogue.ownerKey) return;
    previousOwner.current = catalogue.ownerKey;
    clearPrivate();
  }, [catalogue.ownerKey, clearPrivate]);
  const uncertain = command.pending === 'save';
  const providers = catalogue.data ?? [];
  useEffect(() => {
    const allowed = new Map(
      (catalogue.data ?? [])
        .filter((row) => row.status === 'draft')
        .map((row) => [row.id, recipientBasis(row)])
    );
    setTestRecipients((current) => {
      const retained = Object.entries(current).filter(
        ([id, draft]) => allowed.get(id) === draft.basis
      );
      return retained.length === Object.keys(current).length
        ? current
        : Object.fromEntries(retained);
    });
  }, [catalogue.data]);
  const loading = catalogue.loading;
  const loadFailed =
    catalogue.error || (invalidConfigRead !== null && invalidConfigRead === catalogue.readAttempt);
  const rowBasis = (p: EmailProvider, test = true) =>
    providerBasis({
      id: p.id,
      label: p.label,
      transport: p.transport,
      status: p.status,
      ...(test ? { lastTestStatus: p.lastTestStatus } : {}),
      maskedConfig: p.maskedConfig,
    });
  const basis = providerBasis(providers.map((p) => rowBasis(p)).sort());
  const capture = useProviderCommandGuard(basis, catalogue.ownerKey, scope.live);
  useEffect(() => setTestOutcome({}), [basis]);
  const staleEditor =
    editId !== null &&
    editBasis !==
      rowBasis(
        providers.find((p) => p.id === editId) ?? {
          id: '',
          label: '',
          transport: 'smtp',
          status: 'disabled',
          lastTestStatus: 'pending',
        },
        false
      );
  const fetchAll = catalogue.refresh;
  useEffect(() => {
    if (protectedAction && protectedAction.basis !== basis && !protectedDispatched.current)
      setProtectedAction(null);
  }, [basis, protectedAction]);
  const recover = async () => {
    if (scope.denied) return scope.recover();
    await fetchAll();
  };
  const recovery = (compact = false) => (
    <div className="space-y-2">
      <Button
        type="button"
        variant={compact ? 'ghost' : 'outline'}
        size={compact ? 'sm' : 'default'}
        disabled={loading || busy}
        onClick={recover}
      >
        {providerText(
          loadFailed || scope.denied ? 'admin.providers.retry' : 'admin.providers.refresh',
          uiLocale
        )}
      </Button>
    </div>
  );

  function resetRecovery() {
    generation.current++;
    inFlight.current = false;
    setBusy(false);
    command.reset();
    editor.setValidationPending(false);
  }
  function navigateEditor(selection: ProviderSelection | undefined, replace = false) {
    address.current = providerSelectionKey(selection);
    requested.current.restore = false;
    onSelect?.(selection, replace);
  }
  function openCreate(publish = true) {
    resetRecovery();
    customPort.current = false;
    setEditId(null);
    setEditBasis(null);
    setEditStatus(null);
    setLabel('');
    setTransport('smtp');
    editor.form.reset(emptyEmailDraft());
    setError(null);
    setNotice(null);
    setShowEditor(true);
    if (publish) navigateEditor({ panel: 'new' });
  }

  function openEdit(p: EmailProvider, publish = true) {
    // Superseded/disabled versions are read-only; only drafts may be edited.
    if (p.status !== 'draft') {
      setError(providerText('admin.providers.supersededNote', uiLocale));
      return false;
    }
    let saved: TransportForm;
    try {
      saved = savedForm(p);
    } catch {
      setInvalidConfigRead(catalogue.readAttempt);
      return false;
    }
    resetRecovery();
    setEditId(p.id);
    setEditBasis(rowBasis(p, false));
    setEditStatus(p.status);
    setTransport(p.transport);
    editor.form.reset({ ...emptyEmailDraft(), ...saved, label: p.label });
    setError(null);
    setNotice(null);
    setShowEditor(true);
    if (publish) navigateEditor({ panel: 'edit', id: p.id });
    return true;
  }

  function closeEditor(publish = true, replace = false) {
    resetRecovery();
    setShowEditor(false);
    editor.form.reset(emptyEmailDraft());
    setEditId(null);
    setEditBasis(null);
    setEditStatus(null);
    if (publish)
      navigateEditor(workspace && editId ? { panel: 'detail', id: editId } : undefined, replace);
  }

  useLayoutEffect(() => {
    if (!workspace || scope.denied) return;
    const selection = workspace.selection;
    const key = providerSelectionKey(selection);
    if (requested.current.key !== key) {
      const restore = address.current !== key;
      if (restore) {
        closeEditor(false);
        protectedDispatched.current = false;
        setProtectedAction(null);
      }
      requested.current = { key, restore };
    }
    if (!requested.current.restore) return;
    if (selection && (loading || loadFailed || !catalogue.data)) return;
    if (selection?.panel === 'new') openCreate(false);
    if (selection?.panel === 'edit') {
      const row = catalogue.data?.find((provider) => provider.id === selection.id);
      if (row?.status !== 'draft') setError(providerText('admin.providers.stale', uiLocale));
      else if (!openEdit(row, false)) return;
    }
    requested.current.restore = false;
    address.current = key;
  }, [requestedPanel, requestedId, scope.denied, loading, loadFailed, catalogue.data]);

  function handleTransportChange(next: Transport) {
    setTransport(next);
    // Reset the form when switching transports to avoid stale secret fields.
    generation.current++;
    customPort.current = false;
    editor.form.reset({ ...emptyEmailDraft(), label });
  }

  function setField(key: keyof EmailDraft, value: string) {
    if (key === 'port') customPort.current = true;
    editor.field(key)[1](value as EmailDraft[typeof key]);
    if (key === 'security' && !editId && !customPort.current)
      editor.field('port')[1](smtpSubmissionPorts[value as SmtpForm['security']]);
  }

  function offerStepUp(
    error: unknown,
    title: string,
    description: string,
    onSuccess: (result: unknown) => Promise<void>,
    kind: 'save' | 'test' | 'change'
  ): boolean {
    if (!(error instanceof ProviderStepUpError)) return false;
    setProtectedAction({
      basis,
      action: { ...error.action, title, description, requiresOtp: true, responseDeadline: true },
      onSuccess,
      kind,
    });
    return true;
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (
      inFlight.current ||
      editor.isPending() ||
      protectedAction ||
      busy ||
      loading ||
      loadFailed ||
      scope.denied ||
      staleEditor ||
      command.pending
    )
      return;
    inFlight.current = true;
    const ticket = ++generation.current;
    const guard = capture();
    const owned = () => ticket === generation.current && guard.owned();
    const current = () => owned() && guard.current();
    editor.setValidationPending(true);
    setBusy(true);
    setError(null);
    setNotice(null);
    const captured: { value?: EmailDraft } = {};
    try {
      await editor.form.handleSubmit((value) => {
        captured.value = value;
      })();
      if (!captured.value || !current() || loading || loadFailed || scope.denied || staleEditor)
        return;
      const draft = captured.value,
        id = editId,
        kind = transport;
      const config = emailConfigFor(
        draft,
        kind,
        providers.find((p) => p.id === id)
      );
      const accept = async (result: unknown) => {
        if (!current()) throw new ProviderRequestError(false, [], true);
        let savedId: string;
        try {
          const saved = validateProviderResult(result, 'draft', id ?? undefined);
          savedId = saved.id;
          if (saved.transport !== kind || saved.label !== draft.label.trim())
            throw new ProviderRequestError();
          const savedDraft = savedForm(saved);
          const publicConfig =
            kind === 'smtp'
              ? smtpConfig(savedDraft as SmtpForm)
              : resendConfig(savedDraft as ResendForm);
          for (const [key, value] of Object.entries(config)) {
            if (
              !['password', 'api_key'].includes(key) &&
              publicConfig[key] !== (value === null ? undefined : value)
            )
              throw new ProviderRequestError();
          }
        } catch {
          throw new ProviderRequestError(false, [], true);
        }
        setTestOutcome({});
        await fetchAll();
        if (!owned()) return;
        closeEditor(!workspace, true);
        if (workspace) navigateEditor({ panel: 'detail', id: savedId }, true);
        setNotice(providerFormText('saved', uiLocale));
      };
      try {
        const result = id
          ? await updateProvider(id, { label: draft.label.trim(), config })
          : await createProvider(kind, draft.label.trim(), config);
        await accept(result);
      } catch (err) {
        if (!owned()) return;
        if (err instanceof ProviderRequestError && err.denied) {
          scope.deny();
          return;
        }
        if (!current() || (err instanceof ProviderRequestError && err.uncertain)) {
          command.mark('save');
          setError(providerText('admin.providers.error.save', uiLocale));
          return;
        }
        if (err instanceof ProviderRequestError && fieldErrors(err.fields)) return;
        if (
          offerStepUp(
            err,
            providerText(
              id ? 'admin.providers.update.title' : 'admin.providers.create.title',
              uiLocale
            ),
            draft.label.trim(),
            accept,
            'save'
          )
        )
          return;
        setError(providerText('admin.providers.error.save', uiLocale));
      }
    } finally {
      if (ticket === generation.current) {
        inFlight.current = false;
        setBusy(false);
        editor.setValidationPending(false);
      }
    }
  }

  const actionsDisabled =
    busy || loading || loadFailed || scope.denied || !!protectedAction || !!command.pending;

  async function runProviderAction(
    p: EmailProvider,
    ...[operation, recipient]: ['test', string] | ['activate' | 'disable' | 'rollback']
  ) {
    if (inFlight.current || actionsDisabled) return;
    inFlight.current = true;
    const ticket = ++generation.current;
    const guard = capture();
    const owned = () => ticket === generation.current && guard.owned();
    const current = () => owned() && guard.current();
    const kind = operation === 'test' ? 'test' : 'change';
    const title = providerText(
      operation === 'test' ? 'admin.providers.test.run' : `admin.providers.${operation}`,
      uiLocale
    );
    setBusy(true);
    setError(null);
    setNotice(null);
    const accept = async (result: unknown, validatedTest?: TestConnectionOutcome) => {
      if (!current()) throw new ProviderRequestError(false, [], true);
      let restoredId: string | undefined;
      if (operation === 'test') {
        const outcome = validatedTest ?? validateConnectionResult(result, p.id);
        setTestOutcome((prev) => ({ ...prev, [p.id]: outcome }));
      } else {
        if (operation === 'rollback') restoredId = validateRestoredDraft(result, p.id).id;
        else validateProviderResult(result, operation === 'disable' ? 'disabled' : 'active', p.id);
        setNotice(
          providerFormText(
            operation === 'activate'
              ? 'activated'
              : operation === 'disable'
                ? 'disabled'
                : 'rolledBack',
            uiLocale
          )
        );
      }
      await fetchAll();
      if (restoredId && workspace && owned())
        navigateEditor({ panel: 'detail', id: restoredId }, true);
    };
    try {
      if (
        (operation === 'disable' || operation === 'rollback') &&
        (!(await confirmDestruction(
          title,
          providerText(`admin.providers.${operation}Confirm`, uiLocale)
        )) ||
          !current())
      )
        return;
      if (operation === 'test') await accept(null, await testConnection(p.id, recipient));
      else {
        const send = {
          activate: activateProvider,
          disable: disableProvider,
          rollback: rollbackProvider,
        };
        await accept(await send[operation](p.id));
      }
    } catch (err) {
      if (!owned()) return;
      if (err instanceof ProviderRequestError && err.denied) {
        scope.deny();
        return;
      }
      if (!current() || (err instanceof ProviderRequestError && err.uncertain)) {
        command.mark(kind);
        return;
      }
      if (offerStepUp(err, title, p.label, accept, kind)) return;
      if (operation === 'test') {
        setTestOutcome((prev) => ({
          ...prev,
          [p.id]: { ok: false, error: providerText('admin.providers.error.test', uiLocale) },
        }));
      } else setError(providerText(`admin.providers.error.${operation}`, uiLocale));
    } finally {
      if (ticket === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  const activeCount = providers.filter((p) => p.status === 'active').length;
  const onlyActive = activeCount === 1;

  function activeProviderIsRisky(p: EmailProvider): boolean {
    return p.status === 'active' && onlyActive;
  }

  function lastTestLabel(p: EmailProvider): string {
    if (p.lastTestStatus === 'passed') return providerText('admin.providers.test.passed', uiLocale);
    if (p.lastTestStatus === 'failed') return providerText('admin.providers.test.failed', uiLocale);
    return providerText('admin.providers.test.pending', uiLocale);
  }

  function healthLabel(p: EmailProvider): string {
    if (!p.degraded) return providerText('admin.providers.health.healthy', uiLocale);
    if (p.degradedReason === 'provider_configuration_pause')
      return providerText('admin.providers.health.configuration', uiLocale);
    if (p.breakerCooldownUntil && Date.parse(p.breakerCooldownUntil) > Date.now())
      return `${providerText('admin.providers.health.paused', uiLocale)} ${time.format(p.breakerCooldownUntil)}`;
    return providerText('admin.providers.health.probe', uiLocale);
  }

  const providerFields = [
    {
      id: 'transport',
      label: providerText('admin.providers.col.transport', uiLocale),
      render: (p: EmailProvider) => (
        <>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {providerText(`admin.providers.transport.${p.transport}`, uiLocale)}
          </span>
        </>
      ),
    },
    {
      id: 'status',
      label: providerText('admin.providers.col.status', uiLocale),
      render: (p: EmailProvider) => (
        <>
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status]}`}
          >
            {providerText(`admin.providers.status.${p.status}`, uiLocale)}
          </span>
          {p.status === 'superseded' && (
            <p className="text-xs text-muted-foreground mt-1">
              {providerText('admin.providers.supersededNote', uiLocale)}
            </p>
          )}
          {p.status === 'active' && (
            <>
              <p
                className={`mt-1 text-xs ${p.degraded ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {healthLabel(p)}
              </p>
              {p.degraded && p.lastFailureAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {providerText('admin.providers.health.lastFailure', uiLocale)}:{' '}
                  <DateCell value={p.lastFailureAt} format={(value) => time.format(value)} />
                </p>
              )}
            </>
          )}
          <ProviderHealthMetrics metrics={p.healthMetrics} active={p.status === 'active'} />
          <ProviderAlertHistory events={p.alertHistory} />
        </>
      ),
    },
    {
      id: 'test',
      label: providerText('admin.providers.col.test', uiLocale),
      render: (p: EmailProvider) => (
        <>
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TEST_COLORS[p.lastTestStatus]}`}
          >
            {lastTestLabel(p)}
          </span>
          {p.lastTestAt && (
            <p className="text-xs text-muted-foreground mt-1">
              <DateCell value={p.lastTestAt} format={(value) => time.format(value)} />
            </p>
          )}
          {p.lastTestError && (
            <p className="text-xs text-destructive mt-1" title={p.lastTestError}>
              <TextCell value={p.lastTestError} />
            </p>
          )}
          {(() => {
            const outcome = testOutcome[p.id];
            if (outcome) {
              return (
                <p className={`text-xs mt-1 ${outcome.ok ? 'text-success' : 'text-destructive'}`}>
                  {outcome.ok
                    ? providerText('admin.providers.test.passed', uiLocale)
                    : outcome.error || providerText('admin.providers.test.failed', uiLocale)}
                </p>
              );
            }
            return null;
          })()}
        </>
      ),
    },
    {
      id: 'activated',
      label: providerText('admin.providers.col.activated', uiLocale),
      render: (p: EmailProvider) => (
        <>
          <DateCell value={p.activatedAt} format={(value) => time.format(value)} />
          {p.activatedAt && p.activatedBy && (
            <p className="text-xs text-muted-foreground mt-1">
              {providerText('admin.providers.meta.activatedBy', uiLocale)}:{' '}
              <TextCell value={p.activatedBy} />
            </p>
          )}
        </>
      ),
    },
  ];
  const providerActions = (p: EmailProvider) => {
    const risky = activeProviderIsRisky(p);
    const recipient = testRecipients[p.id];
    return (
      <div className="space-y-1">
        {/* Draft row actions */}
        {p.status === 'draft' && (
          <>
            {workspace && !actionsDisabled ? (
              <Link
                {...providerDestination('email', { panel: 'edit', id: p.id })}
                className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                data-table-action-tooltip={providerText('admin.providers.update.title', uiLocale)}
              >
                <TableActionIcon icon={TablePencilIcon}>
                  {providerText('admin.providers.update.title', uiLocale)}
                </TableActionIcon>
              </Link>
            ) : (
              <button
                onClick={() => openEdit(p)}
                disabled={actionsDisabled}
                className="px-3 py-1 border border-input rounded text-xs hover:bg-muted disabled:opacity-50 w-full text-start"
                data-table-action-tooltip={providerText('admin.providers.update', uiLocale)}
              >
                <TableActionIcon icon={TablePencilIcon}>
                  {providerText('admin.providers.update', uiLocale)}
                </TableActionIcon>
              </button>
            )}
            <EmailTestRow
              provider={p}
              recipient={recipient?.basis === recipientBasis(p) ? recipient.value : ''}
              setRecipient={(value) =>
                setTestRecipients((current) => ({
                  ...current,
                  [p.id]: { basis: recipientBasis(p), value },
                }))
              }
              onTest={(provider, recipient) => runProviderAction(provider, 'test', recipient)}
              busy={busy}
              disabled={actionsDisabled}
            />
            <button
              onClick={() => runProviderAction(p, 'activate')}
              disabled={actionsDisabled || p.lastTestStatus !== 'passed'}
              data-table-action-tooltip={
                p.lastTestStatus !== 'passed'
                  ? providerText('admin.providers.activateHint', uiLocale)
                  : providerText('admin.providers.activate', uiLocale)
              }
              className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs hover:shadow-md disabled:opacity-40 w-full text-start pointer-coarse:min-h-[45px]!"
            >
              <TableActionIcon icon={TableCheckCircleIcon}>
                {providerText('admin.providers.activate', uiLocale)}
              </TableActionIcon>
            </button>
          </>
        )}

        {p.status === 'active' && (
          <>
            {risky && (
              <div className="bg-warning-soft border border-warning/20 text-warning px-2 py-1.5 rounded text-xs mb-2">
                {providerText('admin.providers.disableWarn', uiLocale)}
              </div>
            )}
            <button
              onClick={() => runProviderAction(p, 'disable')}
              disabled={actionsDisabled}
              className="px-3 py-1 border border-destructive/20 text-destructive rounded text-xs hover:bg-danger-soft-hover disabled:opacity-50 w-full text-start"
              data-table-action-tooltip={providerText('admin.providers.disable', uiLocale)}
            >
              <TableActionIcon icon={TableBanIcon}>
                {providerText('admin.providers.disable', uiLocale)}
              </TableActionIcon>
            </button>
          </>
        )}

        {(p.status === 'superseded' || p.status === 'disabled') && (
          <button
            onClick={() => runProviderAction(p, 'rollback')}
            disabled={actionsDisabled}
            className="px-3 py-1 border border-input rounded text-xs hover:bg-muted disabled:opacity-50 w-full text-start"
            data-table-action-tooltip={providerText('admin.providers.rollback', uiLocale)}
          >
            <TableActionIcon icon={TableRotateCcwIcon}>
              {providerText('admin.providers.rollback', uiLocale)}
            </TableActionIcon>
          </button>
        )}
      </div>
    );
  };

  const showingRecord = workspace?.selection !== undefined;
  const detail =
    requestedPanel === 'detail' && providers.find((provider) => provider.id === requestedId);
  const failed = loadFailed || scope.denied;

  return (
    <div className="min-w-0 space-y-6" dir={uiLocale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      {!showingRecord && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Heading className="text-xl font-semibold">
              {providerText('admin.providers.title', uiLocale)}
            </Heading>
            <p className="text-sm text-muted-foreground mt-1">
              {providerText('admin.providers.subtitle', uiLocale)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {providerText('admin.providers.test.notice', uiLocale)}
            </p>
          </div>
          {workspace && !actionsDisabled ? (
            <Link
              {...providerDestination('email', { panel: 'new' })}
              className={buttonVariants({ className: 'min-h-11' })}
            >
              {providerText('admin.providers.new', uiLocale)}
            </Link>
          ) : (
            !showEditor && (
              <Button onClick={() => openCreate()} disabled={actionsDisabled}>
                {providerText('admin.providers.new', uiLocale)}
              </Button>
            )
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="bg-danger-soft border border-destructive/20 text-destructive px-4 py-3 rounded relative"
        >
          {error}
          <button
            onClick={() => setError(null)}
            className="absolute top-2 end-2 text-destructive hover:underline"
            aria-label={t('admin.notifications.dismissError', uiLocale)}
          >
            ✕
          </button>
        </div>
      )}

      <CommandFeedback message={notice} />
      {command.pending && command.pending !== 'save' && (
        <div className="space-y-2">
          <p role="alert">
            {providerFormText(
              command.pending === 'test' ? 'testUnconfirmed' : 'changeUnconfirmed',
              uiLocale
            )}
          </p>
          <Button
            variant="outline"
            disabled={!command.canReview || !!protectedAction}
            onClick={command.reset}
          >
            {providerFormText(command.pending === 'test' ? 'reviewTest' : 'reviewChange', uiLocale)}
          </Button>
        </div>
      )}

      {showingRecord && !failed && recovery(true)}

      {/* Editor */}
      {showEditor && (
        <form
          noValidate
          onSubmit={handleSave}
          onFocus={keepRecordFieldVisible}
          aria-label={providerText(
            editId ? 'admin.providers.update.title' : 'admin.providers.create.title',
            uiLocale
          )}
          className={recordEditorFormSurface}
        >
          {(staleEditor || uncertain || catalogueRootMessage(editor.errors)) && (
            <div className="space-y-2 border-b bg-muted/35 px-4 py-3 sm:px-6">
              {staleEditor && <p role="alert">{providerText('admin.providers.stale', uiLocale)}</p>}
              {uncertain && <p role="alert">{providerFormText('uncertain', uiLocale)}</p>}
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
                    const row = providers.find((p) => p.id === editId);
                    if (row?.status === 'draft') openEdit(row);
                    else if (editId) closeEditor();
                    else openCreate();
                  }}
                >
                  {providerFormText('reset', uiLocale)}
                </Button>
              )}
              {catalogueRootMessage(editor.errors) && (
                <p role="alert">{catalogueRootMessage(editor.errors)}</p>
              )}
            </div>
          )}
          <fieldset
            disabled={
              busy ||
              editor.pending ||
              !!protectedAction ||
              staleEditor ||
              uncertain ||
              scope.denied
            }
            className="min-w-0"
          >
            <legend className="sr-only">
              {editId
                ? providerText('admin.providers.update.title', uiLocale)
                : providerText('admin.providers.create.title', uiLocale)}
            </legend>

            <RecordEditorSection title={providerFormText('providerDetails', uiLocale)}>
              <div className={recordEditorGrid}>
                <div className={recordEditorField}>
                  <Label htmlFor="email-provider-label">
                    {providerText('admin.providers.label', uiLocale)}{' '}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </Label>
                  <Input
                    {...editor.bind('label')}
                    type="text"
                    id="email-provider-label"
                    dir="auto"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="w-full"
                    required
                    aria-required="true"
                  />
                  {editor.errors.label && (
                    <p
                      id={editor.errorId('label')}
                      role="alert"
                      className="text-sm text-destructive"
                    >
                      {editor.errors.label.message}
                    </p>
                  )}
                </div>

                <div className={recordEditorField}>
                  <Label htmlFor="email-provider-transport">
                    {providerText('admin.providers.transport', uiLocale)}{' '}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </Label>
                  <NativeSelect
                    id="email-provider-transport"
                    aria-required="true"
                    value={transport}
                    onChange={(e) => handleTransportChange(e.target.value as Transport)}
                    className="w-full"
                    disabled={editId !== null}
                  >
                    <option value="smtp">SMTP</option>
                    <option value="resend">Resend</option>
                  </NativeSelect>
                </div>
              </div>
            </RecordEditorSection>
            {transport === 'smtp' ? (
              <SmtpFields
                form={form}
                setField={setField}
                editing={editId !== null}
                feedback={editor}
              />
            ) : (
              <ResendFields
                form={form as ResendForm}
                setField={setField}
                editing={editId !== null}
                feedback={editor}
              />
            )}

            <StickyRecordEditorActions>
              <Button
                variant="outline"
                type="button"
                onClick={() => closeEditor()}
                disabled={busy || !!protectedAction || uncertain}
              >
                {providerText('admin.providers.cancel', uiLocale)}
              </Button>
              <CatalogueSaveButton
                pending={editor.pending}
                disabled={
                  busy ||
                  loading ||
                  loadFailed ||
                  scope.denied ||
                  !!protectedAction ||
                  staleEditor ||
                  uncertain
                }
                label={providerText(
                  editId ? 'admin.providers.update' : 'admin.providers.create',
                  uiLocale
                )}
              />
            </StickyRecordEditorActions>
          </fieldset>
        </form>
      )}

      {protectedAction && (
        <TeamActionDialog
          action={protectedAction.action}
          onSuccess={protectedAction.onSuccess}
          {...(protectedAction.kind === 'save' ? { onValidationError: fieldErrors } : {})}
          confirmationDisabled={
            !!command.pending ||
            loading ||
            loadFailed ||
            scope.denied ||
            staleEditor ||
            protectedAction.basis !== basis
          }
          summary={
            <>
              {(loadFailed || scope.denied) && (
                <p role="alert">
                  {providerText(
                    scope.denied ? 'admin.providers.denied' : 'admin.providers.error.load',
                    uiLocale
                  )}
                </p>
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
          onClose={() => {
            protectedDispatched.current = false;
            setProtectedAction(null);
          }}
        />
      )}

      {showingRecord && loading && (
        <LoadingStatus>{providerText('admin.providers.loading', uiLocale)}</LoadingStatus>
      )}
      {showingRecord && failed && (
        <div role="alert" className="space-y-2">
          {providerText(
            scope.denied ? 'admin.providers.denied' : 'admin.providers.error.load',
            uiLocale
          )}
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
          <p role="alert">{providerText('admin.providers.missing', uiLocale)}</p>
        ))}
      {!showingRecord && (
        <ListPage>
          <ListPage.Toolbar>{!loadFailed && !scope.denied && recovery()}</ListPage.Toolbar>
          <ListPage.Content
            loading={loading}
            error={loadFailed || scope.denied}
            empty={false}
            emptyView={null}
            retainContent={catalogue.data !== null}
            loadingView={
              <LoadingStatus>{providerText('admin.providers.loading', uiLocale)}</LoadingStatus>
            }
            errorView={
              <div role="alert" className="space-y-2">
                {providerText(
                  scope.denied ? 'admin.providers.denied' : 'admin.providers.error.load',
                  uiLocale
                )}
                {recovery()}
              </div>
            }
          >
            <DeliveryProviderTable
              rows={providers}
              caption={providerText('admin.providers.title', uiLocale)}
              scrollLabel={providerText('admin.providers.table', uiLocale)}
              labelHeader={providerText('admin.providers.col.label', uiLocale)}
              actionHeader={providerText('admin.providers.col.actions', uiLocale)}
              fields={providerFields}
              {...(workspace
                ? {
                    renderLabel: (p: EmailProvider) => (
                      <Link
                        {...providerDestination('email', { panel: 'detail', id: p.id })}
                        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                      >
                        <TextCell value={p.label} />
                      </Link>
                    ),
                  }
                : { renderActions: providerActions })}
              loading={loading}
              emptyMessage={
                loading || loadFailed || scope.denied
                  ? ''
                  : providerText('admin.providers.empty', uiLocale)
              }
              tableClassName="min-w-[64rem]"
            />
          </ListPage.Content>
        </ListPage>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Smtp fields
// ---------------------------------------------------------------------------

function SmtpFields({
  form,
  setField,
  editing,
  feedback,
}: {
  form: SmtpForm;
  setField: (k: keyof EmailDraft, v: string) => void;
  editing: boolean;
  feedback: ReturnType<typeof useWizardForm<EmailDraft>>;
}) {
  const uiLocale = useLocale();
  const set = (k: keyof SmtpForm, v: string) => setField(k, v);
  const sec = (k: string) => providerText(`admin.providers.field.${k}`, uiLocale);
  const standardPort = smtpSubmissionPorts[form.security];
  return (
    <>
      <RecordEditorSection title={providerFormText('connection', uiLocale)}>
        <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_10rem_7rem] sm:gap-x-5">
          <Field
            binding={feedback.bind('host')}
            error={feedback.errors.host?.message}
            errorId={feedback.errorId('host')}
            label={sec('host')}
            className="col-span-2 sm:col-span-1"
            required
          >
            <Input
              type="text"
              dir="ltr"
              placeholder="smtp.example.com"
              value={form.host}
              onChange={(e) => set('host', e.target.value)}
            />
          </Field>
          <Field
            binding={feedback.bind('security')}
            error={feedback.errors.security?.message}
            errorId={feedback.errorId('security')}
            label={sec('security')}
          >
            <NativeSelect
              className="w-full"
              value={form.security}
              onChange={(e) => set('security', e.target.value)}
            >
              <option value="STARTTLS">STARTTLS</option>
              <option value="TLS">TLS</option>
            </NativeSelect>
          </Field>
          <div className="min-w-0">
            <Field
              binding={feedback.bind('port')}
              error={feedback.errors.port?.message}
              errorId={feedback.errorId('port')}
              label={sec('port')}
              required
            >
              <Input
                type="number"
                dir="ltr"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set('port', e.target.value)}
              />
            </Field>
            {form.port !== standardPort && !feedback.errors.port && (
              <button
                type="button"
                className="mt-1 min-h-6 text-start text-xs font-medium text-primary underline underline-offset-4 hover:text-primary/80"
                onClick={() => set('port', standardPort)}
              >
                {providerFormText('usePort', uiLocale).replace('{port}', standardPort)}
              </button>
            )}
          </div>
        </div>
      </RecordEditorSection>
      <RecordEditorSection title={providerFormText('credentials', uiLocale)}>
        <div className={recordEditorGrid}>
          <Field
            binding={feedback.bind('username')}
            error={feedback.errors.username?.message}
            errorId={feedback.errorId('username')}
            label={sec('username')}
          >
            <Input
              type="text"
              dir="ltr"
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
            />
          </Field>
          <Field
            binding={feedback.bind('password')}
            error={feedback.errors.password?.message}
            errorId={feedback.errorId('password')}
            label={sec('password')}
            description={editing ? providerFormText('keepCredential', uiLocale) : undefined}
          >
            <Input
              type="password"
              dir="ltr"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>
      </RecordEditorSection>
      <RecordEditorSection title={providerFormText('senderDetails', uiLocale)}>
        <div className={recordEditorGrid}>
          <Field
            binding={feedback.bind('fromName')}
            error={feedback.errors.fromName?.message}
            errorId={feedback.errorId('fromName')}
            label={sec('fromName')}
          >
            <Input
              type="text"
              dir="auto"
              value={form.fromName}
              onChange={(e) => set('fromName', e.target.value)}
            />
          </Field>
          <Field
            binding={feedback.bind('fromEmail')}
            error={feedback.errors.fromEmail?.message}
            errorId={feedback.errorId('fromEmail')}
            label={sec('fromEmail')}
            required
          >
            <Input
              type="email"
              dir="ltr"
              value={form.fromEmail}
              onChange={(e) => set('fromEmail', e.target.value)}
            />
          </Field>
          <Field
            binding={feedback.bind('replyTo')}
            error={feedback.errors.replyTo?.message}
            errorId={feedback.errorId('replyTo')}
            label={sec('replyTo')}
          >
            <Input
              type="email"
              dir="ltr"
              value={form.replyTo}
              onChange={(e) => set('replyTo', e.target.value)}
            />
          </Field>
        </div>
      </RecordEditorSection>
      <RecordEditorSection title={providerFormText('timeouts', uiLocale)}>
        <div className="grid max-w-sm grid-cols-2 gap-x-3 gap-y-2 sm:gap-x-5">
          {(['connectionTimeout', 'commandTimeout'] as const).map((key) => (
            <Field
              key={key}
              binding={feedback.bind(key)}
              error={feedback.errors[key]?.message}
              errorId={feedback.errorId(key)}
              label={sec(key)}
              required
            >
              <Input
                type="number"
                min={1}
                max={600}
                step={1}
                required
                dir="ltr"
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
              />
            </Field>
          ))}
        </div>
      </RecordEditorSection>
    </>
  );
}

function ResendFields({
  form,
  setField,
  editing,
  feedback,
}: {
  form: ResendForm;
  setField: (k: keyof EmailDraft, v: string) => void;
  editing: boolean;
  feedback: ReturnType<typeof useWizardForm<EmailDraft>>;
}) {
  const uiLocale = useLocale();
  const set = (k: keyof ResendForm, v: string) => setField(k, v);
  const sec = (k: string) => providerText(`admin.providers.field.${k}`, uiLocale);
  return (
    <>
      <RecordEditorSection title={providerFormText('credentials', uiLocale)}>
        <div className={recordEditorGrid}>
          <Field
            binding={feedback.bind('apiKey')}
            error={feedback.errors.apiKey?.message}
            errorId={feedback.errorId('apiKey')}
            label={sec('apiKey')}
            required={!editing}
            description={editing ? providerFormText('keepCredential', uiLocale) : undefined}
          >
            <Input
              type="password"
              dir="ltr"
              value={form.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>
      </RecordEditorSection>
      <RecordEditorSection title={providerFormText('senderDetails', uiLocale)}>
        <div className={recordEditorGrid}>
          <Field
            binding={feedback.bind('fromName')}
            error={feedback.errors.fromName?.message}
            errorId={feedback.errorId('fromName')}
            label={sec('fromName')}
          >
            <Input
              type="text"
              dir="auto"
              value={form.fromName}
              onChange={(e) => set('fromName', e.target.value)}
            />
          </Field>
          <Field
            binding={feedback.bind('fromEmail')}
            error={feedback.errors.fromEmail?.message}
            errorId={feedback.errorId('fromEmail')}
            label={sec('fromEmail')}
            required
          >
            <Input
              type="email"
              dir="ltr"
              value={form.fromEmail}
              onChange={(e) => set('fromEmail', e.target.value)}
            />
          </Field>
          <Field
            binding={feedback.bind('replyTo')}
            error={feedback.errors.replyTo?.message}
            errorId={feedback.errorId('replyTo')}
            label={sec('replyTo')}
          >
            <Input
              type="email"
              dir="ltr"
              value={form.replyTo}
              onChange={(e) => set('replyTo', e.target.value)}
            />
          </Field>
          <Field
            binding={feedback.bind('sendingDomain')}
            error={feedback.errors.sendingDomain?.message}
            errorId={feedback.errorId('sendingDomain')}
            label={sec('sendingDomain')}
          >
            <Input
              type="text"
              dir="ltr"
              value={form.sendingDomain}
              onChange={(e) => set('sendingDomain', e.target.value)}
            />
          </Field>
        </div>
      </RecordEditorSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// Email self-test row (requires the verified recipient shown before sending)
// ---------------------------------------------------------------------------

function recipientBasis(provider: EmailProvider) {
  return providerBasis([
    provider.id,
    provider.label,
    provider.transport,
    provider.status,
    provider.maskedConfig,
  ]);
}

function EmailTestRow({
  provider,
  onTest,
  busy,
  disabled,
  recipient,
  setRecipient,
}: {
  provider: EmailProvider;
  onTest: (p: EmailProvider, recipient: string) => void;
  busy: boolean;
  disabled: boolean;
  recipient: string;
  setRecipient: (value: string) => void;
}) {
  const uiLocale = useLocale();

  return (
    <div className="space-y-1">
      <input
        type="email"
        value={recipient}
        maxLength={320}
        disabled={disabled}
        onChange={(e) => setRecipient(e.target.value)}
        aria-label={providerText('admin.providers.test.recipient', uiLocale)}
        placeholder={providerText('admin.providers.test.recipient', uiLocale)}
        className="w-full border border-input rounded px-2 py-1 text-xs pointer-coarse:text-base"
      />
      <button
        onClick={() => onTest(provider, recipient.trim())}
        disabled={disabled || !recipient.trim()}
        data-table-action-tooltip={providerText('admin.providers.test.run', uiLocale)}
        className="px-3 py-1 border border-input rounded text-xs hover:bg-muted disabled:opacity-50 w-full text-start"
      >
        <TableActionIcon icon={FlaskConical}>
          {busy ? (
            providerText('admin.providers.test.running', uiLocale)
          ) : (
            <>
              {providerText('admin.providers.test.run', uiLocale)}
              {recipient.trim() && (
                <>
                  {' '}
                  · <bdi dir="ltr">{recipient.trim()}</bdi>
                </>
              )}
            </>
          )}
        </TableActionIcon>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

function Field({
  label,
  required,
  children,
  binding,
  error,
  errorId,
  description,
  className,
}: {
  label: string;
  required?: boolean;
  children: ReactElement<Record<string, unknown>>;
  binding: WizardFieldBinding;
  error?: string | undefined;
  errorId: string;
  description?: string | undefined;
  className?: string;
}) {
  const id = `email-provider-${binding.name}`;
  const descriptionId = description ? `${id}-hint` : undefined;
  return (
    <div className={cn(recordEditorField, className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="text-destructive">
            {' '}
            *
          </span>
        )}
      </Label>
      {cloneElement(children, {
        ...binding,
        id,
        required: required || undefined,
        'aria-required': required || undefined,
        'aria-describedby':
          [binding['aria-describedby'], descriptionId].filter(Boolean).join(' ') || undefined,
      })}
      {error && (
        <span id={errorId} role="alert" className="block text-sm text-destructive">
          {error}
        </span>
      )}
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

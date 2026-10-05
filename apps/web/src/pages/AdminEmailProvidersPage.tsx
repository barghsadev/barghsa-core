import { Button, DateCell, ListPage, TextCell } from '@barghsa/ui';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import {
  useProviderCatalogue,
  providerBasis,
  useProviderCommandGuard,
} from '../hooks/useProviderCatalogue.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { DeliveryProviderTable } from '../components/DeliveryProviderTable.js';
import { ProviderHealthMetrics } from '../components/ProviderHealthMetrics.js';
import { ProviderAlertHistory } from '../components/ProviderAlertHistory.js';
import { providerText } from '@barghsa/i18n/providers';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { cloneElement, type FormEvent, type ReactElement } from 'react';
import { useWizardForm, type WizardFieldBinding } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { providerFormText } from '@barghsa/i18n/provider-forms';
import {
  emptyEmailDraft,
  savedForm,
  smtpConfig,
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

export default function AdminEmailProvidersPage() {
  const time = useAccountTime();
  const uiLocale = useLocale();
  const [invalidConfig, setInvalidConfig] = useState(false);
  const [editBasis, setEditBasis] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [protectedAction, setProtectedAction] = useState<{
    action: TeamAction;
    basis: string;
    onSuccess: (result: unknown) => Promise<void>;
    save?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
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
  const [uncertain, setUncertain] = useState(false);
  const [recovered, setRecovered] = useState(false);
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
    setShowEditor(false);
    setEditId(null);
    setEditBasis(null);
    resetForm(emptyEmailDraft());
    generation.current++;
    inFlight.current = false;
    editor.setValidationPending(false);
    setUncertain(false);
    setRecovered(false);
    setTransport('smtp');
    setProtectedAction(null);
    setTestOutcome({});
    setTestRecipients({});
    setError(null);
    setNotice(null);
    setInvalidConfig(false);
    setBusy(false);
  }, [resetForm, editor.setValidationPending]);
  const scope = useCatalogueScope(clearPrivate);
  const catalogue = useProviderCatalogue(scope, listProviders);
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
  const loadFailed = catalogue.error || invalidConfig;
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
  const capture = useProviderCommandGuard(basis, scope.live);
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
  const fetchAll = useCallback(async () => {
    setInvalidConfig(false);
    await catalogue.refresh();
  }, [catalogue.refresh]);
  useEffect(() => {
    if (protectedAction && protectedAction.basis !== basis) setProtectedAction(null);
    if (!inFlight.current) setBusy(false);
  }, [basis, protectedAction]);
  const recover = async () => {
    if (scope.denied) return scope.recover();
    await fetchAll();
    if (!inFlight.current) setRecovered(true);
  };
  const recovery = (
    <div className="space-y-2">
      <Button type="button" variant="outline" disabled={loading || busy} onClick={recover}>
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
    setUncertain(false);
    setRecovered(false);
    editor.setValidationPending(false);
  }
  function openCreate() {
    resetRecovery();
    setEditId(null);
    setEditBasis(null);
    setEditStatus(null);
    setLabel('');
    setTransport('smtp');
    editor.form.reset(emptyEmailDraft());
    setError(null);
    setNotice(null);
    setShowEditor(true);
  }

  function openEdit(p: EmailProvider) {
    // Superseded/disabled versions are read-only; only drafts may be edited.
    if (p.status !== 'draft') {
      setError(providerText('admin.providers.supersededNote', uiLocale));
      return;
    }
    let saved: TransportForm;
    try {
      saved = savedForm(p);
    } catch {
      setInvalidConfig(true);
      return;
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
  }

  function closeEditor() {
    resetRecovery();
    setShowEditor(false);
    editor.form.reset(emptyEmailDraft());
    setEditId(null);
    setEditBasis(null);
    setEditStatus(null);
  }

  function handleTransportChange(next: Transport) {
    setTransport(next);
    // Reset the form when switching transports to avoid stale secret fields.
    generation.current++;
    editor.form.reset({ ...emptyEmailDraft(), label });
  }

  function setField(key: keyof EmailDraft, value: string) {
    editor.field(key)[1](value as EmailDraft[typeof key]);
  }

  function offerStepUp(
    error: unknown,
    title: string,
    description: string,
    onSuccess: (result: unknown) => Promise<void>,
    save = false
  ): boolean {
    if (!(error instanceof ProviderStepUpError)) return false;
    setProtectedAction({
      basis,
      action: { ...error.action, title, description, requiresOtp: true },
      onSuccess,
      save,
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
      uncertain
    )
      return;
    inFlight.current = true;
    const ticket = ++generation.current;
    const validScope = capture();
    const current = () => ticket === generation.current && validScope();
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
        if (!current()) return;
        try {
          const saved = validateProviderResult(result, 'draft', id ?? undefined);
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
          setUncertain(true);
          setRecovered(false);
          throw new ProviderRequestError(false, [], true);
        }
        setTestOutcome({});
        closeEditor();
        await fetchAll();
      };
      try {
        const result = id
          ? await updateProvider(id, { label: draft.label.trim(), config })
          : await createProvider(kind, draft.label.trim(), config);
        if (!current()) {
          if (ticket === generation.current) {
            setUncertain(true);
            setRecovered(false);
          }
          return;
        }
        await accept(result);
      } catch (err) {
        if (!current()) return;
        if (err instanceof ProviderRequestError && err.denied) {
          scope.deny();
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
            true
          )
        )
          return;
        if (err instanceof ProviderRequestError && err.uncertain) {
          setUncertain(true);
          setRecovered(false);
        }
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

  async function handleTest(p: EmailProvider, recipient: string) {
    if (inFlight.current || protectedAction || loading || loadFailed || scope.denied) return;
    inFlight.current = true;
    const ticket = ++generation.current;
    const validScope = capture();
    const current = () => ticket === generation.current && validScope();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await testConnection(p.id, recipient);
      if (!current()) return;
      setTestOutcome((prev) => ({ ...prev, [p.id]: outcome }));
      await fetchAll();
    } catch (err) {
      if (!current()) return;
      if (err instanceof ProviderRequestError && err.denied) {
        scope.deny();
        return;
      }
      if (
        offerStepUp(
          err,
          providerText('admin.providers.test.run', uiLocale),
          p.label,
          async (result) => {
            if (!current()) return;
            const outcome = validateConnectionResult(result, p.id);
            setTestOutcome((prev) => ({ ...prev, [p.id]: outcome }));
            await fetchAll();
          }
        )
      )
        return;
      // Connection errors surfaced inline on the row, not as a page error.
      setTestOutcome((prev) => ({
        ...prev,
        [p.id]: { ok: false, error: providerText('admin.providers.error.test', uiLocale) },
      }));
    } finally {
      if (ticket === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function handleActivate(p: EmailProvider) {
    if (inFlight.current || protectedAction || loading || loadFailed || scope.denied) return;
    inFlight.current = true;
    const ticket = ++generation.current;
    const validScope = capture();
    const current = () => ticket === generation.current && validScope();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await activateProvider(p.id);
      if (!current()) return;
      await fetchAll();
    } catch (err) {
      if (!current()) return;
      if (err instanceof ProviderRequestError && err.denied) {
        scope.deny();
        return;
      }
      if (
        offerStepUp(
          err,
          providerText('admin.providers.activate', uiLocale),
          p.label,
          async (result) => {
            if (!current()) return;
            validateProviderResult(result, 'active', p.id);
            await fetchAll();
          }
        )
      )
        return;
      setError(providerText('admin.providers.error.activate', uiLocale));
    } finally {
      if (ticket === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function handleDisable(p: EmailProvider) {
    if (!window.confirm(providerText('admin.providers.disableConfirm', uiLocale))) return;
    if (inFlight.current || protectedAction || loading || loadFailed || scope.denied) return;
    inFlight.current = true;
    const ticket = ++generation.current;
    const validScope = capture();
    const current = () => ticket === generation.current && validScope();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await disableProvider(p.id);
      if (!current()) return;
      await fetchAll();
    } catch (err) {
      if (!current()) return;
      if (err instanceof ProviderRequestError && err.denied) {
        scope.deny();
        return;
      }
      if (
        offerStepUp(
          err,
          providerText('admin.providers.disable', uiLocale),
          p.label,
          async (result) => {
            if (!current()) return;
            validateProviderResult(result, 'disabled', p.id);
            await fetchAll();
          }
        )
      )
        return;
      setError(providerText('admin.providers.error.disable', uiLocale));
    } finally {
      if (ticket === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function handleRollback(p: EmailProvider) {
    if (!window.confirm(providerText('admin.providers.rollbackConfirm', uiLocale))) return;
    if (inFlight.current || protectedAction || loading || loadFailed || scope.denied) return;
    inFlight.current = true;
    const ticket = ++generation.current;
    const validScope = capture();
    const current = () => ticket === generation.current && validScope();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await rollbackProvider(p.id);
      if (!current()) return;
      setNotice(providerText('admin.providers.rollback', uiLocale));
      await fetchAll();
    } catch (err) {
      if (!current()) return;
      if (err instanceof ProviderRequestError && err.denied) {
        scope.deny();
        return;
      }
      if (
        offerStepUp(
          err,
          providerText('admin.providers.rollback', uiLocale),
          p.label,
          async (result) => {
            if (!current()) return;
            const saved = validateProviderResult(result, 'active');
            if (saved.id === p.id) throw new ProviderRequestError();
            setNotice(providerText('admin.providers.rollback', uiLocale));
            await fetchAll();
          }
        )
      )
        return;
      setError(providerText('admin.providers.error.rollback', uiLocale));
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
            <button
              onClick={() => openEdit(p)}
              disabled={busy || loading || loadFailed || scope.denied || !!protectedAction}
              className="px-3 py-1 border border-input rounded text-xs hover:bg-muted disabled:opacity-50 w-full text-start"
            >
              {providerText('admin.providers.update', uiLocale)}
            </button>
            <EmailTestRow
              provider={p}
              recipient={recipient?.basis === recipientBasis(p) ? recipient.value : ''}
              setRecipient={(value) =>
                setTestRecipients((current) => ({
                  ...current,
                  [p.id]: { basis: recipientBasis(p), value },
                }))
              }
              onTest={handleTest}
              busy={busy || loading || loadFailed || scope.denied || !!protectedAction}
            />
            <button
              onClick={() => handleActivate(p)}
              disabled={
                busy ||
                loading ||
                loadFailed ||
                scope.denied ||
                !!protectedAction ||
                p.lastTestStatus !== 'passed'
              }
              title={
                p.lastTestStatus !== 'passed'
                  ? providerText('admin.providers.activateHint', uiLocale)
                  : undefined
              }
              className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs hover:bg-primary/90 disabled:opacity-40 w-full text-start"
            >
              {providerText('admin.providers.activate', uiLocale)}
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
              onClick={() => handleDisable(p)}
              disabled={busy || loading || loadFailed || scope.denied || !!protectedAction}
              className="px-3 py-1 border border-destructive/20 text-destructive rounded text-xs hover:bg-red-50 disabled:opacity-50 w-full text-start"
            >
              {providerText('admin.providers.disable', uiLocale)}
            </button>
          </>
        )}

        {(p.status === 'superseded' || p.status === 'disabled') && (
          <button
            onClick={() => handleRollback(p)}
            disabled={busy || loading || loadFailed || scope.denied || !!protectedAction}
            className="px-3 py-1 border border-input rounded text-xs hover:bg-muted disabled:opacity-50 w-full text-start"
          >
            {providerText('admin.providers.rollback', uiLocale)}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="min-w-0 space-y-6" dir={uiLocale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{providerText('admin.providers.title', uiLocale)}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {providerText('admin.providers.subtitle', uiLocale)}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {providerText('admin.providers.test.notice', uiLocale)}
          </p>
        </div>
        {!showEditor && (
          <button
            onClick={openCreate}
            disabled={busy || loading || loadFailed || scope.denied || !!protectedAction}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            {providerText('admin.providers.new', uiLocale)}
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="bg-danger-soft border border-destructive/20 text-destructive px-4 py-3 rounded relative"
        >
          {error}
          <button
            onClick={() => setError(null)}
            className="absolute top-2 end-2 text-destructive hover:text-red-700"
            aria-label={t('admin.notifications.dismissError', uiLocale)}
          >
            ✕
          </button>
        </div>
      )}

      {notice && (
        <div className="bg-success-soft border border-success/20 text-success px-4 py-3 rounded relative">
          {notice}
          <button
            onClick={() => setNotice(null)}
            className="absolute top-2 end-2 text-success hover:text-green-700"
            aria-label={providerText('admin.providers.dismissNotice', uiLocale)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Editor */}
      {showEditor && (
        <form
          noValidate
          onSubmit={handleSave}
          className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-4"
        >
          {staleEditor && <p role="alert">{providerText('admin.providers.stale', uiLocale)}</p>}
          {uncertain && <p role="alert">{providerFormText('uncertain', uiLocale)}</p>}
          {(staleEditor || uncertain) && (
            <Button
              type="button"
              variant="outline"
              disabled={
                loading || loadFailed || busy || !!protectedAction || (uncertain && !recovered)
              }
              onClick={() => {
                const row = providers.find((p) => p.id === editId);
                if (row) openEdit(row);
                else openCreate();
              }}
            >
              {providerFormText('reset', uiLocale)}
            </Button>
          )}
          {catalogueRootMessage(editor.errors) && (
            <p role="alert">{catalogueRootMessage(editor.errors)}</p>
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
            className="space-y-4"
          >
            <h2 className="text-lg font-semibold">
              {editId
                ? providerText('admin.providers.update.title', uiLocale)
                : providerText('admin.providers.create.title', uiLocale)}
            </h2>

            <div>
              <label
                htmlFor="email-provider-label"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {providerText('admin.providers.label', uiLocale)}{' '}
                <span className="text-destructive">*</span>
              </label>
              <input
                {...editor.bind('label')}
                type="text"
                id="email-provider-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full border border-input rounded px-3 py-2"
                required
              />
              {editor.errors.label && (
                <p id={editor.errorId('label')} role="alert" className="text-sm text-destructive">
                  {editor.errors.label.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="email-provider-transport"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {providerText('admin.providers.transport', uiLocale)}{' '}
                <span className="text-destructive">*</span>
              </label>
              <select
                id="email-provider-transport"
                value={transport}
                onChange={(e) => handleTransportChange(e.target.value as Transport)}
                className="w-full border border-input rounded px-3 py-2"
                disabled={editId !== null}
              >
                <option value="smtp">SMTP</option>
                <option value="resend">Resend</option>
              </select>
            </div>

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

            <div className="flex gap-3 pt-2">
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
              <button
                type="button"
                onClick={closeEditor}
                disabled={busy || !!protectedAction}
                className="px-4 py-2 border border-input rounded text-sm hover:bg-muted disabled:opacity-50"
              >
                {providerText('admin.providers.cancel', uiLocale)}
              </button>
            </div>
          </fieldset>
        </form>
      )}

      {protectedAction && (
        <TeamActionDialog
          action={protectedAction.action}
          onSuccess={protectedAction.onSuccess}
          {...(protectedAction.save ? { onValidationError: fieldErrors } : {})}
          confirmationDisabled={
            (protectedAction.save && uncertain) ||
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
              {recovery}
            </>
          }
          onDenied={scope.deny}
          finalFocus={() =>
            document.querySelector<HTMLButtonElement>('[data-slot="list-page"] button')
          }
          onClose={() => setProtectedAction(null)}
        />
      )}

      <ListPage>
        <ListPage.Toolbar>{!loadFailed && !scope.denied && recovery}</ListPage.Toolbar>
        <ListPage.Content
          loading={loading}
          error={loadFailed || scope.denied}
          empty={false}
          emptyView={null}
          retainContent={catalogue.data !== null}
          loadingView={<p role="status">{providerText('admin.providers.loading', uiLocale)}</p>}
          errorView={
            <div role="alert" className="space-y-2">
              {providerText(
                scope.denied ? 'admin.providers.denied' : 'admin.providers.error.load',
                uiLocale
              )}
              {recovery}
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
            renderActions={providerActions}
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
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field
        binding={feedback.bind('host')}
        error={feedback.errors.host?.message}
        errorId={feedback.errorId('host')}
        label={sec('host')}
        required
      >
        <input
          type="text"
          value={form.host}
          onChange={(e) => set('host', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field
        binding={feedback.bind('port')}
        error={feedback.errors.port?.message}
        errorId={feedback.errorId('port')}
        label={sec('port')}
        required
      >
        <input
          type="number"
          value={form.port}
          onChange={(e) => set('port', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field
        binding={feedback.bind('security')}
        error={feedback.errors.security?.message}
        errorId={feedback.errorId('security')}
        label={sec('security')}
      >
        <select
          value={form.security}
          onChange={(e) => set('security', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        >
          <option value="STARTTLS">STARTTLS</option>
          <option value="TLS">TLS</option>
        </select>
      </Field>
      {(['connectionTimeout', 'commandTimeout'] as const).map((key) => (
        <Field
          key={key}
          binding={feedback.bind(key)}
          error={feedback.errors[key]?.message}
          errorId={feedback.errorId(key)}
          label={sec(key)}
          required
        >
          <input
            type="number"
            min={1}
            max={600}
            step={1}
            required
            value={form[key]}
            onChange={(e) => set(key, e.target.value)}
            className="w-full border border-input rounded px-3 py-2"
          />
        </Field>
      ))}
      <Field
        binding={feedback.bind('username')}
        error={feedback.errors.username?.message}
        errorId={feedback.errorId('username')}
        label={sec('username')}
      >
        <input
          type="text"
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field
        binding={feedback.bind('password')}
        error={feedback.errors.password?.message}
        errorId={feedback.errorId('password')}
        label={sec('password')}
        secret
      >
        <input
          type="password"
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
          placeholder={
            editing ? providerText('admin.providers.field.secretPlaceholder', uiLocale) : undefined
          }
          autoComplete="new-password"
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field
        binding={feedback.bind('fromName')}
        error={feedback.errors.fromName?.message}
        errorId={feedback.errorId('fromName')}
        label={sec('fromName')}
      >
        <input
          type="text"
          value={form.fromName}
          onChange={(e) => set('fromName', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field
        binding={feedback.bind('fromEmail')}
        error={feedback.errors.fromEmail?.message}
        errorId={feedback.errorId('fromEmail')}
        label={sec('fromEmail')}
        required
      >
        <input
          type="email"
          dir="ltr"
          value={form.fromEmail}
          onChange={(e) => set('fromEmail', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field
        binding={feedback.bind('replyTo')}
        error={feedback.errors.replyTo?.message}
        errorId={feedback.errorId('replyTo')}
        label={sec('replyTo')}
      >
        <input
          type="email"
          value={form.replyTo}
          onChange={(e) => set('replyTo', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
    </div>
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field
        binding={feedback.bind('apiKey')}
        error={feedback.errors.apiKey?.message}
        errorId={feedback.errorId('apiKey')}
        label={sec('apiKey')}
        required={!editing}
        secret
      >
        <input
          type="password"
          value={form.apiKey}
          onChange={(e) => set('apiKey', e.target.value)}
          placeholder={
            editing ? providerText('admin.providers.field.secretPlaceholder', uiLocale) : undefined
          }
          autoComplete="new-password"
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field
        binding={feedback.bind('fromName')}
        error={feedback.errors.fromName?.message}
        errorId={feedback.errorId('fromName')}
        label={sec('fromName')}
      >
        <input
          type="text"
          value={form.fromName}
          onChange={(e) => set('fromName', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field
        binding={feedback.bind('fromEmail')}
        error={feedback.errors.fromEmail?.message}
        errorId={feedback.errorId('fromEmail')}
        label={sec('fromEmail')}
        required
      >
        <input
          type="email"
          value={form.fromEmail}
          onChange={(e) => set('fromEmail', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field
        binding={feedback.bind('replyTo')}
        error={feedback.errors.replyTo?.message}
        errorId={feedback.errorId('replyTo')}
        label={sec('replyTo')}
      >
        <input
          type="email"
          value={form.replyTo}
          onChange={(e) => set('replyTo', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field
        binding={feedback.bind('sendingDomain')}
        error={feedback.errors.sendingDomain?.message}
        errorId={feedback.errorId('sendingDomain')}
        label={sec('sendingDomain')}
      >
        <input
          type="text"
          value={form.sendingDomain}
          onChange={(e) => set('sendingDomain', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
    </div>
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
  recipient,
  setRecipient,
}: {
  provider: EmailProvider;
  onTest: (p: EmailProvider, recipient: string) => void;
  busy: boolean;
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
        disabled={busy}
        onChange={(e) => setRecipient(e.target.value)}
        aria-label={providerText('admin.providers.test.recipient', uiLocale)}
        placeholder={providerText('admin.providers.test.recipient', uiLocale)}
        className="w-full border border-input rounded px-2 py-1 text-xs"
      />
      <button
        onClick={() => onTest(provider, recipient.trim())}
        disabled={busy || !recipient.trim()}
        className="px-3 py-1 border border-input rounded text-xs hover:bg-muted disabled:opacity-50 w-full text-start"
      >
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
  secret,
  children,
  binding,
  error,
  errorId,
}: {
  label: string;
  required?: boolean;
  secret?: boolean;
  children: ReactElement<Record<string, unknown>>;
  binding: WizardFieldBinding;
  error?: string | undefined;
  errorId: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-foreground mb-1">
        {label}
        {required && <span className="text-destructive"> *</span>}
        {secret && <span className="ml-1 text-xs text-muted-foreground" />}
      </span>
      {cloneElement(children, { ...binding, id: `email-provider-${binding.name}` })}
      {error && (
        <span id={errorId} role="alert" className="block text-sm text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}

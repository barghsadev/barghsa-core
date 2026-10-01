import { Button, ListPage, ScrollArea } from '@barghsa/ui';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import {
  useProviderCatalogue,
  providerBasis,
  useProviderCommandGuard,
} from '../hooks/useProviderCatalogue.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { ProviderHealthMetrics } from '../components/ProviderHealthMetrics.js';
import { ProviderAlertHistory } from '../components/ProviderAlertHistory.js';
import { providerText } from '@barghsa/i18n/providers';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { FormEvent, ReactNode } from 'react';
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

interface SmtpForm {
  host: string;
  port: string;
  security: 'TLS' | 'STARTTLS';
  username: string;
  password: string;
  connectionTimeout: string;
  commandTimeout: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
}

interface ResendForm {
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  sendingDomain: string;
}

type TransportForm = SmtpForm | ResendForm;

const EMPTY_SMTP: SmtpForm = {
  host: '',
  port: '587',
  security: 'STARTTLS',
  username: '',
  password: '',
  connectionTimeout: '10',
  commandTimeout: '15',
  fromName: '',
  fromEmail: '',
  replyTo: '',
};

const EMPTY_RESEND: ResendForm = {
  apiKey: '',
  fromName: '',
  fromEmail: '',
  replyTo: '',
  sendingDomain: '',
};

function savedForm(provider: EmailProvider): TransportForm {
  const value = provider.maskedConfig;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderRequestError();
  const config = value as Record<string, unknown>;
  const field = (key: string, required = false): string => {
    const value = config[key] === undefined ? '' : config[key];
    if (typeof value !== 'string' || (required && !value.trim())) throw new ProviderRequestError();
    return value;
  };
  const integer = (key: string, fallback: number, max: number): string => {
    const value = config[key] === undefined ? fallback : config[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
      throw new ProviderRequestError();
    return String(value);
  };
  const common = {
    fromName: field('from_name'),
    fromEmail: field('from_email', true),
    replyTo: field('reply_to'),
  };
  if (provider.transport === 'resend') {
    return { ...common, apiKey: '', sendingDomain: field('sending_domain') };
  }
  const security = config.security === undefined ? 'STARTTLS' : config.security;
  if (security !== 'TLS' && security !== 'STARTTLS') throw new ProviderRequestError();
  return {
    ...common,
    host: field('host', true),
    port: integer('port', 587, 65535),
    security,
    username: field('username'),
    password: '',
    connectionTimeout: integer('connection_timeout', 10, 600),
    commandTimeout: integer('command_timeout', 15, 600),
  };
}

function smtpConfig(form: SmtpForm): Record<string, unknown> {
  const config: Record<string, unknown> = {
    host: form.host,
    port: Number(form.port),
    security: form.security,
    connection_timeout: Number(form.connectionTimeout),
    command_timeout: Number(form.commandTimeout),
    from_email: form.fromEmail,
  };
  if (form.username) config.username = form.username;
  if (form.password) config.password = form.password;
  if (form.fromName) config.from_name = form.fromName;
  if (form.replyTo) config.reply_to = form.replyTo;
  return config;
}

function resendConfig(form: ResendForm): Record<string, unknown> {
  const config: Record<string, unknown> = {
    from_email: form.fromEmail,
  };
  // Only include the API key when a new value was provided. When editing, an
  // empty apiKey means "keep the stored key" (server merges the patch over the
  // existing config), mirroring how the SMTP password is treated.
  if (form.apiKey) config.api_key = form.apiKey;
  if (form.fromName) config.from_name = form.fromName;
  if (form.replyTo) config.reply_to = form.replyTo;
  if (form.sendingDomain) config.sending_domain = form.sendingDomain;
  return config;
}

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
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [, setEditStatus] = useState<Status | null>(null);
  const [label, setLabel] = useState('');
  const [transport, setTransport] = useState<Transport>('smtp');
  const [form, setForm] = useState<TransportForm>(EMPTY_SMTP);

  // Per-row test outcome cache
  const [testOutcome, setTestOutcome] = useState<Record<string, TestConnectionOutcome>>({});

  const clearPrivate = useCallback(() => {
    setShowEditor(false);
    setEditId(null);
    setEditBasis(null);
    setForm(EMPTY_SMTP);
    setLabel('');
    setTransport('smtp');
    setProtectedAction(null);
    setTestOutcome({});
    setError(null);
    setNotice(null);
    setInvalidConfig(false);
    setBusy(false);
  }, []);
  const scope = useCatalogueScope(clearPrivate);
  const catalogue = useProviderCatalogue(scope, listProviders);
  const providers = catalogue.data ?? [];
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
    setBusy(false);
  }, [basis, protectedAction]);
  const recover = () => (scope.denied ? scope.recover() : void fetchAll());
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

  function openCreate() {
    setEditId(null);
    setEditBasis(null);
    setEditStatus(null);
    setLabel('');
    setTransport('smtp');
    setForm(EMPTY_SMTP);
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
    setEditId(p.id);
    setEditBasis(rowBasis(p, false));
    setEditStatus(p.status);
    setLabel(p.label);
    setTransport(p.transport);
    setForm(saved);
    setError(null);
    setNotice(null);
    setShowEditor(true);
  }

  function closeEditor() {
    setShowEditor(false);
    setForm(transport === 'smtp' ? { ...EMPTY_SMTP } : { ...EMPTY_RESEND });
    setLabel('');
    setEditId(null);
    setEditBasis(null);
    setEditStatus(null);
  }

  function handleTransportChange(next: Transport) {
    setTransport(next);
    // Reset the form when switching transports to avoid stale secret fields.
    setForm(next === 'smtp' ? { ...EMPTY_SMTP } : { ...EMPTY_RESEND });
  }

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function offerStepUp(
    error: unknown,
    title: string,
    description: string,
    onSuccess: (result: unknown) => Promise<void>
  ): boolean {
    if (!(error instanceof ProviderStepUpError)) return false;
    setProtectedAction({
      basis,
      action: { ...error.action, title, description, requiresPassword: true },
      onSuccess,
    });
    return true;
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (
      inFlight.current ||
      protectedAction ||
      busy ||
      loading ||
      loadFailed ||
      scope.denied ||
      staleEditor
    )
      return;
    inFlight.current = true;
    const current = capture();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Client-side required-field validation mirrors the server schemas.
      if (!label.trim()) throw new Error(providerText('admin.providers.field.required', uiLocale));
      if (transport === 'smtp') {
        const f = form as SmtpForm;
        if (!f.host.trim() || !f.fromEmail.trim()) {
          throw new Error(providerText('admin.providers.field.required', uiLocale));
        }
        if (editId) {
          await updateProvider(editId, { label: label.trim(), config: smtpConfig(f) });
        } else {
          await createProvider(transport, label.trim(), smtpConfig(f));
        }
      } else {
        const f = form as ResendForm;
        // from_email is always required; the API key is only required on
        // create. When editing, an empty apiKey preserves the stored key
        // (server merges the config patch over the existing config).
        if (!f.fromEmail.trim() || (!editId && !f.apiKey.trim())) {
          throw new Error(providerText('admin.providers.field.required', uiLocale));
        }
        if (editId) {
          await updateProvider(editId, { label: label.trim(), config: resendConfig(f) });
        } else {
          await createProvider(transport, label.trim(), resendConfig(f));
        }
      }
      if (!current()) return;
      setTestOutcome({});
      closeEditor();
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
          providerText(
            editId ? 'admin.providers.update.title' : 'admin.providers.create.title',
            uiLocale
          ),
          label.trim(),
          async (result) => {
            if (!current()) return;
            const saved = validateProviderResult(result, 'draft', editId ?? undefined);
            if (saved.transport !== transport) throw new ProviderRequestError();
            setTestOutcome({});
            closeEditor();
            await fetchAll();
          }
        )
      )
        return;
      setError(
        err instanceof Error && !(err instanceof ProviderRequestError)
          ? err.message
          : providerText('admin.providers.error.save', uiLocale)
      );
    } finally {
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  }

  async function handleTest(p: EmailProvider, recipient: string) {
    if (inFlight.current || protectedAction || loading || loadFailed || scope.denied) return;
    inFlight.current = true;
    const current = capture();
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
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  }

  async function handleActivate(p: EmailProvider) {
    if (inFlight.current || protectedAction || loading || loadFailed || scope.denied) return;
    inFlight.current = true;
    const current = capture();
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
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  }

  async function handleDisable(p: EmailProvider) {
    if (!window.confirm(providerText('admin.providers.disableConfirm', uiLocale))) return;
    if (inFlight.current || protectedAction || loading || loadFailed || scope.denied) return;
    inFlight.current = true;
    const current = capture();
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
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  }

  async function handleRollback(p: EmailProvider) {
    if (!window.confirm(providerText('admin.providers.rollbackConfirm', uiLocale))) return;
    if (inFlight.current || protectedAction || loading || loadFailed || scope.denied) return;
    inFlight.current = true;
    const current = capture();
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
      inFlight.current = false;
      if (current()) setBusy(false);
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
          onSubmit={handleSave}
          className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-4"
        >
          {staleEditor && <p role="alert">{providerText('admin.providers.stale', uiLocale)}</p>}
          <fieldset disabled={busy || !!protectedAction} className="space-y-4">
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
                type="text"
                id="email-provider-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full border border-input rounded px-3 py-2"
                required
              />
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
              <SmtpFields form={form as SmtpForm} setField={setField} editing={editId !== null} />
            ) : (
              <ResendFields
                form={form as ResendForm}
                setField={setField}
                editing={editId !== null}
              />
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={
                  busy || loading || loadFailed || scope.denied || !!protectedAction || staleEditor
                }
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {busy
                  ? providerText('admin.providers.saving', uiLocale)
                  : editId
                    ? providerText('admin.providers.update', uiLocale)
                    : providerText('admin.providers.create', uiLocale)}
              </button>
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
          confirmationDisabled={
            loading || loadFailed || scope.denied || staleEditor || protectedAction.basis !== basis
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
          <ScrollArea
            scrollbarOrientation="horizontal"
            aria-label={providerText('admin.providers.title', uiLocale)}
            className="bg-card text-card-foreground rounded-lg border border-border"
          >
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-3 text-start font-semibold text-muted-foreground"
                  >
                    {providerText('admin.providers.col.label', uiLocale)}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-start font-semibold text-muted-foreground"
                  >
                    {providerText('admin.providers.col.transport', uiLocale)}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-start font-semibold text-muted-foreground"
                  >
                    {providerText('admin.providers.col.status', uiLocale)}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-start font-semibold text-muted-foreground"
                  >
                    {providerText('admin.providers.col.test', uiLocale)}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-start font-semibold text-muted-foreground"
                  >
                    {providerText('admin.providers.col.activated', uiLocale)}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-start font-semibold text-muted-foreground"
                  >
                    {providerText('admin.providers.col.actions', uiLocale)}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {providers.length === 0 && !loading && !loadFailed ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      {providerText('admin.providers.empty', uiLocale)}
                    </td>
                  </tr>
                ) : (
                  providers.map((p) => {
                    const risky = activeProviderIsRisky(p);
                    return (
                      <tr key={p.id} className="align-top">
                        <td className="px-4 py-3 font-medium">{p.label}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs uppercase tracking-wide text-muted-foreground">
                            {providerText(`admin.providers.transport.${p.transport}`, uiLocale)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
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
                                  {time.format(p.lastFailureAt)}
                                </p>
                              )}
                            </>
                          )}
                          <ProviderHealthMetrics
                            metrics={p.healthMetrics}
                            active={p.status === 'active'}
                          />
                          <ProviderAlertHistory events={p.alertHistory} />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TEST_COLORS[p.lastTestStatus]}`}
                          >
                            {lastTestLabel(p)}
                          </span>
                          {p.lastTestAt && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {time.format(p.lastTestAt)}
                            </p>
                          )}
                          {p.lastTestError && (
                            <p className="text-xs text-destructive mt-1" title={p.lastTestError}>
                              {p.lastTestError}
                            </p>
                          )}
                          {(() => {
                            const outcome = testOutcome[p.id];
                            if (outcome) {
                              return (
                                <p
                                  className={`text-xs mt-1 ${outcome.ok ? 'text-success' : 'text-destructive'}`}
                                >
                                  {outcome.ok
                                    ? providerText('admin.providers.test.passed', uiLocale)
                                    : outcome.error ||
                                      providerText('admin.providers.test.failed', uiLocale)}
                                </p>
                              );
                            }
                            return null;
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          {p.activatedAt ? time.format(p.activatedAt) : '—'}
                          {p.activatedAt && p.activatedBy && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {providerText('admin.providers.meta.activatedBy', uiLocale)}:{' '}
                              {p.activatedBy}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 space-y-1">
                          {/* Draft row actions */}
                          {p.status === 'draft' && (
                            <>
                              <button
                                onClick={() => openEdit(p)}
                                disabled={
                                  busy || loading || loadFailed || scope.denied || !!protectedAction
                                }
                                className="px-3 py-1 border border-input rounded text-xs hover:bg-muted disabled:opacity-50 w-full text-start"
                              >
                                {providerText('admin.providers.update', uiLocale)}
                              </button>
                              <EmailTestRow
                                provider={p}
                                onTest={handleTest}
                                busy={
                                  busy || loading || loadFailed || scope.denied || !!protectedAction
                                }
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
                                disabled={
                                  busy || loading || loadFailed || scope.denied || !!protectedAction
                                }
                                className="px-3 py-1 border border-destructive/20 text-destructive rounded text-xs hover:bg-red-50 disabled:opacity-50 w-full text-start"
                              >
                                {providerText('admin.providers.disable', uiLocale)}
                              </button>
                            </>
                          )}

                          {(p.status === 'superseded' || p.status === 'disabled') && (
                            <button
                              onClick={() => handleRollback(p)}
                              disabled={
                                busy || loading || loadFailed || scope.denied || !!protectedAction
                              }
                              className="px-3 py-1 border border-input rounded text-xs hover:bg-muted disabled:opacity-50 w-full text-start"
                            >
                              {providerText('admin.providers.rollback', uiLocale)}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </ScrollArea>
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
}: {
  form: SmtpForm;
  setField: (k: string, v: string) => void;
  editing: boolean;
}) {
  const uiLocale = useLocale();
  const set = (k: keyof SmtpForm, v: string) => setField(k as string, v);
  const sec = (k: string) => providerText(`admin.providers.field.${k}`, uiLocale);
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label={sec('host')} required>
        <input
          type="text"
          value={form.host}
          onChange={(e) => set('host', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field label={sec('port')} required>
        <input
          type="number"
          value={form.port}
          onChange={(e) => set('port', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field label={sec('security')}>
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
        <Field key={key} label={sec(key)} required>
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
      <Field label={sec('username')}>
        <input
          type="text"
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field label={sec('password')} secret>
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
      <Field label={sec('fromName')}>
        <input
          type="text"
          value={form.fromName}
          onChange={(e) => set('fromName', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field label={sec('fromEmail')} required>
        <input
          type="email"
          value={form.fromEmail}
          onChange={(e) => set('fromEmail', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field label={sec('replyTo')}>
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
}: {
  form: ResendForm;
  setField: (k: string, v: string) => void;
  editing: boolean;
}) {
  const uiLocale = useLocale();
  const set = (k: keyof ResendForm, v: string) => setField(k as string, v);
  const sec = (k: string) => providerText(`admin.providers.field.${k}`, uiLocale);
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label={sec('apiKey')} required secret>
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
      <Field label={sec('fromName')}>
        <input
          type="text"
          value={form.fromName}
          onChange={(e) => set('fromName', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field label={sec('fromEmail')} required>
        <input
          type="email"
          value={form.fromEmail}
          onChange={(e) => set('fromEmail', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field label={sec('replyTo')}>
        <input
          type="email"
          value={form.replyTo}
          onChange={(e) => set('replyTo', e.target.value)}
          className="w-full border border-input rounded px-3 py-2"
        />
      </Field>
      <Field label={sec('sendingDomain')}>
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

function EmailTestRow({
  provider,
  onTest,
  busy,
}: {
  provider: EmailProvider;
  onTest: (p: EmailProvider, recipient: string) => void;
  busy: boolean;
}) {
  const uiLocale = useLocale();
  const [recipient, setRecipient] = useState('');
  const basis = providerBasis([
    provider.id,
    provider.label,
    provider.transport,
    provider.status,
    provider.maskedConfig,
  ]);
  useEffect(() => setRecipient(''), [basis]);
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
}: {
  label: string;
  required?: boolean;
  secret?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-foreground mb-1">
        {label}
        {required && <span className="text-destructive"> *</span>}
        {secret && <span className="ml-1 text-xs text-muted-foreground" />}
      </span>
      {children}
    </label>
  );
}

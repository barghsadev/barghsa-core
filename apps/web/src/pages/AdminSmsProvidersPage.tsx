import { CommandFeedback } from '../components/CommandFeedback.js';
import { useCatalogueScope } from '../hooks/useCatalogueResource.js';
import {
  useProviderCatalogue,
  providerBasis,
  useProviderCommandGuard,
  useProviderCommandRecovery,
} from '../hooks/useProviderCatalogue.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LoadingStatus, Button, DateCell, Input, Label, ListPage, ScrollArea } from '@barghsa/ui';
import { buildSmsTestParameters } from '@barghsa/shared/notifications';
import { smsProviderText } from '@barghsa/i18n/providers';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { DeliveryProviderTable } from '../components/DeliveryProviderTable.js';
import { ProviderHealthMetrics } from '../components/ProviderHealthMetrics.js';
import { ProviderAlertHistory } from '../components/ProviderAlertHistory.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
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

export default function AdminSmsProvidersPage() {
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
    form.form.reset(editorFor());
    setShowEditor(false);
    generation.current++;
    validationOwner.current++;
    inFlight.current = false;
    form.setValidationPending(false);
    setEditSource(null);
    setSelected(null);
    setFirstEvent('');
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
  const invalidEvents = !!editor && editor.mappings.some((m) => !events.includes(m.event.trim()));
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
  const recovery = (
    <div className="flex flex-wrap gap-3">
      <div>
        <Button
          type="button"
          variant="outline"
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
            variant="outline"
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
            variant="outline"
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
    const status: Status = operation === 'disable' ? 'disabled' : 'active';
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
        if (operation === 'rollback' && saved.id === row.id) throw new ProviderRequestError();
        setSelected(null);
        setNotice(text('changed'));
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
      !testMappings.length ||
      !testMappings.some((m) => m.event_key === firstEvent)
    )
      return;
    const id = testProvider.id;
    await mutate(
      {
        path: `/${encodeURIComponent(id)}/test-connection`,
        method: 'POST',
        body: { eventKey: firstEvent },
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
  function open(row?: SmsProvider, clone = false) {
    generation.current++;
    command.reset();
    form.setValidationPending(false);
    setEditor(editorFor(row, clone));
    setEditSource(row ? { id: row.id, basis: rowBasis(row, false) } : null);
    setSelected(null);
    setError(null);
    setNotice(null);
  }

  const providerFields = [
    {
      id: 'status',
      label: text('status'),
      render: (p: SmsProvider) => (
        <>
          {text(p.status)}
          {p.status === 'active' && (
            <>
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
          <Button variant="outline" disabled={disabled || !!editor} onClick={() => open(p)}>
            {text('edit')}
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !!editor || !p.config.template_mappings.length}
            onClick={() => {
              setSelected(p.id);
              setFirstEvent(p.config.template_mappings[0]?.event_key ?? '');
              setNotice(null);
              setError(null);
            }}
          >
            {text('preview')}
          </Button>
          <Button
            disabled={disabled || !eventsReady || !!editor || p.lastTestStatus !== 'passed'}
            onClick={() => lifecycle(p, 'activate')}
          >
            {text('activate')}
          </Button>
        </>
      ) : (
        <Button variant="outline" disabled={disabled || !!editor} onClick={() => open(p, true)}>
          {text('clone')}
        </Button>
      )}
      {p.status === 'active' && (
        <Button
          variant="outline"
          disabled={disabled || !eventsReady || !!editor}
          onClick={() => lifecycle(p, 'disable')}
        >
          {text('disable')}
        </Button>
      )}
      {(p.status === 'superseded' || p.status === 'disabled') && (
        <Button
          variant="outline"
          disabled={disabled || !eventsReady || !!editor}
          onClick={() => lifecycle(p, 'rollback')}
        >
          {text('rollback')}
        </Button>
      )}
    </div>
  );

  return (
    <section
      aria-labelledby="sms-title"
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
              {recovery}
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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 id="sms-title" className="text-2xl font-bold">
            {text('title')}
          </h1>
          <p className="text-muted-foreground">{text('subtitle')}</p>
        </div>
        <Button disabled={disabled || !!editor} onClick={() => open()}>
          {text('new')}
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">{text('recovery')}</p>
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
      <ListPage>
        <ListPage.Toolbar>{recovery}</ListPage.Toolbar>
        <ListPage.Content
          loading={loading}
          error={loadFailed || scope.denied}
          retainContent={catalogue.data !== null}
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
            renderActions={providerActions}
            loading={loading}
            emptyMessage=""
            tableClassName="min-w-[52rem]"
          />
        </ListPage.Content>
      </ListPage>
      {editor && (
        <form noValidate onSubmit={save} className="min-w-0 rounded border p-4 space-y-4">
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
                } else open(row, editor.id === null && !!row);
              }}
            >
              {providerFormText('reset', locale)}
            </Button>
          )}
          {catalogueRootMessage(form.errors) && (
            <p role="alert">{catalogueRootMessage(form.errors)}</p>
          )}
          <fieldset
            disabled={
              busy || form.pending || !!protectedAction || scope.denied || staleEditor || uncertain
            }
            className="min-w-0 space-y-4"
          >
            <legend className="font-semibold">{text(editor.id ? 'edit' : 'new')}</legend>
            <div className="grid gap-4 md:grid-cols-2">
              {(['label', 'sender', 'timeout', 'throughput', 'credit'] as const).map((key) => (
                <div key={key}>
                  <Label htmlFor={`sms-${key}`}>{text(key)}</Label>
                  <Input
                    {...form.bind(key)}
                    id={`sms-${key}`}
                    value={editor[key]}
                    onChange={(e) => field(key, e.target.value)}
                    required
                    aria-required="true"
                    type={['timeout', 'throughput', 'credit'].includes(key) ? 'number' : 'text'}
                    {...(key === 'timeout'
                      ? { min: 1, max: 300 }
                      : key === 'throughput'
                        ? { min: 1, max: 10000 }
                        : key === 'credit'
                          ? { min: 0, max: 1_000_000_000 }
                          : { maxLength: key === 'sender' ? 64 : 120 })}
                  />
                  {form.errors[key] && (
                    <p id={form.errorId(key)} role="alert" className="text-sm text-destructive">
                      {form.errors[key]?.message}
                    </p>
                  )}
                </div>
              ))}
              <div>
                <Label htmlFor="sms-key">{text('key')}</Label>
                <Input
                  {...form.bind('key')}
                  id="sms-key"
                  type="password"
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
                <p id="sms-key-hint" className="text-sm text-muted-foreground">
                  {text(editor.keyConfigured ? 'keyHint' : 'keyMissing')}
                </p>
              </div>
            </div>
            <datalist id="sms-events">
              {events.map((event) => (
                <option key={event} value={event} />
              ))}
            </datalist>
            {form.errors.mappings && (
              <p id={form.errorId('mappings')} role="alert" className="text-sm text-destructive">
                {form.errors.mappings.message}
              </p>
            )}
            <ScrollArea
              scrollbarOrientation="horizontal"
              aria-label={text('mappings')}
              className="min-w-0"
            >
              <table className="min-w-[64rem] w-full text-sm">
                <caption className="font-semibold text-start">{text('mappings')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-start">
                      {text('event')}
                    </th>
                    <th scope="col" className="text-start">
                      {text('language')}
                    </th>
                    <th scope="col" className="text-start">
                      {text('template')}
                    </th>
                    <th scope="col" className="text-start">
                      {text('parameter')}
                    </th>
                    <th scope="col" className="text-start">
                      {text('actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {editor.mappings.map((m, index) => (
                    <tr key={m.id} className="border-t align-top">
                      <td className="p-2">
                        <Input
                          {...(index === 0 ? { ...form.bind('mappings'), ref: mappingRef } : {})}
                          aria-invalid={form.errors.mappings ? true : undefined}
                          aria-describedby={
                            form.errors.mappings ? form.errorId('mappings') : undefined
                          }
                          aria-label={`${text('event')} ${index + 1}`}
                          list="sms-events"
                          value={m.event}
                          maxLength={128}
                          required
                          aria-required="true"
                          onChange={(e) => changeMapping(m.id, { event: e.target.value })}
                        />
                      </td>
                      <td className="p-2">
                        <select
                          aria-label={`${text('language')} ${index + 1}`}
                          aria-required="true"
                          value={m.locale}
                          className="border rounded bg-background p-2"
                          onChange={(e) =>
                            changeMapping(m.id, { locale: e.target.value as Mapping['locale'] })
                          }
                        >
                          <option value="all">{text('allLanguages')}</option>
                          <option value="fa">{text('persian')}</option>
                          <option value="en">{text('english')}</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <Input
                          aria-label={`${text('template')} ${index + 1}`}
                          value={m.template}
                          maxLength={128}
                          inputMode="numeric"
                          required
                          aria-required="true"
                          onChange={(e) => changeMapping(m.id, { template: e.target.value })}
                        />
                      </td>
                      <td className="p-2 space-y-2">
                        <datalist id={`sms-variables-${m.id}`}>
                          {smsVariableChoices(templateVariables.data ?? [], m.event, m.locale).map(
                            (name) => (
                              <option key={name} value={name} />
                            )
                          )}
                        </datalist>
                        <p
                          id={`sms-variables-hint-${m.id}`}
                          className="max-w-xs whitespace-normal text-xs text-muted-foreground"
                        >
                          {text('variablesHint')}
                        </p>
                        {m.variables.map((v, vi) => (
                          <div key={v.id} className="flex gap-2">
                            <Input
                              aria-label={`${text('variable')} ${index + 1}.${vi + 1}`}
                              placeholder={text('variable')}
                              list={`sms-variables-${m.id}`}
                              aria-describedby={`sms-variables-hint-${m.id}`}
                              value={v.internal}
                              maxLength={255}
                              required
                              aria-required="true"
                              onChange={(e) =>
                                changeMapping(m.id, {
                                  variables: m.variables.map((x) =>
                                    x.id === v.id ? { ...x, internal: e.target.value } : x
                                  ),
                                })
                              }
                            />
                            <Input
                              aria-label={`${text('parameter')} ${index + 1}.${vi + 1}`}
                              placeholder={text('parameter')}
                              value={v.parameter}
                              maxLength={255}
                              required
                              aria-required="true"
                              onChange={(e) =>
                                changeMapping(m.id, {
                                  variables: m.variables.map((x) =>
                                    x.id === v.id ? { ...x, parameter: e.target.value } : x
                                  ),
                                })
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              aria-label={`${text('remove')} ${text('variable')} ${index + 1}.${vi + 1}`}
                              onClick={() =>
                                changeMapping(m.id, {
                                  variables: m.variables.filter((x) => x.id !== v.id),
                                })
                              }
                            >
                              {text('remove')}
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            changeMapping(m.id, { variables: [...m.variables, variable()] })
                          }
                        >
                          {text('addVariable')}
                        </Button>
                      </td>
                      <td className="p-2">
                        <Button
                          type="button"
                          variant="outline"
                          aria-label={`${text('remove')} ${text('event')} ${index + 1}`}
                          onClick={() =>
                            field(
                              'mappings',
                              editor.mappings.filter((x) => x.id !== m.id)
                            )
                          }
                        >
                          {text('remove')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            <Button
              type="button"
              variant="outline"
              {...(!editor.mappings.length ? { ...form.bind('mappings'), ref: mappingRef } : {})}
              onClick={() => field('mappings', [...editor.mappings, mapping()])}
            >
              {text('addMapping')}
            </Button>
            <div className="flex gap-2">
              <CatalogueSaveButton
                pending={form.pending}
                disabled={disabled || !eventsReady || staleEditor || uncertain}
                label={text('save')}
              />
              <Button type="button" variant="outline" onClick={() => setEditor(null)}>
                {text('cancel')}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      {testProvider && !editor && (
        <section aria-labelledby="sms-preview-title" className="rounded border p-4 space-y-3">
          <h2 id="sms-preview-title" className="font-semibold">
            {text('preview')}: {testProvider.label}
          </h2>
          <Label htmlFor="sms-test-event">{text('firstEvent')}</Label>
          <select
            id="sms-test-event"
            disabled={disabled}
            value={firstEvent}
            onChange={(e) => setFirstEvent(e.target.value)}
            className="border rounded bg-background p-2"
          >
            {[...new Set(testProvider.config.template_mappings.map((m) => m.event_key))].map(
              (event) => (
                <option key={event} value={event}>
                  {event}
                </option>
              )
            )}
          </select>
          <p>
            {text('testNotice').replace(
              '{count}',
              new Intl.NumberFormat(locale).format(testMappings.length)
            )}
          </p>
          {testMappings.map((m) => (
            <div key={`${m.event_key}:${m.locale ?? '*'}`} className="border rounded p-3">
              <h3 className="font-mono" dir="ltr">
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
          <Button
            disabled={
              disabled || !eventsReady || testProvider.status !== 'draft' || !testMappings.length
            }
            onClick={() => void test()}
          >
            {text('test')}
          </Button>
        </section>
      )}
    </section>
  );
}

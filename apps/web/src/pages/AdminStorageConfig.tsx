import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { storagePolicyFormText } from '@barghsa/i18n/storage-policy-forms';
import { Alert, Button, Input, Label } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import {
  storageTextFields,
  emptyStorageDraft,
  storageDraft,
  storageInvalidFields,
  storageCommand,
  matchesStorageReceipt,
  validStorageConfig,
  validCleanupPolicy,
  cleanupInvalidFields,
  type StorageConfigView,
  type StorageDraft,
  type CleanupDraft,
  type CleanupPolicyView,
} from '../lib/storage-policy-form.js';

type Owner = 'config' | 'cleanup';
const basis = (value: StorageConfigView | CleanupPolicyView) =>
  JSON.stringify(
    'hasSecretKey' in value
      ? [
          storageTextFields.map((field) => value[field]),
          value.forcePathStyle,
          value.hasSecretKey,
          value.version,
        ]
      : [value.hours, value.version]
  );
export default function AdminStorageConfig() {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const label = (key: string) => t(`admin.storage.${key}`, locale);
  const text = (key: Parameters<typeof storagePolicyFormText>[0]) =>
    storagePolicyFormText(key, locale);
  const acceptedConfig = useRef<StorageConfigView | null>(null),
    acceptedCleanup = useRef<CleanupPolicyView | null>(null);
  const messages = Object.fromEntries(
    Object.keys(emptyStorageDraft()).map((key) => [key, text(key as keyof StorageDraft)])
  ) as Record<keyof StorageDraft, string>;
  const configForm = useWizardForm<StorageDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema(messages, (draft) =>
        storageInvalidFields(draft, acceptedConfig.current)
      );
    },
    emptyStorageDraft,
    text('unavailable')
  );
  const cleanupForm = useWizardForm<CleanupDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema({ hours: text('hours') }, cleanupInvalidFields);
    },
    () => ({ hours: '' }),
    text('unavailable')
  );
  const configErrors = useActionFieldErrors(configForm.form, messages, text('invalid'));
  const cleanupErrors = useActionFieldErrors(
    cleanupForm.form,
    { hours: text('hours') },
    text('invalid')
  );
  const resetConfig = configForm.form.reset,
    resetCleanup = cleanupForm.form.reset;
  const [changed, setChanged] = useState({ config: false, cleanup: false });
  const [uncertain, setUncertain] = useState({ config: false, cleanup: false });
  const [recovered, setRecovered] = useState({ config: false, cleanup: false });
  const recoveryLoading = useRef({ config: false, cleanup: false });
  const [action, setAction] = useState<TeamAction | null>(null),
    [notice, setNotice] = useState<'saved' | 'tested' | null>(null);
  const actionRef = useRef<TeamAction | null>(null),
    actionOwner = useRef<Owner>('config');
  const generation = useRef(0),
    validationBusy = useRef(false),
    dialogBusy = useRef(false);
  const [dialogPending, setDialogPending] = useState(false);
  const setPending = useCallback((pending: boolean) => {
    dialogBusy.current = pending;
    setDialogPending(pending);
  }, []);
  const closeAction = useCallback(() => {
    generation.current++;
    validationBusy.current = false;
    configForm.setValidationPending(false);
    cleanupForm.setValidationPending(false);
    actionRef.current = null;
    setAction(null);
    setPending(false);
  }, [configForm.setValidationPending, cleanupForm.setValidationPending, setPending]);
  const clearPrivate = useCallback(() => {
    closeAction();
    acceptedConfig.current = null;
    acceptedCleanup.current = null;
    resetConfig(emptyStorageDraft());
    resetCleanup({ hours: '' });
    setChanged({ config: false, cleanup: false });
    setUncertain({ config: false, cleanup: false });
    setRecovered({ config: false, cleanup: false });
    setNotice(null);
  }, [closeAction, resetConfig, resetCleanup]);
  const scope = useCatalogueScope(clearPrivate);
  const config = useCatalogueResource(scope, '/api/admin/storage/config', validStorageConfig);
  const cleanup = useCatalogueResource(
    scope,
    '/api/admin/storage/multipart-cleanup-policy',
    validCleanupPolicy
  );
  const configReady =
    !!config.data &&
    !config.loading &&
    !config.error &&
    !scope.denied &&
    !!acceptedConfig.current &&
    basis(acceptedConfig.current) === basis(config.data);
  const cleanupReady =
    !!cleanup.data &&
    !cleanup.loading &&
    !cleanup.error &&
    !scope.denied &&
    !!acceptedCleanup.current &&
    basis(acceptedCleanup.current) === basis(cleanup.data);
  const busy = configForm.pending || cleanupForm.pending || !!action;
  useEffect(
    () => () => {
      generation.current++;
      actionRef.current = null;
    },
    []
  );
  useEffect(() => {
    if (uncertain.config && config.loading) recoveryLoading.current.config = true;
    if (!config.data || config.loading || config.error) return;
    const previous = acceptedConfig.current;
    if (!previous) resetConfig(storageDraft(config.data));
    else if (basis(previous) !== basis(config.data)) {
      closeAction();
      setChanged((value) => ({ ...value, config: true }));
    }
    acceptedConfig.current = config.data;
    if (uncertain.config && recoveryLoading.current.config)
      setRecovered((value) => ({ ...value, config: true }));
  }, [config.data, config.loading, config.error, uncertain.config, closeAction, resetConfig]);
  useEffect(() => {
    if (uncertain.cleanup && cleanup.loading) recoveryLoading.current.cleanup = true;
    if (!cleanup.data || cleanup.loading || cleanup.error) return;
    const previous = acceptedCleanup.current;
    if (!previous) resetCleanup({ hours: String(cleanup.data.hours) });
    else if (basis(previous) !== basis(cleanup.data)) {
      closeAction();
      setChanged((value) => ({ ...value, cleanup: true }));
    }
    acceptedCleanup.current = cleanup.data;
    if (uncertain.cleanup && recoveryLoading.current.cleanup)
      setRecovered((value) => ({ ...value, cleanup: true }));
  }, [cleanup.data, cleanup.loading, cleanup.error, uncertain.cleanup, closeAction, resetCleanup]);
  function refresh(owner?: Owner) {
    if (dialogBusy.current) return;
    if (validationBusy.current || uncertain.config || uncertain.cleanup) closeAction();
    setNotice(null);
    if (scope.denied) scope.recover();
    else {
      if (owner !== 'cleanup') config.retry();
      if (owner !== 'config') cleanup.retry();
    }
  }
  function resetSaved(owner: Owner) {
    if (
      dialogBusy.current ||
      validationBusy.current ||
      actionRef.current ||
      (owner === 'config' ? !configReady : !cleanupReady) ||
      (uncertain[owner] && !recovered[owner])
    )
      return;
    closeAction();
    if (owner === 'config' && config.data) resetConfig(storageDraft(config.data));
    if (owner === 'cleanup' && cleanup.data) resetCleanup({ hours: String(cleanup.data.hours) });
    setChanged((value) => ({ ...value, [owner]: false }));
    setUncertain((value) => ({ ...value, [owner]: false }));
    setRecovered((value) => ({ ...value, [owner]: false }));
  }
  function unconfirmed() {
    const owner = actionOwner.current;
    setUncertain((value) => ({ ...value, [owner]: true }));
    setRecovered((value) => ({ ...value, [owner]: false }));
    recoveryLoading.current[owner] = false;
    if (owner === 'config') config.retry();
    else cleanup.retry();
  }
  async function prepare(kind: 'save' | 'test' | 'cleanup', event?: FormEvent) {
    event?.preventDefault();
    const owner: Owner = kind === 'cleanup' ? 'cleanup' : 'config';
    if (
      validationBusy.current ||
      actionRef.current ||
      scope.denied ||
      changed[owner] ||
      uncertain[owner] ||
      (owner === 'config' ? !configReady : !cleanupReady)
    )
      return;
    const epoch = generation.current;
    validationBusy.current = true;
    setNotice(null);
    const form = owner === 'config' ? configForm : cleanupForm;
    form.setValidationPending(true);
    try {
      let body: unknown;
      if (owner === 'config')
        await configForm.form.handleSubmit((value) => {
          body = storageCommand(value, config.data!.version);
        })();
      else
        await cleanupForm.form.handleSubmit((value) => {
          body = { hours: Number(value.hours), version: cleanup.data!.version };
        })();
      if (epoch !== generation.current || scope.denied || body === undefined) return;
      closeAction();
      actionOwner.current = owner;
      const next: TeamAction = {
        title: label(kind === 'cleanup' ? 'cleanupSave' : kind),
        description: label(
          kind === 'cleanup'
            ? 'cleanupDescription'
            : kind === 'save'
              ? 'saveDescription'
              : 'testDescription'
        ),
        path: `/api/admin/storage/${kind === 'cleanup' ? 'multipart-cleanup-policy' : kind === 'save' ? 'config' : 'test-connection'}`,
        method: kind === 'test' ? 'POST' : 'PUT',
        body,
        successStatus: 200,
        conflictMessage: label('changed'),
        forbiddenMessage: label('forbidden'),
        errorMessages: {
          'STORAGE:CONFIG_CHANGED': label('changed'),
          'STORAGE:CONNECTION_FAILED': label('connectionFailed'),
          'STORAGE:LOCATION_IN_USE': label('locationInUse'),
          'STORAGE:SECRET_REENTRY_REQUIRED': label('secretReentry'),
          'STORAGE:CREDENTIAL_PAIR_REQUIRED': label('credentialPair'),
          'STORAGE:ENCRYPTION_UNAVAILABLE': label('encryptionUnavailable'),
          'VALIDATION:INPUT_INVALID': label('invalid'),
        },
      };
      actionRef.current = next;
      setAction(next);
    } finally {
      if (epoch === generation.current) {
        validationBusy.current = false;
        form.setValidationPending(false);
      }
    }
  }
  const completionGeneration = generation.current;
  const owner = actionOwner.current;
  const draft = configForm.values,
    hours = cleanupForm.values.hours;
  const configDisabled = busy || !configReady || changed.config || uncertain.config;
  const cleanupDisabled = busy || !cleanupReady || changed.cleanup || uncertain.cleanup;
  const recovery = (section?: Owner) => (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={dialogPending || config.loading || cleanup.loading}
        onClick={() => refresh(section)}
      >
        {label('refresh')}
      </Button>
    </div>
  );
  const stateFeedback = (section: Owner) => (
    <>
      {(changed[section] || uncertain[section]) && (
        <Alert variant="destructive">{text(uncertain[section] ? 'unverified' : 'changed')}</Alert>
      )}
      {(changed[section] || uncertain[section]) && (
        <Button
          type="button"
          variant="outline"
          disabled={
            busy ||
            (section === 'config' ? !configReady : !cleanupReady) ||
            (uncertain[section] && !recovered[section])
          }
          onClick={() => resetSaved(section)}
        >
          {text('reset')}
        </Button>
      )}
    </>
  );
  return (
    <section
      className="mx-auto max-w-3xl space-y-5 p-4 md:p-6"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{label('title')}</h1>
          <p className="mt-2 text-muted-foreground">{label('description')}</p>
        </div>
        {recovery()}
      </div>
      {scope.denied && <p role="alert">{label('forbidden')}</p>}
      {notice && (
        <p role="status" className="rounded-md border p-3">
          {label(notice)}
        </p>
      )}
      {config.loading && <p role="status">{label('loading')}</p>}
      {config.error && (
        <Alert variant="destructive">
          {label('loadError')}{' '}
          <Button type="button" onClick={() => refresh('config')}>
            {label('reload')}
          </Button>
        </Alert>
      )}
      {!scope.denied && config.data && (
        <form
          noValidate
          aria-label={label('title')}
          aria-busy={configForm.pending || undefined}
          onSubmit={(event) => void prepare('save', event)}
          className="space-y-5"
        >
          <p className="text-sm text-muted-foreground">
            {label(config.data.version ? 'savedVersion' : 'deploymentVersion').replace(
              '{version}',
              numbers.number(config.data.version)
            )}
          </p>
          <p className="rounded-md border bg-muted/30 p-3 text-sm">{label('locationWarning')}</p>
          {stateFeedback('config')}
          {catalogueRootMessage(configForm.errors) && (
            <Alert variant="destructive">{catalogueRootMessage(configForm.errors)}</Alert>
          )}
          <fieldset disabled={configDisabled} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              {storageTextFields.map((field) => (
                <div key={field} className="space-y-2">
                  <Label htmlFor={`storage-${field}`}>{label(field)}</Label>
                  <Input
                    {...configForm.bind(field)}
                    id={`storage-${field}`}
                    dir="ltr"
                    value={draft[field]}
                    autoComplete="off"
                    spellCheck={false}
                    required={field === 'region' || field === 'bucket'}
                    maxLength={
                      field.includes('Endpoint') || field === 'endpoint'
                        ? 2048
                        : field === 'region'
                          ? 128
                          : field === 'bucket'
                            ? 255
                            : 256
                    }
                    onChange={(event) => {
                      configForm.field(field)[1](event.target.value);
                      setNotice(null);
                    }}
                  />
                  <CatalogueFieldFeedback
                    id={configForm.errorId(field)}
                    error={configForm.errors[field]}
                    message={messages[field]}
                  />
                </div>
              ))}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="storage-secret">{label('secret')}</Label>
                <Input
                  {...configForm.bind('secretAccessKey')}
                  id="storage-secret"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  maxLength={4096}
                  value={draft.secretAccessKey}
                  onChange={(event) => {
                    configForm.field('secretAccessKey')[1](event.target.value);
                    configForm.field('clearSecret')[1](false);
                    setNotice(null);
                  }}
                  aria-describedby={[
                    configForm.bind('secretAccessKey')['aria-describedby'],
                    'storage-secret-help',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
                <p id="storage-secret-help" className="text-sm text-muted-foreground">
                  {label(config.data.hasSecretKey ? 'secretStored' : 'secretMissing')}
                </p>
                <CatalogueFieldFeedback
                  id={configForm.errorId('secretAccessKey')}
                  error={configForm.errors.secretAccessKey}
                  message={messages.secretAccessKey}
                />
                {config.data.hasSecretKey && (
                  <div className="flex items-center gap-2">
                    <input
                      {...configForm.bind('clearSecret')}
                      id="storage-clear-secret"
                      type="checkbox"
                      checked={draft.clearSecret}
                      onChange={(event) => {
                        configForm.field('clearSecret')[1](event.target.checked);
                        configForm.field('secretAccessKey')[1]('');
                        setNotice(null);
                      }}
                    />
                    <Label htmlFor="storage-clear-secret">{label('clearSecret')}</Label>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                {...configForm.bind('forcePathStyle')}
                id="storage-path-style"
                type="checkbox"
                checked={draft.forcePathStyle}
                onChange={(event) => configForm.field('forcePathStyle')[1](event.target.checked)}
              />
              <Label htmlFor="storage-path-style">{label('forcePathStyle')}</Label>
            </div>
            <p className="text-sm text-muted-foreground">{label('endpointHelp')}</p>
            <CatalogueFieldFeedback
              id={configForm.errorId('forcePathStyle')}
              error={configForm.errors.forcePathStyle}
              message={messages.forcePathStyle}
            />
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <CatalogueSaveButton
              label={label('save')}
              pending={configForm.pending}
              disabled={configDisabled}
            />
            <Button
              type="button"
              variant="outline"
              disabled={configDisabled}
              onClick={() => void prepare('test')}
            >
              {label('test')}
            </Button>
          </div>
        </form>
      )}
      {cleanup.loading && <p role="status">{label('loading')}</p>}
      {cleanup.error && (
        <Alert variant="destructive">
          {label('loadError')}{' '}
          <Button type="button" onClick={() => refresh('cleanup')}>
            {label('reload')}
          </Button>
        </Alert>
      )}
      {!scope.denied && cleanup.data && (
        <form
          noValidate
          aria-label={label('cleanupTitle')}
          aria-busy={cleanupForm.pending || undefined}
          onSubmit={(event) => void prepare('cleanup', event)}
          className="space-y-3 rounded-xl border p-4"
        >
          <h2 className="font-semibold">{label('cleanupTitle')}</h2>
          <p className="text-sm text-muted-foreground">{label('cleanupDescription')}</p>
          {stateFeedback('cleanup')}
          {catalogueRootMessage(cleanupForm.errors) && (
            <Alert variant="destructive">{catalogueRootMessage(cleanupForm.errors)}</Alert>
          )}
          <fieldset disabled={cleanupDisabled} className="max-w-xs space-y-2">
            <Label htmlFor="storage-cleanup-hours">{label('cleanupHours')}</Label>
            <Input
              {...cleanupForm.bind('hours')}
              id="storage-cleanup-hours"
              type="number"
              min={1}
              max={168}
              required
              value={hours}
              onChange={(event) => cleanupForm.field('hours')[1](event.target.value)}
            />
            <CatalogueFieldFeedback
              id={cleanupForm.errorId('hours')}
              error={cleanupForm.errors.hours}
              message={text('hours')}
            />
          </fieldset>
          <CatalogueSaveButton
            label={label('cleanupSave')}
            pending={cleanupForm.pending}
            disabled={cleanupDisabled}
          />
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={closeAction}
          onDenied={scope.deny}
          onPendingChange={setPending}
          {...(action.method === 'PUT' ? { onUnconfirmed: unconfirmed } : {})}
          onValidationError={(fields) =>
            owner === 'config' ? configErrors(fields) : cleanupErrors(fields)
          }
          confirmationDisabled={
            scope.denied ||
            changed[owner] ||
            uncertain[owner] ||
            (owner === 'config' ? !configReady : !cleanupReady)
          }
          summary={recovery(owner)}
          onSuccess={async (result) => {
            if (
              completionGeneration !== generation.current ||
              actionRef.current !== action ||
              scope.denied
            )
              return;
            if (action.method === 'POST') {
              if (
                !result ||
                typeof result !== 'object' ||
                !('success' in result) ||
                result.success !== true
              )
                throw new Error('Invalid connection receipt');
              setNotice('tested');
              closeAction();
              return;
            }
            if (owner === 'config') {
              if (
                !config.data ||
                !matchesStorageReceipt(
                  result,
                  action.body as ReturnType<typeof storageCommand>,
                  config.data
                ) ||
                !validStorageConfig(result)
              )
                throw new Error('Invalid storage receipt');
              acceptedConfig.current = result;
              config.accept(result);
              resetConfig(storageDraft(result));
              config.retry();
            } else {
              const command = action.body as CleanupPolicyView;
              if (
                !validCleanupPolicy(result) ||
                result.hours !== command.hours ||
                result.version !== command.version + 1
              )
                throw new Error('Invalid cleanup receipt');
              acceptedCleanup.current = result;
              cleanup.accept(result);
              resetCleanup({ hours: String(result.hours) });
              cleanup.retry();
            }
            setNotice('saved');
            closeAction();
          }}
        />
      )}
    </section>
  );
}

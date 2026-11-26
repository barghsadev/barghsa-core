import { confirmationText } from '@barghsa/i18n/confirmation';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/admin-ui';
import { storagePolicyFormText, storageRecoveryText } from '@barghsa/i18n/storage-policy-forms';
import {
  LoadingStatus,
  Alert,
  Badge,
  Button,
  Input,
  Label,
  ListRefreshButton,
  buttonVariants,
} from '@barghsa/ui';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { RecordNumberInput } from '../components/RecordNumberInput.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import {
  CatalogueFieldFeedback,
  SettingsValueSkeleton,
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
  validStorageConnection,
  storageConnectionFields,
  storageConnectionBasis,
  validStorageConfig,
  validCleanupPolicy,
  validCleanupSettings,
  cleanupSettingsBasis,
  cleanupInvalidFields,
  type StorageConfigView,
  type StorageConnectionSettings,
  type StorageDraft,
  type CleanupDraft,
  type CleanupSettings,
  type CleanupPolicyView,
} from '../lib/storage-policy-form.js';

const StorageRecovery = lazy(async () => {
  const { default: Recovery } = await import('../components/ConfigRecovery.js');
  return { default: Recovery<StorageConnectionSettings> };
});
const CleanupRecovery = lazy(async () => {
  const { default: Recovery } = await import('../components/ConfigRecovery.js');
  return { default: Recovery<CleanupSettings> };
});
type Owner = 'config' | 'cleanup';
const storageExamples = {
  endpoint: 'https://objects.example.com',
  region: 'eu-central-1',
  bucket: 'customer-documents',
  privateEndpointUrl: 'https://private.example.com',
  publicEndpointUrl: 'https://files.example.com',
} satisfies Partial<Record<(typeof storageTextFields)[number], string>>;
type StorageSection = 'overview' | 'edit' | 'cleanup';
type ConnectionCheck = {
  at: string;
  state: 'tested' | 'connectionFailed' | 'unknown';
  saved: boolean;
};
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
export default function AdminStorageConfig({ section }: { section?: StorageSection } = {}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const [connectionCheck, setConnectionCheck] = useState<ConnectionCheck | null>(null);
  const time = useAccountTime(locale, !!connectionCheck);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (section && section !== 'overview') heading.current?.focus({ preventScroll: true });
  }, [section]);
  const showConfig = section !== 'cleanup';
  const showCleanup = !section || section === 'cleanup';
  const label = (key: string) => t(`admin.storage.${key}`, locale);
  const text = (key: Parameters<typeof storagePolicyFormText>[0]) =>
    storagePolicyFormText(key, locale);
  const recoveryLabel = (key: string, owner: Owner = 'config') =>
    storageRecoveryText(key, locale, owner) ??
    (key === 'retry' ? label('reload') : key === 'unverified' ? text('unverified') : label(key));
  const cleanupRecoveryLabel = (key: string) => recoveryLabel(key, 'cleanup');
  const acceptedConfig = useRef<StorageConfigView | null>(null),
    acceptedCleanup = useRef<CleanupPolicyView | null>(null);
  const [openRecovery, setOpenRecovery] = useState<Owner | null>(null);
  const [storageRecoveryBusy, setStorageRecoveryBusy] = useState(false);
  const recoveryBusy = useRef(false);
  const setRecoveryBusy = useCallback((busy: boolean) => {
    recoveryBusy.current = busy;
    setStorageRecoveryBusy(busy);
  }, []);
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
    setOpenRecovery(null);
    setRecoveryBusy(false);
    setChanged({ config: false, cleanup: false });
    setUncertain({ config: false, cleanup: false });
    setRecovered({ config: false, cleanup: false });
    setNotice(null);
    setConnectionCheck(null);
  }, [closeAction, resetConfig, resetCleanup, setRecoveryBusy]);
  const scope = useCatalogueScope(clearPrivate);
  const config = useCatalogueResource(
    scope,
    showConfig ? '/api/admin/storage/config' : null,
    validStorageConfig
  );
  const cleanup = useCatalogueResource(
    scope,
    showCleanup ? '/api/admin/storage/multipart-cleanup-policy' : null,
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
      setConnectionCheck(null);
      if (section === 'overview') resetConfig(storageDraft(config.data));
      else setChanged((value) => ({ ...value, config: true }));
    }
    acceptedConfig.current = config.data;
    if (uncertain.config && recoveryLoading.current.config)
      setRecovered((value) => ({ ...value, config: true }));
  }, [
    config.data,
    config.loading,
    config.error,
    uncertain.config,
    closeAction,
    resetConfig,
    section,
  ]);
  useEffect(() => {
    if (uncertain.cleanup && cleanup.loading) recoveryLoading.current.cleanup = true;
    if (!cleanup.data || cleanup.loading || cleanup.error) return;
    const previous = acceptedCleanup.current;
    if (!previous) resetCleanup({ hours: String(cleanup.data.hours ?? '') });
    else if (basis(previous) !== basis(cleanup.data)) {
      closeAction();
      setChanged((value) => ({ ...value, cleanup: true }));
    }
    acceptedCleanup.current = cleanup.data;
    if (uncertain.cleanup && recoveryLoading.current.cleanup)
      setRecovered((value) => ({ ...value, cleanup: true }));
  }, [cleanup.data, cleanup.loading, cleanup.error, uncertain.cleanup, closeAction, resetCleanup]);
  function refresh(owner?: Owner) {
    if (dialogBusy.current || recoveryBusy.current) return;
    if (validationBusy.current || uncertain.config || uncertain.cleanup) closeAction();
    setNotice(null);
    if (scope.denied) scope.recover();
    else {
      if (owner !== 'cleanup' && showConfig) config.retry();
      if (owner !== 'config' && showCleanup) cleanup.retry();
    }
  }
  function resetSaved(owner: Owner) {
    if (
      dialogBusy.current ||
      recoveryBusy.current ||
      validationBusy.current ||
      actionRef.current ||
      (owner === 'config' ? !configReady : !cleanupReady) ||
      (uncertain[owner] && !recovered[owner])
    )
      return;
    closeAction();
    if (owner === 'config' && config.data) resetConfig(storageDraft(config.data));
    if (owner === 'cleanup' && cleanup.data)
      resetCleanup({ hours: String(cleanup.data.hours ?? '') });
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
  function recordCheck(state: ConnectionCheck['state']) {
    if (section)
      setConnectionCheck({ at: new Date().toISOString(), state, saved: section === 'overview' });
  }
  async function prepare(kind: 'save' | 'test' | 'cleanup', event?: FormEvent) {
    event?.preventDefault();
    const owner: Owner = kind === 'cleanup' ? 'cleanup' : 'config';
    if (
      validationBusy.current ||
      recoveryBusy.current ||
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
      const actionGeneration = generation.current;
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
          'STORAGE:CONNECTION_FAILED': () => {
            if (
              kind === 'test' &&
              generation.current === actionGeneration &&
              actionRef.current === next
            )
              recordCheck('connectionFailed');
            return label('connectionFailed');
          },
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
  const configDisabled =
    busy || storageRecoveryBusy || !configReady || changed.config || uncertain.config;
  const cleanupDisabled =
    busy || storageRecoveryBusy || !cleanupReady || changed.cleanup || uncertain.cleanup;
  const recovery = (section?: Owner) => (
    <ListRefreshButton
      label={label('refresh')}
      disabled={dialogPending || storageRecoveryBusy}
      refreshing={config.loading || cleanup.loading}
      onClick={() => refresh(section)}
    />
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
  const storageField = (field: (typeof storageTextFields)[number]) => (
    <div key={field} className={recordEditorField}>
      <Label htmlFor={`storage-${field}`}>{label(field)}</Label>
      <Input
        {...configForm.bind(field)}
        id={`storage-${field}`}
        dir="ltr"
        placeholder={field === 'accessKeyId' ? undefined : storageExamples[field]}
        value={draft[field]}
        autoComplete="off"
        spellCheck={false}
        required={field === 'region' || field === 'bucket'}
        aria-required={field === 'region' || field === 'bucket' || undefined}
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
        compact
      />
    </div>
  );
  return (
    <section
      className={
        section === 'overview' ? 'min-w-0 space-y-5' : 'mx-auto w-full max-w-3xl space-y-4'
      }
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1
            ref={heading}
            tabIndex={section && section !== 'overview' ? -1 : undefined}
            className="text-2xl font-semibold focus-visible:shadow-none! focus-visible:outline-hidden!"
          >
            {section === 'edit'
              ? text('connectionSettings')
              : section === 'cleanup'
                ? label('cleanupTitle')
                : label('title')}
          </h1>
          {section !== 'cleanup' && (
            <p className="mt-1 text-sm text-muted-foreground">{label('description')}</p>
          )}
        </div>
        {recovery()}
      </div>
      {section && (
        <nav
          aria-label={text('storageNavigation')}
          className="flex flex-wrap gap-1 rounded-lg border bg-card p-1.5"
        >
          <Link
            to="/admin/storage"
            activeOptions={{ exact: true }}
            className={buttonVariants({
              variant: section !== 'cleanup' ? 'secondary' : 'ghost',
              className: 'min-h-11',
            })}
          >
            {text('connection')}
          </Link>
          <Link
            to="/admin/storage/$section"
            params={{ section: 'cleanup' }}
            className={buttonVariants({
              variant: section === 'cleanup' ? 'secondary' : 'ghost',
              className: 'min-h-11',
            })}
          >
            {label('cleanupTitle')}
          </Link>
        </nav>
      )}
      {scope.denied && <p role="alert">{label('forbidden')}</p>}
      {notice && (
        <p role="status" className="rounded-md border p-3">
          {label(notice)}
        </p>
      )}
      {connectionCheck && (
        <div role="status" className="max-w-3xl space-y-1 rounded-lg border bg-card p-4 text-sm">
          <p className="font-medium">{text('lastConnectionCheck')}</p>
          <p className="text-muted-foreground">
            {text(connectionCheck.saved ? 'checkedSavedConnection' : 'checkedProposedConnection')}
            {' · '}
            <time dateTime={connectionCheck.at}>{time.format(connectionCheck.at)}</time>
          </p>
          <p>
            {connectionCheck.state === 'unknown'
              ? text('checkUnconfirmed')
              : label(connectionCheck.state)}
          </p>
        </div>
      )}
      {config.loading &&
        (config.data ? (
          <LoadingStatus>{label('loading')}</LoadingStatus>
        ) : (
          <SettingsValueSkeleton label={label('loading')} count={4} />
        ))}
      {config.error && (
        <Alert variant="destructive">
          {label('loadError')}{' '}
          <Button type="button" onClick={() => refresh('config')}>
            {label('reload')}
          </Button>
        </Alert>
      )}
      {!scope.denied && config.data && section === 'overview' && (
        <div className="max-w-3xl space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{text('connection')}</h2>
            <Badge variant="secondary">
              {label(config.data.version ? 'savedVersion' : 'deploymentVersion').replace(
                '{version}',
                numbers.number(config.data.version)
              )}
            </Badge>
          </div>
          <dl className="grid gap-4 rounded-lg bg-muted/45 p-3 text-sm sm:grid-cols-2">
            {storageConnectionFields.map((field) => (
              <div key={field} className="min-w-0">
                <dt className="text-muted-foreground">{label(field)}</dt>
                <dd className="mt-1 font-medium [overflow-wrap:anywhere]">
                  <bdi>{config.data?.[field] || '—'}</bdi>
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-muted-foreground">{label('forcePathStyle')}</dt>
              <dd className="mt-1 font-medium">
                {recoveryLabel(config.data.forcePathStyle ? 'recoveryOn' : 'recoveryOff')}
              </dd>
            </div>
          </dl>
          <dl className="grid gap-4 border-t pt-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{label('accessKeyId')}</dt>
              <dd className="mt-1 font-medium">
                {config.data.accessKeyId.length > 4 ? (
                  <bdi>
                    {text('accessKeyEnding').replace('{suffix}', config.data.accessKeyId.slice(-4))}
                  </bdi>
                ) : (
                  text(config.data.accessKeyId ? 'credentialConfigured' : 'credentialMissing')
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{text('credentialStatus')}</dt>
              <dd className="mt-1 font-medium">
                {text(config.data.hasSecretKey ? 'credentialConfigured' : 'credentialMissing')}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/storage/$section"
              params={{ section: 'edit' }}
              className={buttonVariants({ className: 'min-h-11' })}
            >
              {text('connectionSettings')}
            </Link>
            <Button
              type="button"
              variant="outline"
              disabled={configDisabled}
              onClick={() => void prepare('test')}
            >
              {label('test')}
            </Button>
          </div>
        </div>
      )}
      {!scope.denied && config.data && section !== 'overview' && (
        <form
          noValidate
          aria-label={label('title')}
          aria-busy={configForm.pending || undefined}
          onSubmit={(event) => void prepare('save', event)}
          onChange={() => setConnectionCheck(null)}
          className={recordEditorSurface}
        >
          <div className="space-y-2 border-b bg-muted/30 px-4 py-3 sm:px-6">
            <p className="text-sm font-medium">
              {label(config.data.version ? 'savedVersion' : 'deploymentVersion').replace(
                '{version}',
                numbers.number(config.data.version)
              )}
            </p>
            <p className="text-sm text-muted-foreground">{label('locationWarning')}</p>
            {stateFeedback('config')}
            {catalogueRootMessage(configForm.errors) && (
              <Alert variant="destructive">{catalogueRootMessage(configForm.errors)}</Alert>
            )}
          </div>
          <fieldset disabled={configDisabled} className="m-0 min-w-0 border-0 p-0">
            <RecordEditorSection title={text('connection')} description={text('connectionHelp')}>
              {storageField('endpoint')}
              <div className={recordEditorGrid}>
                {storageField('region')}
                {storageField('bucket')}
              </div>
            </RecordEditorSection>
            <RecordEditorSection
              title={text('endpointOverrides')}
              description={label('endpointHelp')}
            >
              <div className={recordEditorGrid}>
                {storageField('privateEndpointUrl')}
                {storageField('publicEndpointUrl')}
              </div>
              <div className="flex items-center gap-2">
                <input
                  {...configForm.bind('forcePathStyle')}
                  id="storage-path-style"
                  type="checkbox"
                  checked={draft.forcePathStyle}
                  onChange={(event) => configForm.field('forcePathStyle')[1](event.target.checked)}
                />
                <Label className="touch-label" htmlFor="storage-path-style">
                  {label('forcePathStyle')}
                </Label>
              </div>
              <CatalogueFieldFeedback
                id={configForm.errorId('forcePathStyle')}
                error={configForm.errors.forcePathStyle}
                message={messages.forcePathStyle}
                compact
              />
            </RecordEditorSection>
            <RecordEditorSection title={text('credentials')}>
              <div className={recordEditorGrid}>
                {storageField('accessKeyId')}
                <div className={recordEditorField}>
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
                    compact
                  />
                </div>
              </div>
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
                  <Label className="touch-label" htmlFor="storage-clear-secret">
                    {label('clearSecret')}
                  </Label>
                </div>
              )}
            </RecordEditorSection>
          </fieldset>
          <RecordEditorActions>
            <Button
              type="button"
              variant="outline"
              disabled={configDisabled}
              onClick={() => void prepare('test')}
            >
              {label('test')}
            </Button>
            <CatalogueSaveButton
              label={label('save')}
              pending={configForm.pending}
              disabled={configDisabled}
            />
          </RecordEditorActions>
        </form>
      )}
      {!scope.denied && config.data && (
        <Button
          type="button"
          variant="outline"
          aria-expanded={openRecovery === 'config'}
          aria-controls={openRecovery === 'config' ? 'storage-recovery' : undefined}
          disabled={busy || storageRecoveryBusy || !configReady}
          onClick={() => setOpenRecovery((visible) => (visible === 'config' ? null : 'config'))}
        >
          {recoveryLabel('recoveryTitle')}
        </Button>
      )}
      {openRecovery === 'config' && !scope.denied && config.data && (
        <div id="storage-recovery">
          <Suspense fallback={<LoadingStatus>{recoveryLabel('recoveryLoading')}</LoadingStatus>}>
            <StorageRecovery
              key={config.data.version}
              path="/api/admin/storage/config"
              valid={validStorageConnection}
              basis={storageConnectionBasis}
              label={recoveryLabel}
              disabled={busy || !configReady || uncertain.config}
              onBusyChange={setRecoveryBusy}
              onDenied={scope.deny}
              onActivated={config.retry}
              errorMessages={{
                'STORAGE:ENDPOINT_UNAPPROVED': recoveryLabel('recoveryEndpoint'),
                'STORAGE:SECRET_REENTRY_REQUIRED': recoveryLabel('recoveryReentry'),
                'STORAGE:LOCATION_IN_USE': recoveryLabel('recoveryLocationInUse'),
                'STORAGE:CONNECTION_FAILED': label('connectionFailed'),
              }}
              renderValues={(value) => (
                <dl className="space-y-2">
                  {storageConnectionFields.map((field) => (
                    <div key={field} className="flex flex-wrap gap-x-2">
                      <dt className="font-medium">{label(field)}</dt>
                      <dd>
                        <bdi className="break-all">{value[field] || '—'}</bdi>
                      </dd>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium">{label('forcePathStyle')}</dt>
                    <dd>{recoveryLabel(value.forcePathStyle ? 'recoveryOn' : 'recoveryOff')}</dd>
                  </div>
                </dl>
              )}
            />
          </Suspense>
        </div>
      )}
      {cleanup.loading &&
        (cleanup.data ? (
          <LoadingStatus>{text('cleanupLoading')}</LoadingStatus>
        ) : (
          <SettingsValueSkeleton label={text('cleanupLoading')} count={1} />
        ))}
      {cleanup.error && (
        <Alert variant="destructive">
          {text('cleanupLoadError')}{' '}
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
          className={recordEditorSurface}
        >
          <div className="space-y-2 px-4 py-4 sm:px-6">
            {!section && <h2 className="font-semibold">{label('cleanupTitle')}</h2>}
            <p className="text-sm text-muted-foreground">{label('cleanupDescription')}</p>
            {cleanup.data.hours === null && (
              <Alert variant="destructive">{text('cleanupInvalidPolicy')}</Alert>
            )}
            {stateFeedback('cleanup')}
            {catalogueRootMessage(cleanupForm.errors) && (
              <Alert variant="destructive">{catalogueRootMessage(cleanupForm.errors)}</Alert>
            )}
            <fieldset disabled={cleanupDisabled} className="m-0 min-w-0 space-y-1 border-0 p-0">
              <Label htmlFor="storage-cleanup-hours">{label('cleanupHours')}</Label>
              <div className="flex min-w-0 items-center gap-3">
                <RecordNumberInput
                  {...cleanupForm.bind('hours')}
                  className="w-28 min-w-0"
                  id="storage-cleanup-hours"
                  locale={locale}
                  min={1}
                  max={168}
                  required
                  aria-required="true"
                  value={hours}
                  onChange={(value) => cleanupForm.field('hours')[1](value)}
                />
                {cleanup.data.hours !== null && (
                  <p className="min-w-0 border-s ps-3 text-sm text-muted-foreground">
                    {text('savedCleanupHours').replace(
                      '{hours}',
                      numbers.number(cleanup.data.hours)
                    )}
                  </p>
                )}
              </div>
              <CatalogueFieldFeedback
                id={cleanupForm.errorId('hours')}
                error={cleanupForm.errors.hours}
                message={text('hours')}
              />
            </fieldset>
          </div>
          <RecordEditorActions>
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-11 max-w-full py-2 text-center whitespace-normal"
              aria-expanded={openRecovery === 'cleanup'}
              aria-controls={openRecovery === 'cleanup' ? 'cleanup-recovery' : undefined}
              disabled={busy || storageRecoveryBusy || !cleanupReady}
              onClick={() =>
                setOpenRecovery((visible) => (visible === 'cleanup' ? null : 'cleanup'))
              }
            >
              {cleanupRecoveryLabel('recoveryTitle')}
            </Button>
            <CatalogueSaveButton
              label={label('cleanupSave')}
              pending={cleanupForm.pending}
              disabled={cleanupDisabled}
            />
          </RecordEditorActions>
        </form>
      )}
      {openRecovery === 'cleanup' && !scope.denied && cleanup.data && (
        <div id="cleanup-recovery">
          <Suspense
            fallback={<LoadingStatus>{cleanupRecoveryLabel('recoveryLoading')}</LoadingStatus>}
          >
            <CleanupRecovery
              key={cleanup.data.version}
              path="/api/admin/storage/multipart-cleanup-policy"
              valid={validCleanupSettings}
              basis={cleanupSettingsBasis}
              label={cleanupRecoveryLabel}
              disabled={busy || !cleanupReady || uncertain.cleanup}
              onBusyChange={setRecoveryBusy}
              onDenied={scope.deny}
              onActivated={cleanup.retry}
              renderValues={(value) => (
                <dl className="flex flex-wrap gap-x-2">
                  <dt className="font-medium">{label('cleanupHours')}</dt>
                  <dd>{numbers.number(value.hours)}</dd>
                </dl>
              )}
            />
          </Suspense>
        </div>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={closeAction}
          onDenied={scope.deny}
          onPendingChange={setPending}
          onUnconfirmed={action.method === 'PUT' ? unconfirmed : () => recordCheck('unknown')}
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
              if (section) recordCheck('tested');
              else setNotice('tested');
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
              setConnectionCheck(null);
              config.accept(result);
              resetConfig(storageDraft(result));
              config.retry();
            } else {
              const command = action.body as CleanupPolicyView;
              if (
                !validCleanupPolicy(result) ||
                result.hours === null ||
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
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </section>
  );
}

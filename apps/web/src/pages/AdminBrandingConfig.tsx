import { useCommandFeedback } from '../hooks/useCommandFeedback.js';
import {
  DEFAULT_BRAND_CONFIG,
  brandColor,
  getBrandTextColor,
  BRAND_SURFACES,
} from '../lib/brand-config.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  LoadingSkeleton,
  LoadingStatus,
  Button,
  Input,
  ListRefreshButton,
  NativeSelect,
  NativeSelectOption,
  PageHeader,
} from '@barghsa/ui';
import {
  getContrastForeground,
  useBrandConfig,
  parseBrandConfig,
  type BrandConfig,
} from '../providers/BrandThemeProvider.js';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { uploadBrandingLogo } from '../lib/branding-logo-upload.js';
import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { brandingText } from '@barghsa/i18n/branding';
import { t as authText } from '@barghsa/i18n/auth';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { Bell, CircleUserRound } from 'lucide-react';
import { shellText } from '@barghsa/i18n/shell';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { ConfigPreviewCard } from '../components/ConfigPreviewCard.js';
import { VersionedSettingsCard } from '../components/VersionedSettingsCard.js';
import { AuditLogViewer } from '../components/AuditLogViewer.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import {
  parseConfigDto,
  validBrandConfig,
  validBrandHistory,
  coherentBrandHistory,
  brandingBasis,
  brandConfigCommand,
  acceptBrandRevision,
  type BrandConfigDto,
} from '../lib/branding-settings.js';
import { t } from '@barghsa/i18n/admin-ui';
import { resolveTheme } from '../lib/theme.js';
import {
  RecordEditorActions,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = DEFAULT_BRAND_CONFIG;

const brandNames = [
  { key: 'appTitle', id: 'adminbrandingconfig-field-2', language: 'en', direction: 'ltr' },
  { key: 'appTitleFa', id: 'branding-title-fa', language: 'fa', direction: 'rtl' },
] as const;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Color picker component
// ---------------------------------------------------------------------------

const palettes = [
  {
    title: 'lightPalette',
    fields: [
      ['primary', 'primaryColor'],
      ['secondary', 'secondaryColor'],
      ['accent', 'accentColor'],
      ['background', 'backgroundColor'],
    ],
  },
  {
    title: 'darkPalette',
    fields: [
      ['darkPrimaryColor', 'darkPrimaryColor', 'primaryColor'],
      ['darkSecondaryColor', 'darkSecondaryColor', 'secondaryColor'],
      ['darkAccentColor', 'darkAccentColor', 'accentColor'],
      ['darkBackground', 'darkBackgroundColor'],
    ],
  },
] as const;

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const controlId = useId();
  const locale = useLocale();
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5">
      <label htmlFor={controlId} className="col-span-2 text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={controlId}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="size-11 cursor-pointer rounded-md border border-input p-0.5"
      />
      <input
        aria-label={brandingText('hex', locale).replace('{label}', label)}
        type="text"
        dir="ltr"
        spellCheck={false}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 font-mono text-sm text-foreground"
        placeholder="#RRGGBB"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminBrandingConfig({
  routeEditing,
  onEditingChange,
}: {
  routeEditing?: boolean;
  onEditingChange?: (open: boolean) => void;
} = {}) {
  const [previewMode, setPreviewMode] = useState<'auto' | 'light' | 'dark'>('auto');
  const [previewSurface, setPreviewSurface] = useState<'workspace' | 'signin'>('workspace');
  const [previewLanguage, setPreviewLanguage] = useState<'fa' | 'en' | null>(null);
  const [config, setConfig] = useState<BrandConfig>(DEFAULT_CONFIG);
  const locale = useLocale();
  const text = (key: Parameters<typeof brandingText>[0]) => brandingText(key, locale);
  const timezone = useTimezone();
  const numbers = useNumberFormatting(locale);
  const versionText = (version: number) => numbers.number(version, { useGrouping: false });
  const [action, setAction] = useState<TeamAction | null>(null);
  const [pendingAction, setPendingAction] = useState<TeamAction | null>(null);
  const [requiredRead, setRequiredRead] = useState<{
    config: number;
    history: number;
    publishedId: string | undefined;
  } | null>(null);
  const [localEditing, setLocalEditing] = useState(false),
    [needsReset, setNeedsReset] = useState(false);
  const editing = routeEditing ?? localEditing;
  const setEditing = onEditingChange ?? setLocalEditing;
  const accepted = useRef<BrandConfigDto | null>(null),
    generation = useRef(0),
    actionRef = useRef<TeamAction | null>(null);
  const word = (key: string) => t(`admin.settings.${key}`, locale);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  useCommandFeedback({
    success: message?.type === 'success' ? message.text : null,
    error: message?.type === 'error' ? message.text : null,
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploadKey, setLogoUploadKey] = useState<string | null>(null);
  const [logoDarkFile, setLogoDarkFile] = useState<File | null>(null);
  const [logoDarkPreview, setLogoDarkPreview] = useState<string | null>(null);
  const [logoDarkUploadKey, setLogoDarkUploadKey] = useState<string | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [faviconUploadKey, setFaviconUploadKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadRequest = useRef<AbortController | null>(null);
  useEffect(() => () => uploadRequest.current?.abort(), []);
  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);
  useEffect(() => {
    if (!faviconFile) {
      setFaviconPreview(null);
      return;
    }
    const url = URL.createObjectURL(faviconFile);
    setFaviconPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [faviconFile]);

  useEffect(() => {
    if (!logoDarkFile) {
      setLogoDarkPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoDarkFile);
    setLogoDarkPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoDarkFile]);

  const closeAction = useCallback(() => {
    generation.current++;
    actionRef.current = null;
    setAction(null);
  }, []);
  const clear = useCallback(() => {
    closeAction();
    setRequiredRead(null);
    uploadRequest.current?.abort();
    setUploading(false);
    accepted.current = null;
    setLogoFile(null);
    setLogoUploadKey(null);
    setLogoDarkFile(null);
    setLogoDarkUploadKey(null);
    setFaviconFile(null);
    setFaviconUploadKey(null);
    setMessage(null);
    setConfig(DEFAULT_CONFIG);
    setEditing(false);
    setNeedsReset(false);
  }, [closeAction, setEditing]);
  const scope = useCatalogueScope(clear);
  const currentRead = useCatalogueResource(scope, '/api/admin/branding/config', validBrandConfig);
  const historyRead = useCatalogueResource(scope, '/api/admin/branding/configs', validBrandHistory);
  const activeConfig = currentRead.data,
    history = historyRead.data ?? [],
    published = history.find((row) => row.status === 'active') ?? null;
  const loading = currentRead.loading,
    loadError = currentRead.error;
  const coherent =
    !!activeConfig && !!historyRead.data && coherentBrandHistory(activeConfig, historyRead.data);
  const readsReady =
    !scope.denied && !loading && !loadError && !historyRead.loading && !historyRead.error;
  const historyMismatch = readsReady && !coherent;
  const coherentRead = readsReady && coherent;
  const ready = coherentRead && requiredRead === null;
  const commandPending = action !== null && action === pendingAction;
  const draftInfo =
    activeConfig?.status === 'draft' && activeConfig.version > 0 ? activeConfig : null;
  const work = useRef({
    config,
    editing,
    logoUploadKey,
    logoDarkUploadKey,
    faviconUploadKey,
    ready,
  });
  work.current = { config, editing, logoUploadKey, logoDarkUploadKey, faviconUploadKey, ready };
  useEffect(() => {
    if (
      activeConfig &&
      accepted.current &&
      brandingBasis(activeConfig) !== brandingBasis(accepted.current)
    )
      closeAction();
  }, [activeConfig, closeAction]);
  useEffect(
    () => () => {
      generation.current++;
      actionRef.current = null;
    },
    []
  );
  useEffect(() => {
    if (
      !requiredRead ||
      !coherentRead ||
      (currentRead.readAttempt ?? -1) < requiredRead.config ||
      (historyRead.readAttempt ?? -1) < requiredRead.history
    )
      return;
    if (published && published.id !== requiredRead.publishedId)
      window.dispatchEvent(new Event('barghsa:branding-activated'));
    closeAction();
    setRequiredRead(null);
  }, [
    requiredRead,
    coherentRead,
    currentRead.readAttempt,
    historyRead.readAttempt,
    published,
    closeAction,
  ]);
  useEffect(() => {
    if (!ready || !activeConfig) return;
    const previous = accepted.current;
    if (!previous || brandingBasis(previous) !== brandingBasis(activeConfig)) {
      closeAction();
      if (
        previous &&
        work.current.editing &&
        (work.current.logoUploadKey ||
          work.current.logoDarkUploadKey ||
          work.current.faviconUploadKey ||
          JSON.stringify(work.current.config) !== JSON.stringify(parseBrandConfig(previous.config)))
      )
        setNeedsReset(true);
      else {
        setConfig(parseBrandConfig(activeConfig.config)!);
        setLogoFile(null);
        setLogoUploadKey(null);
        setLogoDarkFile(null);
        setLogoDarkUploadKey(null);
        setFaviconFile(null);
        setFaviconUploadKey(null);
        setNeedsReset(false);
      }
      accepted.current = activeConfig;
    }
  }, [ready, activeConfig, closeAction]);
  function refresh() {
    if (scope.denied) scope.recover();
    else {
      currentRead.retry();
      historyRead.retry();
    }
  }
  function resetEditor() {
    if (!ready || !activeConfig) return;
    setConfig(parseBrandConfig(activeConfig.config)!);
    setLogoFile(null);
    setLogoUploadKey(null);
    setLogoDarkFile(null);
    setLogoDarkUploadKey(null);
    setFaviconFile(null);
    setFaviconUploadKey(null);
    setNeedsReset(false);
    setMessage(null);
  }
  function prepare(next: TeamAction) {
    if (!ready || needsReset || uploading || actionRef.current) return;
    setMessage(null);
    actionRef.current = next;
    setAction(next);
  }
  const completionGeneration = generation.current,
    completionScope = scope.version;
  const updateConfig = useCallback(
    (key: keyof BrandConfig, value: string | number | boolean | null) => {
      setMessage(null);
      setConfig((prev) => ({
        ...prev,
        [key]: value,
        ...(key === 'themeMode' ? { darkMode: value === 'dark' } : {}),
      }));
    },
    []
  );

  const handleSave = () => {
    if (!activeConfig || !editing || !isDirty || !validConfig) return;
    prepare({
      title: text('save'),
      description: text('saveConfirm'),
      path: '/api/admin/branding/config',
      method: 'PUT',
      body: {
        config: brandConfigCommand(config),
        expectedVersion: activeConfig.version,
        ...(logoUploadKey ? { logoUploadKey } : {}),
        ...(logoDarkUploadKey ? { logoDarkUploadKey } : {}),
        ...(faviconUploadKey ? { faviconUploadKey } : {}),
      },
      conflictMessage: text('changed'),
    });
  };

  const handleActivate = () => {
    if (!draftInfo || draftInfo.version < 1) return;
    prepare({
      title: text('activate'),
      description: text('activateConfirm').replace('{version}', versionText(draftInfo.version)),
      path: '/api/admin/branding/activate',
      method: 'POST',
      body: { draftId: draftInfo.id, expectedVersion: draftInfo.version },
      conflictMessage: text('changed'),
    });
  };

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'logo' | 'logoDark' | 'favicon'
  ) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    uploadRequest.current?.abort();
    const controller = new AbortController();
    uploadRequest.current = controller;
    setUploading(true);
    const setKey =
      target === 'logo'
        ? setLogoUploadKey
        : target === 'logoDark'
          ? setLogoDarkUploadKey
          : setFaviconUploadKey;
    const setFile =
      target === 'logo' ? setLogoFile : target === 'logoDark' ? setLogoDarkFile : setFaviconFile;
    setKey(null);
    setFile(null);
    setMessage(null);
    try {
      const key = await uploadBrandingLogo(file, controller.signal);
      if (controller.signal.aborted) return;
      setKey(key);
      setFile(file);
    } catch {
      if (!controller.signal.aborted)
        setMessage({
          type: 'error',
          text: text(target === 'favicon' ? 'faviconUploadFailed' : 'uploadFailed'),
        });
    } finally {
      if (!controller.signal.aborted) setUploading(false);
    }
  };

  const savedConfig = activeConfig ? parseBrandConfig(activeConfig.config) : null;
  const changedConfig =
    !savedConfig ||
    Object.keys({ ...savedConfig, ...config }).some((name) => {
      const key = name as keyof BrandConfig;
      return config[key] !== savedConfig[key];
    });
  const isDirty =
    Boolean(logoUploadKey) ||
    Boolean(logoDarkUploadKey) ||
    Boolean(faviconUploadKey) ||
    (activeConfig && activeConfig.version > 0 ? changedConfig : true);
  const validConfig = parseBrandConfig(config) !== null;

  const displayedLogo =
    logoPreview ??
    (config.logoUrl?.startsWith('/api/public/branding/assets/')
      ? config.logoUrl.replace('/api/public/', '/api/admin/')
      : config.logoUrl);
  const displayedLogoDark =
    logoDarkPreview ??
    config.logoDarkUrl?.replace('/api/public/branding/assets/', '/api/admin/branding/assets/') ??
    null;
  const displayedFavicon =
    faviconPreview ??
    (config.faviconUrl?.startsWith('/api/public/branding/assets/')
      ? config.faviconUrl.replace('/api/public/', '/api/admin/')
      : config.faviconUrl);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {action && (
        <TeamActionDialog
          action={action}
          onClose={closeAction}
          onDenied={scope.deny}
          onPendingChange={(pending) => setPendingAction(pending ? action : null)}
          onUnconfirmed={() =>
            setRequiredRead({
              config: currentRead.nextReadAttempt(),
              history: historyRead.nextReadAttempt(),
              publishedId: published?.id,
            })
          }
          confirmationDisabled={!ready || needsReset}
          summary={
            <Button
              type="button"
              variant="outline"
              onClick={refresh}
              disabled={commandPending || loading || historyRead.loading}
            >
              {text('refresh')}
            </Button>
          }
          onSuccess={async (result) => {
            if (
              generation.current !== completionGeneration ||
              scope.live.current !== completionScope ||
              actionRef.current !== action ||
              !work.current.ready
            )
              return;
            const dto = parseConfigDto(result);
            const submitted = action.body as {
              expectedVersion: number;
              draftId?: string;
              config?: BrandConfig;
              logoUploadKey?: string;
              logoDarkUploadKey?: string;
              faviconUploadKey?: string;
            };
            if (action.method === 'PUT') {
              if (
                dto.status !== 'draft' ||
                dto.version !== submitted.expectedVersion + 1 ||
                history.some((row) => row.id === dto.id) ||
                !submitted.config
              )
                throw new Error('Unconfirmed branding draft');
              for (const key of Object.keys(submitted.config) as Array<keyof BrandConfig>) {
                if (
                  (key === 'logoUrl' && submitted.logoUploadKey) ||
                  (key === 'logoDarkUrl' && submitted.logoDarkUploadKey) ||
                  (key === 'faviconUrl' && submitted.faviconUploadKey)
                ) {
                  if (!dto.config[key]?.startsWith('/api/public/branding/assets/'))
                    throw new Error('Unconfirmed branding asset');
                  continue;
                }
                if (dto.config[key] !== submitted.config[key])
                  throw new Error('Unconfirmed branding settings');
              }
            } else if (
              JSON.stringify(dto.config) !==
                JSON.stringify(parseBrandConfig(activeConfig?.config)) ||
              dto.status !== 'active' ||
              dto.id !== submitted.draftId ||
              dto.version !== submitted.expectedVersion
            ) {
              throw new Error('Unconfirmed branding activation');
            }
            if (dto.status === 'active')
              window.dispatchEvent(new Event('barghsa:branding-activated'));
            setLogoFile(null);
            setLogoUploadKey(null);
            setLogoDarkFile(null);
            setLogoDarkUploadKey(null);
            setFaviconFile(null);
            setFaviconUploadKey(null);
            accepted.current = dto;
            currentRead.accept(dto);
            historyRead.accept(acceptBrandRevision(history, dto));
            setEditing(false);
            setNeedsReset(false);
            setConfig(dto.config);
            setMessage({ type: 'success', text: text('saved') });
            closeAction();
          }}
        />
      )}
      <PageHeader
        title={text('title')}
        description={text('description')}
        actions={
          <ListRefreshButton
            label={text('refresh')}
            refreshing={loading || historyRead.loading}
            onClick={refresh}
            disabled={action !== null || uploading}
          />
        }
      />
      {requiredRead && !action && <p role="alert">{confirmationText('unconfirmed', locale)}</p>}
      {(draftInfo || activeConfig?.status === 'active') && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {activeConfig?.status === 'active' && (
            <span className="rounded-md bg-muted px-2.5 py-1 font-medium">
              {text('activeVersion').replace('{version}', versionText(activeConfig.version))}
            </span>
          )}
          {draftInfo && (
            <span className="rounded-md bg-muted px-2.5 py-1 font-medium">
              {text('draftVersion').replace('{version}', versionText(draftInfo.version))}
            </span>
          )}
          {draftInfo && timezone.status === 'ready' && (
            <time
              data-testid="branding-draft-saved-at"
              dateTime={draftInfo.updatedAt}
              className="text-muted-foreground"
            >
              {text('savedAt').replace(
                '{date}',
                formatInTimezone(draftInfo.updatedAt, timezone.timezone, locale)
              )}
            </time>
          )}
        </div>
      )}

      {loadError && (
        <div role="alert">
          {text('loadFailed')}{' '}
          <Button
            type="button"
            variant="outline"
            disabled={commandPending || uploading}
            onClick={currentRead.retry}
          >
            {t('admin.jobs.reload', locale)}
          </Button>
        </div>
      )}
      {loading && !activeConfig ? (
        <div className="mx-auto flex h-64 w-full max-w-md flex-col justify-center">
          <LoadingSkeleton label={text('loading')} variant="form" />
        </div>
      ) : (
        (loading || historyRead.loading) && <LoadingStatus>{text('loading')}</LoadingStatus>
      )}
      {timezone.status === 'error' && (
        <div role="alert">
          {text('timezoneFailed')}{' '}
          <Button type="button" onClick={timezone.retry}>
            {text('retryTimezone')}
          </Button>
        </div>
      )}
      {uploading && <p role="status">{text('uploading')}</p>}
      {message && (
        <div
          role={message.type === 'error' ? 'alert' : 'status'}
          className={`px-4 py-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-muted text-foreground border border-border'
              : 'bg-destructive/10 text-destructive border border-destructive'
          }`}
        >
          {message.text}
        </div>
      )}

      {scope.denied && <p role="alert">{word('denied')}</p>}
      {!scope.denied && (historyRead.error || historyMismatch) && (
        <div role="alert">
          {word('historyError')}{' '}
          <Button
            type="button"
            variant="outline"
            disabled={commandPending || uploading}
            onClick={historyMismatch ? refresh : historyRead.retry}
          >
            {word('retryHistory')}
          </Button>
        </div>
      )}
      {!scope.denied && activeConfig && historyRead.data && !editing && (
        <VersionedSettingsCard
          title={text('title')}
          active={published}
          versions={history}
          formatDate={(iso) =>
            timezone.status === 'ready'
              ? formatInTimezone(iso, timezone.timezone, locale)
              : word('none')
          }
          renderConfig={(row) => (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
              <span
                className="size-7 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: row.config.primaryColor }}
                aria-hidden="true"
              />
              <p className="min-w-0 break-words text-base font-semibold" dir="auto">
                {locale === 'fa' ? row.config.appTitleFa : row.config.appTitle}
              </p>
            </div>
          )}
          disabled={!ready || needsReset || uploading || !!action || (isDirty && editing)}
          onRollback={(source) =>
            prepare({
              title: word('rollback'),
              description: word('rollbackConfirm').replace(
                '{version}',
                versionText(source.version)
              ),
              path: '/api/admin/branding/config',
              method: 'PUT',
              body: {
                config: brandConfigCommand(source.config),
                expectedVersion: activeConfig.version,
              },
              conflictMessage: text('changed'),
            })
          }
          actions={
            <>
              <Button
                type="button"
                disabled={!ready || !!action || uploading}
                onClick={() => setEditing(true)}
              >
                {word('edit')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleActivate}
                disabled={!ready || needsReset || uploading || !!action || !draftInfo || isDirty}
              >
                {text('activate')}
              </Button>
            </>
          }
        />
      )}
      {needsReset && (
        <div role="alert">
          {word('resetRequired')}{' '}
          <Button
            type="button"
            variant="outline"
            disabled={!ready || uploading}
            onClick={resetEditor}
          >
            {word('resetDraft')}
          </Button>
        </div>
      )}
      {!scope.denied && activeConfig && (
        <div
          className={`grid min-w-0 items-start gap-6 ${historyRead.data ? 'xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]' : ''}`}
        >
          <form
            aria-label={text('title')}
            className="min-w-0 space-y-2"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              handleSave();
            }}
          >
            {editing && (
              <div className="sticky top-0 z-10 overflow-hidden rounded-lg border bg-card">
                <RecordEditorActions
                  secondary={
                    historyRead.data && (
                      <a
                        href="#branding-preview"
                        className="touch-action text-sm font-medium text-primary underline underline-offset-4 xl:hidden"
                      >
                        {text('preview')}
                      </a>
                    )
                  }
                >
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!ready || !!action || uploading}
                    onClick={() => {
                      resetEditor();
                      setEditing(false);
                    }}
                  >
                    {word('cancelEdit')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      !ready || needsReset || uploading || !!action || !isDirty || !validConfig
                    }
                  >
                    {text('save')}
                  </Button>
                </RecordEditorActions>
              </div>
            )}
            <div className={recordEditorSurface}>
              <fieldset
                disabled={!editing || !!action || uploading}
                className="m-0 flex min-w-0 flex-col divide-y border-0 p-0"
              >
                <legend className="sr-only">{text('title')}</legend>
                {/* ── App Identity ──────────────────────────────────────────────── */}
                <section className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
                  <h2 className="text-base font-semibold text-foreground">{text('identity')}</h2>
                  <div className={recordEditorGrid}>
                    {(locale === 'fa' ? [brandNames[1], brandNames[0]] : brandNames).map(
                      ({ key, id, language, direction }) => (
                        <div key={key} className={recordEditorField}>
                          <label htmlFor={id} className="block text-sm font-medium text-foreground">
                            {text(key)}
                          </label>
                          <Input
                            id={id}
                            dir={direction}
                            lang={language}
                            type="text"
                            value={config[key]}
                            onChange={(event) => updateConfig(key, event.target.value)}
                          />
                        </div>
                      )
                    )}
                  </div>
                  <div className={recordEditorField}>
                    <label
                      htmlFor="adminbrandingconfig-field-3"
                      className="block text-sm font-medium text-foreground mb-1"
                    >
                      {text('slogan')}
                    </label>
                    <Input
                      id="adminbrandingconfig-field-3"
                      dir="auto"
                      type="text"
                      value={config.slogan}
                      onChange={(e) => updateConfig('slogan', e.target.value)}
                      placeholder={text('sloganPlaceholder')}
                    />
                  </div>
                </section>

                <section className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
                  <h2 className="text-base font-semibold text-foreground">
                    {text('supportContacts')}
                  </h2>
                  <div className={recordEditorGrid}>
                    {(['supportEmail', 'supportPhone', 'supportMobile'] as const).map((field) => (
                      <div key={field} className={recordEditorField}>
                        <label htmlFor={field} className="block text-sm font-medium mb-1">
                          {text(field)}
                        </label>
                        <Input
                          id={field}
                          type={field === 'supportEmail' ? 'email' : 'tel'}
                          dir="ltr"
                          value={config[field]}
                          onChange={(e) => updateConfig(field, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </section>

                {/* ── Colors ────────────────────────────────────────────────────── */}
                <section className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-foreground">{text('colors')}</h2>
                    {!editing && historyRead.data && (
                      <a
                        className="touch-action text-sm font-medium text-primary underline underline-offset-4 xl:hidden"
                        href="#branding-preview"
                      >
                        {text('preview')}
                      </a>
                    )}
                  </div>
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    {palettes.map(({ title, fields }) => (
                      <div
                        key={title}
                        className="min-w-0 space-y-4 rounded-lg border bg-muted/25 p-3"
                      >
                        <h3 className="text-sm font-semibold">{text(title)}</h3>
                        {fields.map(([label, field, fallback]) => (
                          <ColorInput
                            key={field}
                            label={text(label)}
                            value={config[field] ?? (fallback ? config[fallback] : '')}
                            onChange={(value) => updateConfig(field, value)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  {(['light', 'dark'] as const).some(
                    (mode) =>
                      getBrandTextColor(brandColor(config, 'primary', mode), [
                        mode === 'dark' ? config.darkBackgroundColor : config.backgroundColor,
                        ...BRAND_SURFACES[mode],
                      ]) === 'var(--foreground)'
                  ) && (
                    <p role="status" className="text-sm text-muted-foreground">
                      {text('contrastAdjusted')}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{text('backgroundHint')}</p>
                </section>

                <section className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
                  <h2 className="text-base font-semibold text-foreground">
                    {text('shapeAndType')}
                  </h2>
                  <div className={recordEditorGrid}>
                    <div className={recordEditorField}>
                      <label htmlFor="branding-font-family">{text('fontFamily')}</label>
                      <NativeSelect
                        id="branding-font-family"
                        value={config.fontFamily}
                        onChange={(event) => updateConfig('fontFamily', event.target.value)}
                        className="w-full"
                      >
                        <option value="vazirmatn">Vazirmatn</option>
                        <option value="tahoma">Tahoma</option>
                      </NativeSelect>
                    </div>
                    <div className={recordEditorField}>
                      <label htmlFor="branding-border-radius">{text('borderRadius')}</label>
                      <NativeSelect
                        id="branding-border-radius"
                        value={config.borderRadiusRem}
                        onChange={(event) =>
                          updateConfig('borderRadiusRem', Number(event.target.value))
                        }
                        className="w-full"
                      >
                        {[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5].map((value) => (
                          <option key={value} value={value}>
                            {value} rem
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className={recordEditorField}>
                      <label htmlFor="branding-spacing-scale">{text('spacingScale')}</label>
                      <NativeSelect
                        id="branding-spacing-scale"
                        value={config.spacingScale}
                        onChange={(event) =>
                          updateConfig('spacingScale', Number(event.target.value))
                        }
                        className="w-full"
                      >
                        {[0.875, 1, 1.125, 1.25].map((value) => (
                          <option key={value} value={value}>
                            {Math.round(value * 100)}%
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  </div>
                  {!validConfig && (
                    <p role="alert" className="text-sm text-destructive">
                      {text('invalidTheme')}
                    </p>
                  )}
                </section>

                {/* ── Logo ──────────────────────────────────────────────────────── */}
                <section id="branding-assets" className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
                  <h2 className="text-base font-semibold text-foreground">{text('logo')}</h2>

                  <div className="flex flex-wrap items-start gap-6">
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor="adminbrandingconfig-field-4"
                        className="block text-sm font-medium text-foreground mb-2"
                      >
                        {text('upload')}
                      </label>
                      <input
                        id="adminbrandingconfig-field-4"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        aria-describedby="branding-logo-hint"
                        disabled={action !== null}
                        onChange={(event) => void handleImageUpload(event, 'logo')}
                        className="block w-full text-sm text-muted-foreground file:me-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-muted file:text-foreground hover:file:underline"
                      />
                      <p id="branding-logo-hint" className="text-xs text-muted-foreground mt-1">
                        {text('logoHint')}
                      </p>
                    </div>

                    {displayedLogo && (
                      <div className="shrink-0">
                        <img
                          src={displayedLogo}
                          alt={text('logoPreview')}
                          className="max-w-32 max-h-16 object-contain border border-border rounded"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={action !== null || uploading}
                          onClick={() => {
                            setLogoFile(null);
                            setLogoUploadKey(null);
                            updateConfig('logoUrl', null);
                          }}
                          className="text-xs text-destructive underline mt-1"
                        >
                          {text('remove')}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="branding-dark-logo-upload"
                      className="block text-sm font-medium"
                    >
                      {text('uploadDarkLogo')}
                    </label>
                    <input
                      id="branding-dark-logo-upload"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={action !== null}
                      onChange={(event) => void handleImageUpload(event, 'logoDark')}
                      aria-describedby="branding-dark-logo-hint"
                      className="block w-full text-sm file:me-4 file:rounded-lg file:border-0 file:bg-muted file:px-4 file:py-2 file:text-foreground"
                    />
                    <p id="branding-dark-logo-hint" className="text-xs text-muted-foreground">
                      {text('logoHint')} {text('darkLogoHint')}
                    </p>
                    {displayedLogoDark && (
                      <div>
                        <img
                          src={displayedLogoDark}
                          alt={text('darkLogoPreview')}
                          className="max-h-16 max-w-32 rounded border border-border object-contain"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={action !== null || uploading}
                          onClick={() => {
                            setLogoDarkFile(null);
                            setLogoDarkUploadKey(null);
                            updateConfig('logoDarkUrl', null);
                          }}
                        >
                          {text('remove')}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="branding-favicon-upload"
                      className="block text-sm font-medium text-foreground"
                    >
                      {text('uploadFavicon')}
                    </label>
                    <input
                      id="branding-favicon-upload"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={action !== null}
                      onChange={(event) => void handleImageUpload(event, 'favicon')}
                      aria-describedby="branding-favicon-hint"
                      className="block w-full text-sm text-muted-foreground file:me-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-muted file:text-foreground hover:file:underline"
                    />
                    <p id="branding-favicon-hint" className="text-xs text-muted-foreground">
                      {text('logoHint')}
                    </p>
                    {displayedFavicon && (
                      <div>
                        <img
                          src={displayedFavicon}
                          alt={text('faviconPreview')}
                          className="size-8 object-contain border border-border rounded"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={action !== null || uploading}
                          onClick={() => {
                            setFaviconFile(null);
                            setFaviconUploadKey(null);
                            updateConfig('faviconUrl', null);
                          }}
                          className="text-xs text-destructive underline mt-1"
                        >
                          {text('remove')}
                        </Button>
                      </div>
                    )}
                    <label
                      htmlFor="adminbrandingconfig-field-5"
                      className="block text-sm font-medium text-foreground mb-1"
                    >
                      {text('favicon')}
                    </label>
                    <input
                      id="adminbrandingconfig-field-5"
                      type="text"
                      disabled={action !== null || uploading}
                      value={config.faviconUrl ?? ''}
                      onChange={(e) => {
                        setFaviconFile(null);
                        setFaviconUploadKey(null);
                        updateConfig('faviconUrl', e.target.value || null);
                      }}
                      className="w-full bg-background text-foreground border border-input rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder="https://cdn.example.com/favicon.ico"
                    />
                  </div>
                </section>

                {/* ── Dark Mode ─────────────────────────────────────────────────── */}
                <section className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">
                        {text('themePolicy')}
                      </h2>
                      <p id="branding-theme-policy-hint" className="text-sm text-muted-foreground">
                        {text('themePolicyHint')}
                      </p>
                    </div>
                    <NativeSelect
                      aria-label={text('themePolicy')}
                      aria-describedby="branding-theme-policy-hint"
                      value={config.themeMode ?? (config.darkMode ? 'dark' : 'light')}
                      onChange={(event) => updateConfig('themeMode', event.target.value)}
                    >
                      <NativeSelectOption value="light">{text('themeLight')}</NativeSelectOption>
                      <NativeSelectOption value="dark">{text('themeDark')}</NativeSelectOption>
                      <NativeSelectOption value="system">{text('themeSystem')}</NativeSelectOption>
                    </NativeSelect>
                  </div>
                  {config.themeMode === 'system' && (
                    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                      <label htmlFor="branding-theme-default" className="text-sm font-medium">
                        {text('themeDefault')}
                      </label>
                      <NativeSelect
                        id="branding-theme-default"
                        value={config.themeDefault ?? 'system'}
                        onChange={(event) => updateConfig('themeDefault', event.target.value)}
                      >
                        <NativeSelectOption value="system">
                          {text('themeDevice')}
                        </NativeSelectOption>
                        <NativeSelectOption value="light">
                          {shellText('themeLight', locale)}
                        </NativeSelectOption>
                        <NativeSelectOption value="dark">
                          {shellText('themeDark', locale)}
                        </NativeSelectOption>
                      </NativeSelect>
                    </div>
                  )}
                </section>

                <section className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
                  <label
                    htmlFor="branding-number-style"
                    className="block text-base font-semibold text-foreground"
                  >
                    {text('numberStyle')}
                  </label>
                  <p id="branding-number-style-help" className="text-sm text-muted-foreground">
                    {text('numberStyleHint')}
                  </p>
                  <NativeSelect
                    id="branding-number-style"
                    aria-describedby="branding-number-style-help"
                    value={config.numberStyle}
                    onChange={(event) => updateConfig('numberStyle', event.target.value)}
                    className="max-w-full"
                  >
                    <option value="locale">{text('numberLocale')}</option>
                    <option value="persian">{text('numberPersian')}</option>
                    <option value="western">{text('numberWestern')}</option>
                  </NativeSelect>
                  <p>
                    <output aria-label={text('numberPreview')}>
                      {formatCurrencyIrr('123456789', locale, { numberStyle: config.numberStyle })}
                    </output>
                  </p>
                </section>
              </fieldset>
            </div>
          </form>
          {historyRead.data && (
            <div
              id="branding-preview"
              tabIndex={-1}
              className="min-w-0 scroll-mt-20 xl:top-20 xl:[@media(min-height:800px)]:sticky xl:[@media(min-height:800px)]:max-h-[calc(100dvh-6rem)] xl:[@media(min-height:800px)]:overflow-y-auto"
            >
              <ConfigPreviewCard
                title={text('preview')}
                stacked
                controls={
                  <div className="grid min-w-0 gap-3">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="branding-preview-surface"
                        className="block text-sm font-medium"
                      >
                        {text('previewSurface')}
                      </label>
                      <NativeSelect
                        id="branding-preview-surface"
                        value={previewSurface}
                        onChange={(event) =>
                          setPreviewSurface(
                            event.target.value === 'signin' ? 'signin' : 'workspace'
                          )
                        }
                        className="w-full"
                      >
                        <NativeSelectOption value="workspace">
                          {text('previewWorkspace')}
                        </NativeSelectOption>
                        <NativeSelectOption value="signin">
                          {text('previewSignIn')}
                        </NativeSelectOption>
                      </NativeSelect>
                    </div>
                    <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                      <div className="min-w-0 space-y-1.5">
                        <label
                          htmlFor="branding-preview-mode"
                          className="block text-sm font-medium"
                        >
                          {text('previewMode')}
                        </label>
                        <NativeSelect
                          id="branding-preview-mode"
                          value={previewMode}
                          className="w-full"
                          onChange={(event) => {
                            const mode = event.target.value;
                            setPreviewMode(mode === 'light' || mode === 'dark' ? mode : 'auto');
                          }}
                        >
                          <NativeSelectOption value="auto">
                            {text('previewAutomatic')}
                          </NativeSelectOption>
                          <NativeSelectOption value="light">
                            {shellText('themeLight', locale)}
                          </NativeSelectOption>
                          <NativeSelectOption value="dark">
                            {shellText('themeDark', locale)}
                          </NativeSelectOption>
                        </NativeSelect>
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <label
                          htmlFor="branding-preview-language"
                          className="block text-sm font-medium"
                        >
                          {text('previewLanguage')}
                        </label>
                        <NativeSelect
                          id="branding-preview-language"
                          value={previewLanguage ?? locale}
                          onChange={(event) =>
                            setPreviewLanguage(event.target.value === 'en' ? 'en' : 'fa')
                          }
                          className="w-full"
                        >
                          <NativeSelectOption value="fa" lang="fa">
                            فارسی
                          </NativeSelectOption>
                          <NativeSelectOption value="en" lang="en">
                            English
                          </NativeSelectOption>
                        </NativeSelect>
                      </div>
                    </div>
                  </div>
                }
                current={
                  published || activeConfig.version === 0 ? (
                    <BrandingPreview
                      config={published?.config ?? activeConfig.config}
                      locale={previewLanguage ?? locale}
                      mode={previewMode}
                      surface={previewSurface}
                    />
                  ) : (
                    <p>{word('noActive')}</p>
                  )
                }
                draft={
                  <BrandingPreview
                    config={config}
                    locale={previewLanguage ?? locale}
                    mode={previewMode}
                    surface={previewSurface}
                    logo={displayedLogo}
                    logoDark={displayedLogoDark}
                  />
                }
              />
            </div>
          )}
        </div>
      )}
      {!scope.denied && activeConfig && (
        <AuditLogViewer
          scope="branding"
          refreshKey={brandingBasis(activeConfig)}
          onDenied={scope.deny}
        />
      )}
    </div>
  );
}

function BrandingPreview({
  config,
  locale,
  mode,
  surface,
  logo,
  logoDark,
}: {
  config: BrandConfig;
  locale: 'fa' | 'en';
  mode: 'auto' | 'light' | 'dark';
  surface: 'workspace' | 'signin';
  logo?: string | null;
  logoDark?: string | null;
}) {
  const safe = parseBrandConfig(config) ?? DEFAULT_CONFIG;
  const { systemTheme } = useBrandConfig();
  const theme =
    mode === 'auto'
      ? resolveTheme(
          safe.themeMode ?? (safe.darkMode ? 'dark' : 'light'),
          'system',
          systemTheme === 'dark',
          safe.themeDefault
        )
      : mode;
  const previewDark = theme === 'dark';
  const background = previewDark ? safe.darkBackgroundColor : safe.backgroundColor;
  const cardBackground = BRAND_SURFACES[theme][0];
  const mainColor = brandColor(safe, 'primary', theme);
  const accent = {
    backgroundColor: mainColor,
    color: getContrastForeground(mainColor),
    borderRadius: `${safe.borderRadiusRem / 2}rem`,
  };
  const image =
    (previewDark
      ? (logoDark ??
        safe.logoDarkUrl?.replace('/api/public/branding/assets/', '/api/admin/branding/assets/'))
      : null) ??
    logo ??
    safe.logoUrl?.replace('/api/public/branding/assets/', '/api/admin/branding/assets/');
  const identity = (
    <div className="flex min-w-0 items-center gap-2">
      {image && <img src={image} alt="" className="max-h-8 max-w-16 shrink-0 object-contain" />}
      <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">
        {locale === 'fa' ? safe.appTitleFa : safe.appTitle}
      </p>
    </div>
  );
  return (
    <div
      lang={locale}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      className="min-w-0 overflow-hidden rounded-lg border text-sm leading-snug"
      style={{
        backgroundColor: background,
        color: getContrastForeground(background),
        borderColor: mainColor,
        borderRadius: `${safe.borderRadiusRem}rem`,
        fontFamily: safe.fontFamily === 'tahoma' ? 'Tahoma, sans-serif' : 'Vazirmatn, sans-serif',
      }}
    >
      {surface === 'signin' ? (
        <div className="space-y-3" style={{ padding: `${safe.spacingScale}rem` }}>
          {identity}
          <div
            className="space-y-2 border border-black/10 p-3"
            style={{
              backgroundColor: cardBackground,
              color: getContrastForeground(cardBackground),
              borderRadius: `${safe.borderRadiusRem * 0.75}rem`,
            }}
          >
            <h4 className="font-semibold">{authText('auth.login.title', locale)}</h4>
            <div className="grid gap-2 text-xs">
              <div className="space-y-1">
                <p>{authText('auth.register.emailLabel', locale)}</p>
                <p className="rounded border border-current/25 px-2 py-1">
                  <bdi>sample@example.test</bdi>
                </p>
              </div>
              <div className="space-y-1">
                <p>{authText('auth.register.passwordLabel', locale)}</p>
                <p className="rounded border border-current/25 px-2 py-1" aria-hidden="true">
                  ••••••••
                </p>
              </div>
            </div>
            <p className="px-2 py-1.5 text-center text-xs font-semibold" style={accent}>
              {authText('auth.login.submit', locale)}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b border-current/15 p-3"
            style={{
              backgroundColor: cardBackground,
              color: getContrastForeground(cardBackground),
            }}
          >
            {identity}
            <div aria-hidden="true" className="flex shrink-0 items-center gap-2">
              <span className="relative">
                <Bell className="size-4" />
                <span
                  className="absolute -end-0.5 -top-0.5 size-1.5 rounded-full"
                  style={{ backgroundColor: brandColor(safe, 'accent', theme) }}
                />
              </span>
              <span
                className="rounded-full p-1"
                style={{
                  backgroundColor: brandColor(safe, 'secondary', theme),
                  color: getContrastForeground(brandColor(safe, 'secondary', theme)),
                }}
              >
                <CircleUserRound className="size-4" />
              </span>
            </div>
          </div>
          <div className="space-y-2" style={{ padding: `${safe.spacingScale}rem` }}>
            <h4 className="text-base font-semibold">{shellText('home', locale)}</h4>
            {safe.slogan && <p className="text-xs [overflow-wrap:anywhere]">{safe.slogan}</p>}
            <p className="inline-block px-2 py-1.5 text-xs font-semibold" style={accent}>
              {dashboardText('home.start', locale)}
            </p>
            <p className="text-xs">
              <output aria-label={brandingText('numberPreview', locale)}>
                {formatCurrencyIrr('123456789', locale, { numberStyle: safe.numberStyle })}
              </output>
            </p>
          </div>
        </>
      )}
    </div>
  );
}

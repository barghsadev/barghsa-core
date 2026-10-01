import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { Button } from '@barghsa/ui';
import {
  getContrastForeground,
  parseBrandConfig,
  type BrandConfig,
} from '../providers/BrandThemeProvider.js';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { uploadBrandingLogo } from '../lib/branding-logo-upload.js';
import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { brandingText } from '@barghsa/i18n/branding';
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
  acceptBrandRevision,
  type BrandConfigDto,
} from '../lib/branding-settings.js';
import { t } from '@barghsa/i18n/admin-ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: BrandConfig = {
  appTitle: '',
  appTitleFa: '',
  supportEmail: '',
  supportPhone: '',
  supportMobile: '',
  slogan: '',
  primaryColor: '#176b5b',
  secondaryColor: '#547467',
  accentColor: '#d6a74e',
  backgroundColor: '#f6f7f4',
  darkBackgroundColor: '#15201c',
  fontFamily: 'vazirmatn',
  borderRadiusRem: 0.75,
  spacingScale: 1,
  logoUrl: null,
  faviconUrl: null,
  darkMode: false,
  numberStyle: 'locale',
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Color picker component
// ---------------------------------------------------------------------------

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
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3">
      <label htmlFor={controlId} className="text-sm font-medium text-foreground col-span-3">
        {label}
      </label>
      <input
        id={controlId}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-10 rounded border border-input cursor-pointer p-0.5"
      />
      <input
        aria-label={brandingText('hex', locale).replace('{label}', label)}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background text-foreground border border-input rounded px-2 py-1 text-sm w-28 font-mono"
        placeholder="#000000"
      />
      <div className="w-16 h-8 rounded border border-border" style={{ backgroundColor: value }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminBrandingConfig() {
  const [config, setConfig] = useState<BrandConfig>(DEFAULT_CONFIG);
  const locale = useLocale();
  const text = (key: Parameters<typeof brandingText>[0]) => brandingText(key, locale);
  const timezone = useTimezone();
  const numbers = useNumberFormatting(locale);
  const versionText = (version: number) => numbers.number(version, { useGrouping: false });
  const [action, setAction] = useState<TeamAction | null>(null);
  const [editing, setEditing] = useState(false),
    [needsReset, setNeedsReset] = useState(false);
  const accepted = useRef<BrandConfigDto | null>(null),
    generation = useRef(0),
    actionRef = useRef<TeamAction | null>(null);
  const word = (key: string) => t(`admin.settings.${key}`, locale);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploadKey, setLogoUploadKey] = useState<string | null>(null);
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

  const closeAction = useCallback(() => {
    generation.current++;
    actionRef.current = null;
    setAction(null);
  }, []);
  const clear = useCallback(() => {
    closeAction();
    uploadRequest.current?.abort();
    setUploading(false);
    accepted.current = null;
    setLogoFile(null);
    setLogoUploadKey(null);
    setMessage(null);
    setConfig(DEFAULT_CONFIG);
    setEditing(false);
    setNeedsReset(false);
  }, [closeAction]);
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
  const ready =
    !scope.denied &&
    !currentRead.loading &&
    !currentRead.error &&
    !historyRead.loading &&
    !historyRead.error &&
    coherent;
  const draftInfo =
    activeConfig?.status === 'draft' && activeConfig.version > 0 ? activeConfig : null;
  const work = useRef({ config, editing, logoUploadKey, ready });
  work.current = { config, editing, logoUploadKey, ready };
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
    if (!ready || !activeConfig) return;
    const previous = accepted.current;
    if (!previous || brandingBasis(previous) !== brandingBasis(activeConfig)) {
      closeAction();
      if (
        previous &&
        work.current.editing &&
        (work.current.logoUploadKey ||
          JSON.stringify(work.current.config) !==
            JSON.stringify({ ...DEFAULT_CONFIG, ...previous.config }))
      )
        setNeedsReset(true);
      else {
        setConfig({ ...DEFAULT_CONFIG, ...activeConfig.config });
        setLogoFile(null);
        setLogoUploadKey(null);
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
    setConfig({ ...DEFAULT_CONFIG, ...activeConfig.config });
    setLogoFile(null);
    setLogoUploadKey(null);
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
      setConfig((prev) => ({ ...prev, [key]: value }));
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
        config: { ...config },
        expectedVersion: activeConfig.version,
        ...(logoUploadKey ? { logoUploadKey } : {}),
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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadRequest.current?.abort();
    const controller = new AbortController();
    uploadRequest.current = controller;
    setUploading(true);
    setLogoUploadKey(null);
    setLogoFile(null);
    setMessage(null);
    try {
      const key = await uploadBrandingLogo(file, controller.signal);
      if (controller.signal.aborted) return;
      setLogoUploadKey(key);
      setLogoFile(file);
    } catch {
      if (!controller.signal.aborted) setMessage({ type: 'error', text: text('uploadFailed') });
    } finally {
      if (!controller.signal.aborted) setUploading(false);
    }
  };

  if (loading && !activeConfig) {
    return (
      <div className="flex items-center justify-center h-64">
        <span role="status" className="sr-only">
          {text('loading')}
        </span>
        <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isDirty =
    Boolean(logoUploadKey) ||
    (activeConfig && activeConfig.version > 0
      ? JSON.stringify(config) !== JSON.stringify({ ...DEFAULT_CONFIG, ...activeConfig.config })
      : true);
  const validConfig = parseBrandConfig(config) !== null;

  const displayedLogo =
    logoPreview ??
    (config.logoUrl?.startsWith('/api/public/branding/assets/')
      ? config.logoUrl.replace('/api/public/', '/api/admin/')
      : config.logoUrl);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {action && (
        <TeamActionDialog
          action={action}
          onClose={closeAction}
          onDenied={scope.deny}
          confirmationDisabled={!ready || needsReset}
          summary={
            <Button
              type="button"
              variant="outline"
              onClick={refresh}
              disabled={loading || historyRead.loading}
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
                if (key === 'logoUrl' && submitted.logoUploadKey) {
                  if (!dto.config.logoUrl?.startsWith('/api/public/branding/assets/'))
                    throw new Error('Unconfirmed branding asset');
                  continue;
                }
                if (dto.config[key] !== submitted.config[key])
                  throw new Error('Unconfirmed branding settings');
              }
            } else if (
              JSON.stringify(dto.config) !== JSON.stringify(activeConfig?.config) ||
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
            accepted.current = dto;
            currentRead.accept(dto);
            historyRead.accept(acceptBrandRevision(history, dto));
            setEditing(false);
            setNeedsReset(false);
            setConfig({ ...DEFAULT_CONFIG, ...dto.config });
            setMessage({ type: 'success', text: text('saved') });
            closeAction();
          }}
        />
      )}
      <Button
        type="button"
        onClick={refresh}
        disabled={action !== null || uploading || loading || historyRead.loading}
      >
        {text('refresh')}
      </Button>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{text('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {text('description')}
            {draftInfo && (
              <span className="ms-2 text-foreground">
                {text('draftVersion').replace('{version}', versionText(draftInfo.version))}
                {timezone.status === 'ready' && (
                  <>
                    {' '}
                    ·{' '}
                    <time dateTime={draftInfo.updatedAt}>
                      {text('savedAt').replace(
                        '{date}',
                        formatInTimezone(draftInfo.updatedAt, timezone.timezone, locale)
                      )}
                    </time>
                  </>
                )}
              </span>
            )}
            {activeConfig?.status === 'active' && (
              <span className="ms-2 text-foreground">
                {text('activeVersion').replace('{version}', versionText(activeConfig.version))}
              </span>
            )}
          </p>
        </div>
      </div>

      {loadError && <p role="alert">{text('loadFailed')}</p>}
      {activeConfig && (loading || historyRead.loading) && <p role="status">{text('loading')}</p>}
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
      {!scope.denied && (!coherent || historyRead.error) && !historyRead.loading && (
        <div role="alert">
          {word('historyError')}{' '}
          <Button type="button" variant="outline" onClick={refresh}>
            {word('retryHistory')}
          </Button>
        </div>
      )}
      {!scope.denied && activeConfig && (
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
            <p className="break-words" dir="auto">
              {locale === 'fa' ? row.config.appTitleFa : row.config.appTitle}
            </p>
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
              body: { config: { ...source.config }, expectedVersion: activeConfig.version },
              conflictMessage: text('changed'),
            })
          }
          actions={
            <>
              {!editing ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!ready || !!action || uploading}
                  onClick={() => setEditing(true)}
                >
                  {word('edit')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!ready || !!action || uploading}
                  onClick={() => {
                    resetEditor();
                    setEditing(false);
                  }}
                >
                  {word('cancelEdit')}
                </Button>
              )}
              <Button
                type="button"
                onClick={handleSave}
                disabled={
                  !ready ||
                  !editing ||
                  needsReset ||
                  uploading ||
                  !!action ||
                  !isDirty ||
                  !validConfig
                }
              >
                {text('save')}
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
        <fieldset
          disabled={!editing || !!action || uploading}
          className="flex min-w-0 flex-col gap-6"
        >
          <legend className="sr-only">{text('title')}</legend>
          {/* ── App Identity ──────────────────────────────────────────────── */}
          <section className="bg-background rounded-lg border border-border p-6 space-y-5">
            <h2 className="text-lg font-semibold text-foreground">{text('identity')}</h2>

            <div>
              <label
                htmlFor="adminbrandingconfig-field-2"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {text('appTitle')}
              </label>
              <input
                id="adminbrandingconfig-field-2"
                type="text"
                value={config.appTitle}
                onChange={(e) => updateConfig('appTitle', e.target.value)}
                className="w-full bg-background text-foreground border border-input rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="branding-title-fa" className="block text-sm font-medium mb-1">
                {text('appTitleFa')}
              </label>
              <input
                id="branding-title-fa"
                type="text"
                dir="rtl"
                lang="fa"
                value={config.appTitleFa}
                onChange={(e) => updateConfig('appTitleFa', e.target.value)}
                className="w-full bg-background text-foreground border border-input rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="adminbrandingconfig-field-3"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {text('slogan')}
              </label>
              <input
                id="adminbrandingconfig-field-3"
                type="text"
                value={config.slogan}
                onChange={(e) => updateConfig('slogan', e.target.value)}
                className="w-full bg-background text-foreground border border-input rounded-lg px-3 py-2 text-sm"
                placeholder={text('sloganPlaceholder')}
              />
            </div>
          </section>

          <section className="bg-background rounded-lg border border-border p-6 space-y-5">
            <h2 className="text-lg font-semibold text-foreground">{text('supportContacts')}</h2>
            {(['supportEmail', 'supportPhone', 'supportMobile'] as const).map((field) => (
              <div key={field}>
                <label htmlFor={field} className="block text-sm font-medium mb-1">
                  {text(field)}
                </label>
                <input
                  id={field}
                  type={field === 'supportEmail' ? 'email' : 'tel'}
                  dir="ltr"
                  value={config[field]}
                  onChange={(e) => updateConfig(field, e.target.value)}
                  className="w-full bg-background text-foreground border border-input rounded-lg px-3 py-2 text-sm"
                />
              </div>
            ))}
          </section>

          {/* ── Colors ────────────────────────────────────────────────────── */}
          <section className="bg-background rounded-lg border border-border p-6 space-y-5">
            <h2 className="text-lg font-semibold text-foreground">{text('colors')}</h2>

            <ColorInput
              label={text('primary')}
              value={config.primaryColor}
              onChange={(v) => updateConfig('primaryColor', v)}
            />
            <ColorInput
              label={text('secondary')}
              value={config.secondaryColor}
              onChange={(v) => updateConfig('secondaryColor', v)}
            />
            <ColorInput
              label={text('accent')}
              value={config.accentColor}
              onChange={(v) => updateConfig('accentColor', v)}
            />
            <ColorInput
              label={text('background')}
              value={config.backgroundColor}
              onChange={(v) => updateConfig('backgroundColor', v)}
            />
            <ColorInput
              label={text('darkBackground')}
              value={config.darkBackgroundColor}
              onChange={(v) => updateConfig('darkBackgroundColor', v)}
            />
            <p className="text-xs text-muted-foreground">{text('backgroundHint')}</p>
          </section>

          <section className="bg-background rounded-lg border border-border p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">{text('shapeAndType')}</h2>
            <label className="block space-y-1 text-sm font-medium">
              <span>{text('fontFamily')}</span>
              <select
                value={config.fontFamily}
                onChange={(event) => updateConfig('fontFamily', event.target.value)}
                className="block w-full rounded border border-input px-3 py-2"
              >
                <option value="vazirmatn">Vazirmatn</option>
                <option value="tahoma">Tahoma</option>
              </select>
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>{text('borderRadius')}</span>
              <select
                value={config.borderRadiusRem}
                onChange={(event) => updateConfig('borderRadiusRem', Number(event.target.value))}
                className="block w-full rounded border border-input px-3 py-2"
              >
                {[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5].map((value) => (
                  <option key={value} value={value}>
                    {value} rem
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>{text('spacingScale')}</span>
              <select
                value={config.spacingScale}
                onChange={(event) => updateConfig('spacingScale', Number(event.target.value))}
                className="block w-full rounded border border-input px-3 py-2"
              >
                {[0.875, 1, 1.125, 1.25].map((value) => (
                  <option key={value} value={value}>
                    {Math.round(value * 100)}%
                  </option>
                ))}
              </select>
            </label>
            {!validConfig && (
              <p role="alert" className="text-sm text-destructive">
                {text('invalidTheme')}
              </p>
            )}
          </section>

          {/* ── Logo ──────────────────────────────────────────────────────── */}
          <section className="bg-background rounded-lg border border-border p-6 space-y-5">
            <h2 className="text-lg font-semibold text-foreground">{text('logo')}</h2>

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
                  disabled={action !== null}
                  onChange={handleLogoUpload}
                  className="block w-full text-sm text-muted-foreground file:me-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-muted file:text-foreground hover:file:underline"
                />
                <p className="text-xs text-muted-foreground mt-1">{text('logoHint')}</p>
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

            <div>
              <label
                htmlFor="adminbrandingconfig-field-5"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {text('favicon')}
              </label>
              <input
                id="adminbrandingconfig-field-5"
                type="text"
                value={config.faviconUrl ?? ''}
                onChange={(e) => updateConfig('faviconUrl', e.target.value || null)}
                className="w-full bg-background text-foreground border border-input rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="https://cdn.example.com/favicon.ico"
              />
            </div>
          </section>

          {/* ── Dark Mode ─────────────────────────────────────────────────── */}
          <section className="bg-background rounded-lg border border-border p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{text('darkMode')}</h2>
                <p className="text-sm text-muted-foreground">{text('darkHint')}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <span className="sr-only">{text('darkMode')}</span>
                <input
                  type="checkbox"
                  checked={config.darkMode}
                  onChange={(e) => updateConfig('darkMode', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-foreground peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-foreground peer-checked:after:bg-primary-foreground after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:bg-primary" />
              </label>
            </div>
          </section>

          <section className="bg-background rounded-lg border border-border p-6 space-y-3">
            <label
              htmlFor="branding-number-style"
              className="block text-lg font-semibold text-foreground"
            >
              {text('numberStyle')}
            </label>
            <p id="branding-number-style-help" className="text-sm text-muted-foreground">
              {text('numberStyleHint')}
            </p>
            <select
              id="branding-number-style"
              aria-describedby="branding-number-style-help"
              value={config.numberStyle}
              onChange={(event) => updateConfig('numberStyle', event.target.value)}
              className="rounded border border-input px-3 py-2"
            >
              <option value="locale">{text('numberLocale')}</option>
              <option value="persian">{text('numberPersian')}</option>
              <option value="western">{text('numberWestern')}</option>
            </select>
            <p>
              <output aria-label={text('numberPreview')}>
                {formatCurrencyIrr('123456789', locale, { numberStyle: config.numberStyle })}
              </output>
            </p>
          </section>
        </fieldset>
      )}
      {!scope.denied && activeConfig && (
        <ConfigPreviewCard
          title={text('preview')}
          current={
            published || activeConfig.version === 0 ? (
              <BrandingPreview config={published?.config ?? activeConfig.config} locale={locale} />
            ) : (
              <p>{word('noActive')}</p>
            )
          }
          draft={<BrandingPreview config={config} locale={locale} logo={displayedLogo} />}
        />
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
  logo,
}: {
  config: BrandConfig;
  locale: 'fa' | 'en';
  logo?: string | null;
}) {
  const safe = parseBrandConfig(config) ?? DEFAULT_CONFIG;
  const image =
    logo ?? safe.logoUrl?.replace('/api/public/branding/assets/', '/api/admin/branding/assets/');
  return (
    <div
      className="flex min-w-0 flex-col gap-4 rounded-lg border p-5"
      style={{
        backgroundColor: safe.darkMode ? safe.darkBackgroundColor : safe.backgroundColor,
        color: safe.darkMode ? '#e7eee6' : '#203631',
        borderColor: safe.primaryColor,
        borderRadius: `${safe.borderRadiusRem}rem`,
        padding: `${1.25 * safe.spacingScale}rem`,
        fontFamily: safe.fontFamily === 'tahoma' ? 'Tahoma, sans-serif' : 'Vazirmatn, sans-serif',
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {image && (
          <img
            src={image}
            alt={brandingText('logo', locale)}
            className="max-h-10 max-w-24 object-contain"
          />
        )}
        <div className="min-w-0 break-words">
          <p className="text-lg font-semibold">
            {locale === 'fa' ? safe.appTitleFa : safe.appTitle}
          </p>
          {safe.slogan && <p>{safe.slogan}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['primary', 'secondary', 'accent'] as const).map((key) => (
          <span
            key={key}
            className="rounded px-3 py-2"
            style={{
              backgroundColor: safe[`${key}Color`],
              color: getContrastForeground(safe[`${key}Color`]),
            }}
          >
            {brandingText(key, locale)}
          </span>
        ))}
      </div>
      <output aria-label={brandingText('numberPreview', locale)}>
        {formatCurrencyIrr('123456789', locale, { numberStyle: safe.numberStyle })}
      </output>
    </div>
  );
}

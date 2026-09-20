import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { Button } from '@barghsa/ui';
import { getContrastForeground, parseBrandConfig } from '../providers/BrandThemeProvider.js';
import { formatCurrencyIrr, type NumberStyle } from '@barghsa/i18n/numbers';
import { uploadBrandingLogo } from '../lib/branding-logo-upload.js';
import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { brandingText } from '@barghsa/i18n/branding';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrandConfig {
  appTitle: string;
  slogan: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  darkMode: boolean;
  numberStyle: NumberStyle;
}

interface BrandConfigDto {
  id: string;
  config: BrandConfig;
  version: number;
  status: 'draft' | 'active' | 'superseded';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: BrandConfig = {
  appTitle: 'Barghsa',
  slogan: '',
  primaryColor: '#2563eb',
  secondaryColor: '#64748b',
  accentColor: '#f59e0b',
  logoUrl: null,
  faviconUrl: null,
  darkMode: false,
  numberStyle: 'locale',
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function parseConfigDto(value: unknown): BrandConfigDto {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid branding response');
  const dto = value as Record<string, unknown>;
  const config = parseBrandConfig(dto.config);
  if (
    !config ||
    typeof dto.id !== 'string' ||
    !dto.id.length ||
    typeof dto.version !== 'number' ||
    !Number.isSafeInteger(dto.version) ||
    dto.version < 0 ||
    (dto.status !== 'draft' && dto.status !== 'active' && dto.status !== 'superseded') ||
    typeof dto.createdBy !== 'string' ||
    !dto.createdBy.length ||
    typeof dto.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(dto.createdAt)) ||
    typeof dto.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(dto.updatedAt))
  )
    throw new Error('Invalid branding response');
  return { ...dto, config } as unknown as BrandConfigDto;
}

async function fetchActiveConfig(): Promise<BrandConfigDto> {
  const res = await fetch('/api/admin/branding/config');
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.statusText}`);
  return parseConfigDto(await res.json());
}

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
  const [activeConfig, setActiveConfig] = useState<BrandConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const locale = useLocale();
  const text = (key: Parameters<typeof brandingText>[0]) => brandingText(key, locale);
  const timezone = useTimezone();
  const numbers = useNumberFormatting(locale);
  const versionText = (version: number) => numbers.number(version, { useGrouping: false });
  const [action, setAction] = useState<TeamAction | null>(null);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const draftInfo = activeConfig?.status === 'draft' ? activeConfig : null;
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

  // Load current config
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setLogoFile(null);
    setLogoUploadKey(null);
    setMessage(null);
    setActiveConfig(null);
    fetchActiveConfig()
      .then((dto) => {
        if (cancelled) return;
        setActiveConfig(dto);
        setConfig({ ...DEFAULT_CONFIG, ...dto.config });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  const updateConfig = useCallback((key: keyof BrandConfig, value: string | boolean | null) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = () => {
    if (!activeConfig) return;
    setAction({
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
    setAction({
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

  if (loading) {
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

  const previewColors = (['primary', 'secondary', 'accent'] as const).map((key) => {
    const field = `${key}Color` as const;
    return {
      key,
      color: /^#[0-9a-f]{6}$/i.test(config[field]) ? config[field] : DEFAULT_CONFIG[field],
    };
  });
  const displayedLogo =
    logoPreview ??
    (config.logoUrl?.startsWith('/api/public/branding/assets/')
      ? config.logoUrl.replace('/api/public/', '/api/admin/')
      : config.logoUrl);
  return (
    <div className="max-w-3xl mx-auto space-y-8 px-4">
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
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
                !submitted.config
              )
                throw new Error('Unconfirmed branding draft');
              for (const key of Object.keys(submitted.config) as Array<keyof BrandConfig>) {
                if (key === 'logoUrl' && submitted.logoUploadKey) continue;
                if (dto.config[key] !== submitted.config[key])
                  throw new Error('Unconfirmed branding settings');
              }
            } else if (
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
            setActiveConfig(dto);
            setConfig({ ...DEFAULT_CONFIG, ...dto.config });
            setMessage({ type: 'success', text: text('saved') });
            setAction(null);
          }}
        />
      )}
      <Button
        type="button"
        onClick={() => setRevision((value) => value + 1)}
        disabled={action !== null || uploading}
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
            placeholder="Barghsa"
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

      {/* ── Preview ───────────────────────────────────────────────────── */}
      <section className="bg-background rounded-lg border border-border p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">{text('preview')}</h2>
        <div
          className="rounded-lg p-6 border"
          style={{
            backgroundColor: config.darkMode ? 'oklch(0.141 0.005 285.823)' : '#ffffff',
            color: config.darkMode ? 'oklch(0.985 0 0)' : 'oklch(0.141 0.005 285.823)',
            borderColor: previewColors[0]!.color,
          }}
        >
          <div className="flex items-center gap-4 mb-4">
            {displayedLogo && <img src={displayedLogo} alt={text('logo')} className="h-10" />}
            <div className="min-w-0 break-words">
              <h3 className="text-xl font-bold">{config.appTitle || 'Barghsa'}</h3>
              {config.slogan && <p className="text-sm">{config.slogan}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {previewColors.map(({ key, color }) => (
              <Button
                key={key}
                type="button"
                style={{ backgroundColor: color, color: getContrastForeground(color) }}
              >
                {text(key)}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 pb-8">
        <Button
          type="button"
          onClick={handleSave}
          disabled={uploading || action !== null || !activeConfig || !isDirty}
        >
          {text('save')}
        </Button>

        <Button
          type="button"
          onClick={handleActivate}
          disabled={uploading || action !== null || !draftInfo || isDirty}
          variant="outline"
        >
          {text('activate')}
        </Button>

        {activeConfig?.status === 'active' && (
          <span className="text-xs text-foreground ms-auto">
            {text('activeVersion').replace('{version}', versionText(activeConfig.version))}
          </span>
        )}
      </div>
    </div>
  );
}

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

async function fetchActiveConfig(): Promise<BrandConfigDto> {
  const res = await fetch('/api/admin/branding/config');
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.statusText}`);
  return res.json();
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
    <div className="flex items-center gap-3">
      <label htmlFor={controlId} className="text-sm font-medium text-gray-700 w-32">
        {label}
      </label>
      <input
        id={controlId}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-10 rounded border border-gray-300 cursor-pointer p-0.5"
      />
      <input
        aria-label={brandingText('hex', locale).replace('{label}', label)}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 rounded px-2 py-1 text-sm w-28 font-mono"
        placeholder="#000000"
      />
      <div className="w-16 h-8 rounded border border-gray-200" style={{ backgroundColor: value }} />
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
  const versionText = (version: number) =>
    new Intl.NumberFormat(locale, { useGrouping: false }).format(version);
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

  const displayedLogo =
    logoPreview ??
    (config.logoUrl?.startsWith('/api/public/branding/assets/')
      ? config.logoUrl.replace('/api/public/', '/api/admin/')
      : config.logoUrl);
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            const dto = result as BrandConfigDto;
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
      <button
        type="button"
        onClick={() => setRevision((value) => value + 1)}
        disabled={action !== null || uploading}
      >
        {text('refresh')}
      </button>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{text('title')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {text('description')}
            {draftInfo && (
              <span className="ms-2 text-amber-600">
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
              <span className="ms-2 text-green-600">
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
          <button type="button" onClick={timezone.retry}>
            {text('retryTimezone')}
          </button>
        </div>
      )}
      {uploading && <p role="status">{text('uploading')}</p>}
      {message && (
        <div
          role={message.type === 'error' ? 'alert' : 'status'}
          className={`px-4 py-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ── App Identity ──────────────────────────────────────────────── */}
      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-800">{text('identity')}</h2>

        <div>
          <label
            htmlFor="adminbrandingconfig-field-2"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {text('appTitle')}
          </label>
          <input
            id="adminbrandingconfig-field-2"
            type="text"
            value={config.appTitle}
            onChange={(e) => updateConfig('appTitle', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Barghsa"
          />
        </div>

        <div>
          <label
            htmlFor="adminbrandingconfig-field-3"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {text('slogan')}
          </label>
          <input
            id="adminbrandingconfig-field-3"
            type="text"
            value={config.slogan}
            onChange={(e) => updateConfig('slogan', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder={text('sloganPlaceholder')}
          />
        </div>
      </section>

      {/* ── Colors ────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-800">{text('colors')}</h2>

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
      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-800">{text('logo')}</h2>

        <div className="flex items-start gap-6">
          <div className="flex-1">
            <label
              htmlFor="adminbrandingconfig-field-4"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              {text('upload')}
            </label>
            <input
              id="adminbrandingconfig-field-4"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={action !== null}
              onChange={handleLogoUpload}
              className="block w-full text-sm text-gray-500 file:me-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="text-xs text-gray-400 mt-1">{text('logoHint')}</p>
          </div>

          {displayedLogo && (
            <div className="shrink-0">
              <img
                src={displayedLogo}
                alt={text('logoPreview')}
                className="max-w-32 max-h-16 object-contain border border-gray-200 rounded"
              />
              <button
                type="button"
                disabled={action !== null || uploading}
                onClick={() => {
                  setLogoFile(null);
                  setLogoUploadKey(null);
                  updateConfig('logoUrl', null);
                }}
                className="text-xs text-red-500 hover:text-red-700 mt-1"
              >
                {text('remove')}
              </button>
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="adminbrandingconfig-field-5"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {text('favicon')}
          </label>
          <input
            id="adminbrandingconfig-field-5"
            type="text"
            value={config.faviconUrl ?? ''}
            onChange={(e) => updateConfig('faviconUrl', e.target.value || null)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            placeholder="https://cdn.example.com/favicon.ico"
          />
        </div>
      </section>

      {/* ── Dark Mode ─────────────────────────────────────────────────── */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">{text('darkMode')}</h2>
            <p className="text-sm text-gray-500">{text('darkHint')}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <span className="sr-only">{text('darkMode')}</span>
            <input
              type="checkbox"
              checked={config.darkMode}
              onChange={(e) => updateConfig('darkMode', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
          </label>
        </div>
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-3">
        <label
          htmlFor="branding-number-style"
          className="block text-lg font-semibold text-gray-800"
        >
          {text('numberStyle')}
        </label>
        <p id="branding-number-style-help" className="text-sm text-gray-500">
          {text('numberStyleHint')}
        </p>
        <select
          id="branding-number-style"
          aria-describedby="branding-number-style-help"
          value={config.numberStyle}
          onChange={(event) => updateConfig('numberStyle', event.target.value)}
          className="rounded border border-gray-300 px-3 py-2"
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
      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">{text('preview')}</h2>
        <div
          className="rounded-lg p-6 border"
          style={{
            backgroundColor: config.darkMode ? '#1e293b' : '#ffffff',
            borderColor: config.primaryColor,
          }}
        >
          <div className="flex items-center gap-4 mb-4">
            {displayedLogo && <img src={displayedLogo} alt={text('logo')} className="h-10" />}
            <div>
              <h3 className="text-xl font-bold" style={{ color: config.primaryColor }}>
                {config.appTitle || 'Barghsa'}
              </h3>
              {config.slogan && (
                <p className="text-sm" style={{ color: config.secondaryColor }}>
                  {config.slogan}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: config.primaryColor }}
            >
              {text('primary')}
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: config.secondaryColor }}
            >
              {text('secondary')}
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: config.accentColor }}
            >
              {text('accent')}
            </button>
          </div>
        </div>
      </section>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 pb-8">
        <button
          type="button"
          onClick={handleSave}
          disabled={uploading || action !== null || !activeConfig || !isDirty}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {text('save')}
        </button>

        <button
          type="button"
          onClick={handleActivate}
          disabled={uploading || action !== null || !draftInfo || isDirty}
          className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {text('activate')}
        </button>

        {activeConfig?.status === 'active' && (
          <span className="text-xs text-green-600 ms-auto">
            {text('activeVersion').replace('{version}', versionText(activeConfig.version))}
          </span>
        )}
      </div>
    </div>
  );
}

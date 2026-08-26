import { useState, useEffect, useCallback } from 'react'
import { withCsrf } from '../lib/csrf.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrandConfig {
  appTitle: string
  slogan: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  logoUrl: string | null
  faviconUrl: string | null
  darkMode: boolean
}

interface BrandConfigDto {
  id: string
  config: BrandConfig
  version: number
  status: 'draft' | 'active'
  createdBy: string
  createdAt: string
  updatedAt: string
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
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchActiveConfig(): Promise<BrandConfigDto> {
  const res = await fetch('/api/admin/branding/config')
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.statusText}`)
  return res.json()
}

async function saveDraftConfig(config: BrandConfig): Promise<BrandConfigDto> {
  const res = await fetch('/api/admin/branding/config', {
    method: 'PUT',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ config }),
  })
  if (!res.ok) throw new Error(`Failed to save config: ${res.statusText}`)
  return res.json()
}

async function activateConfig(): Promise<BrandConfigDto> {
  const res = await fetch('/api/admin/branding/activate', {
    method: 'POST',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
  })
  if (!res.ok) {
    if (res.status === 400) throw new Error('No draft config to activate')
    throw new Error(`Failed to activate config: ${res.statusText}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Color picker component
// ---------------------------------------------------------------------------

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-gray-700 w-32">{label}</label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-10 rounded border border-gray-300 cursor-pointer p-0.5"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 rounded px-2 py-1 text-sm w-28 font-mono"
        placeholder="#000000"
      />
      <div
        className="w-16 h-8 rounded border border-gray-200"
        style={{ backgroundColor: value }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminBrandingConfig() {
  const [config, setConfig] = useState<BrandConfig>(DEFAULT_CONFIG)
  const [activeConfig, setActiveConfig] = useState<BrandConfigDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [draftInfo, setDraftInfo] = useState<{ version: number; updatedAt: string } | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)

  // Load current config
  useEffect(() => {
    let cancelled = false
    fetchActiveConfig()
      .then((dto) => {
        if (cancelled) return
        setActiveConfig(dto)
        setConfig({ ...DEFAULT_CONFIG, ...dto.config })
        if (dto.status === 'draft') {
          setDraftInfo({ version: dto.version, updatedAt: dto.updatedAt })
        }
      })
      .catch((err) => {
        if (!cancelled) setMessage({ type: 'error', text: `Failed to load config: ${err.message}` })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const updateConfig = useCallback((key: keyof BrandConfig, value: string | boolean | null) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      const dto = await saveDraftConfig(config)
      setDraftInfo({ version: dto.version, updatedAt: dto.updatedAt })
      setMessage({ type: 'success', text: 'Draft config saved successfully.' })
    } catch (err) {
      setMessage({ type: 'error', text: `Failed to save: ${(err as Error).message}` })
    } finally {
      setSaving(false)
    }
  }, [config])

  const handleActivate = useCallback(async () => {
    setActivating(true)
    setMessage(null)
    try {
      const dto = await activateConfig()
      setActiveConfig(dto)
      setConfig({ ...DEFAULT_CONFIG, ...dto.config })
      setDraftInfo(null)
      setMessage({ type: 'success', text: `Config version ${dto.version} activated.` })
    } catch (err) {
      // Save first if no draft exists
      if ((err as Error).message === 'No draft config to activate') {
        await handleSave()
        try {
          const dto = await activateConfig()
          setActiveConfig(dto)
          setConfig({ ...DEFAULT_CONFIG, ...dto.config })
          setDraftInfo(null)
          setMessage({ type: 'success', text: `Config version ${dto.version} activated.` })
        } catch (e2) {
          setMessage({ type: 'error', text: `Failed to activate: ${(e2 as Error).message}` })
        }
      } else {
        setMessage({ type: 'error', text: `Failed to activate: ${(err as Error).message}` })
      }
    } finally {
      setActivating(false)
    }
  }, [handleSave])

  const handleLogoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    // In a real implementation, upload to storage and get CDN URL
    // For now, create a local object URL for preview
    const url = URL.createObjectURL(file)
    updateConfig('logoUrl', url)
  }, [updateConfig])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isDirty = activeConfig
    ? JSON.stringify(config) !== JSON.stringify({ ...DEFAULT_CONFIG, ...activeConfig.config })
    : true

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Branding Settings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure your brand identity — logo, colors, and app name.
            {draftInfo && (
              <span className="ml-2 text-amber-600">
                (Draft v{draftInfo.version} — last saved {new Date(draftInfo.updatedAt).toLocaleString()})
              </span>
            )}
            {activeConfig?.status === 'active' && !draftInfo && (
              <span className="ml-2 text-green-600">
                (Active v{activeConfig.version})
              </span>
            )}
          </p>
        </div>
      </div>

      {message && (
        <div
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
        <h2 className="text-lg font-semibold text-gray-800">App Identity</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">App Title</label>
          <input
            type="text"
            value={config.appTitle}
            onChange={(e) => updateConfig('appTitle', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Barghsa"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Slogan</label>
          <input
            type="text"
            value={config.slogan}
            onChange={(e) => updateConfig('slogan', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Your electricity companion"
          />
        </div>
      </section>

      {/* ── Colors ────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-800">Colors</h2>

        <ColorInput
          label="Primary"
          value={config.primaryColor}
          onChange={(v) => updateConfig('primaryColor', v)}
        />
        <ColorInput
          label="Secondary"
          value={config.secondaryColor}
          onChange={(v) => updateConfig('secondaryColor', v)}
        />
        <ColorInput
          label="Accent"
          value={config.accentColor}
          onChange={(v) => updateConfig('accentColor', v)}
        />
      </section>

      {/* ── Logo ──────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-800">Logo</h2>

        <div className="flex items-start gap-6">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">Upload logo</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              onChange={handleLogoUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="text-xs text-gray-400 mt-1">PNG, JPG, or SVG. Max 2MB.</p>
          </div>

          {config.logoUrl && (
            <div className="shrink-0">
              <img
                src={config.logoUrl}
                alt="Logo preview"
                className="max-w-32 max-h-16 object-contain border border-gray-200 rounded"
              />
              <button
                type="button"
                onClick={() => updateConfig('logoUrl', null)}
                className="text-xs text-red-500 hover:text-red-700 mt-1"
              >
                Remove
              </button>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Favicon URL (optional)</label>
          <input
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
            <h2 className="text-lg font-semibold text-gray-800">Dark Mode</h2>
            <p className="text-sm text-gray-500">Enable dark mode theme for the app</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
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

      {/* ── Preview ───────────────────────────────────────────────────── */}
      <section className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Preview</h2>
        <div
          className="rounded-lg p-6 border"
          style={{
            backgroundColor: config.darkMode ? '#1e293b' : '#ffffff',
            borderColor: config.primaryColor,
          }}
        >
          <div className="flex items-center gap-4 mb-4">
            {config.logoUrl && (
              <img src={config.logoUrl} alt="Logo" className="h-10" />
            )}
            <div>
              <h3
                className="text-xl font-bold"
                style={{ color: config.primaryColor }}
              >
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
              Primary
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: config.secondaryColor }}
            >
              Secondary
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-white text-sm font-medium"
              style={{ backgroundColor: config.accentColor }}
            >
              Accent
            </button>
          </div>
        </div>
      </section>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 pb-8">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save Draft'}
        </button>

        <button
          type="button"
          onClick={handleActivate}
          disabled={activating}
          className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {activating ? 'Activating...' : 'Activate'}
        </button>

        {activeConfig?.status === 'active' && (
          <span className="text-xs text-green-600 ml-auto">
            Active v{activeConfig.version}
          </span>
        )}
      </div>
    </div>
  )
}
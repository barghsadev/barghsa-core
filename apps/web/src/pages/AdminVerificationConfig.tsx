import { useState, useEffect, useCallback } from 'react'
import { withCsrf } from '../lib/csrf.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VerificationMode = 'DISABLED' | 'MANUAL' | 'API'

interface VerificationModeResponse {
  mode: VerificationMode
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchMode(): Promise<VerificationMode> {
  const res = await fetch('/api/admin/config/profile-verification-mode')
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.statusText}`)
  const data: VerificationModeResponse = await res.json()
  return data.mode
}

async function saveMode(mode: VerificationMode): Promise<void> {
  const res = await fetch('/api/admin/config/profile-verification-mode', {
    method: 'PUT',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mode }),
  })
  if (!res.ok) throw new Error(`Failed to save config: ${res.statusText}`)
}

// ---------------------------------------------------------------------------
// Mode descriptions
// ---------------------------------------------------------------------------

const MODE_DESCRIPTIONS: Record<VerificationMode, { title: string; description: string }> = {
  DISABLED: {
    title: 'No verification',
    description: 'Profiles are created without verification. Suitable for testing or closed systems.',
  },
  MANUAL: {
    title: 'Manual verification',
    description: 'Staff review and verify profiles manually. Recommended for initial deployment.',
  },
  API: {
    title: 'API-based auto-verification',
    description: 'Profiles are automatically verified via external APIs (national ID, etc.). Requires provider configuration.',
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminVerificationConfig() {
  const [currentMode, setCurrentMode] = useState<VerificationMode | null>(null)
  const [selectedMode, setSelectedMode] = useState<VerificationMode>('DISABLED')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    fetchMode()
      .then((mode) => {
        setCurrentMode(mode)
        setSelectedMode(mode)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const clearMessages = useCallback(() => {
    setError(null)
    setSuccess(null)
  }, [])

  const handleSave = useCallback(async () => {
    clearMessages()
    setSaving(true)
    try {
      await saveMode(selectedMode)
      setCurrentMode(selectedMode)
      setSuccess('Verification mode updated.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [selectedMode, clearMessages])

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading verification configuration...</p>
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Profile Verification</h1>

      <p className="text-sm text-gray-600 mb-6">
        Choose how new profiles are verified. Changing this mode affects all profiles.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
          {success}
        </div>
      )}

      <div className="space-y-4 max-w-xl">
        {(Object.entries(MODE_DESCRIPTIONS) as [VerificationMode, typeof MODE_DESCRIPTIONS[VerificationMode]][]).map(([mode, desc]) => (
          <label
            key={mode}
            className={`block p-4 border rounded-lg cursor-pointer transition-colors ${
              selectedMode === mode
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:bg-gray-50'
            }`}
            onClick={() => { clearMessages(); setSelectedMode(mode) }}
          >
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name="verification-mode"
                value={mode}
                checked={selectedMode === mode}
                onChange={() => { clearMessages(); setSelectedMode(mode) }}
                className="text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="font-medium text-sm text-gray-900">{desc.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{desc.description}</p>
              </div>
            </div>
          </label>
        ))}

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || selectedMode === currentMode}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  )
}
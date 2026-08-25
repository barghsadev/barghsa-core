import { useState, useEffect, useCallback } from 'react'
import { withCsrf } from '../lib/csrf.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StorageConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  hasSecretKey: boolean
  forcePathStyle: boolean
  privateEndpointUrl: string
  publicEndpointUrl: string
}

interface TestConnectionResult {
  success: boolean
  message: string
}

/**
 * Fields accepted for updating storage config.
 * All fields are optional; omitted fields keep their current value.
 * The secret key is write-only — never returned by GET.
 */
interface StorageConfigUpdate {
  endpoint?: string | undefined
  region?: string | undefined
  bucket?: string | undefined
  accessKeyId?: string | undefined
  secretAccessKey?: string | undefined
  forcePathStyle?: boolean | undefined
  privateEndpointUrl?: string | undefined
  publicEndpointUrl?: string | undefined
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiUrl(path: string): string {
  return `/api/admin/storage${path}`
}

async function fetchConfig(): Promise<StorageConfig> {
  const res = await fetch(apiUrl('/config'))
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.statusText}`)
  return res.json()
}

async function saveConfig(data: StorageConfigUpdate): Promise<StorageConfig> {
  const res = await fetch(apiUrl('/config'), {
    method: 'PUT',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to save config: ${res.statusText}`)
  return res.json()
}

async function testConnection(data: StorageConfigUpdate): Promise<TestConnectionResult> {
  const res = await fetch(apiUrl('/test-connection'), {
    method: 'POST',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Connection test failed: ${res.statusText}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminStorageConfig() {
  const [config, setConfig] = useState<StorageConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Editable form fields — initialised from config
  const [endpoint, setEndpoint] = useState('')
  const [region, setRegion] = useState('')
  const [bucket, setBucket] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [forcePathStyle, setForcePathStyle] = useState(false)
  const [privateEndpointUrl, setPrivateEndpointUrl] = useState('')
  const [publicEndpointUrl, setPublicEndpointUrl] = useState('')

  useEffect(() => {
    fetchConfig()
      .then((cfg) => {
        setConfig(cfg)
        setEndpoint(cfg.endpoint)
        setRegion(cfg.region)
        setBucket(cfg.bucket)
        setAccessKeyId(cfg.accessKeyId)
        setForcePathStyle(cfg.forcePathStyle)
        setPrivateEndpointUrl(cfg.privateEndpointUrl)
        setPublicEndpointUrl(cfg.publicEndpointUrl)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const clearMessages = useCallback(() => {
    setError(null)
    setSuccess(null)
    setTestResult(null)
  }, [])

  const handleSave = useCallback(async () => {
    clearMessages()
    setSaving(true)
    try {
      await saveConfig({
        endpoint: endpoint || undefined,
        region: region || undefined,
        bucket: bucket || undefined,
        accessKeyId: accessKeyId || undefined,
        secretAccessKey: secretAccessKey || undefined,
        forcePathStyle,
        privateEndpointUrl: privateEndpointUrl || undefined,
        publicEndpointUrl: publicEndpointUrl || undefined,
      })
      setSuccess('Configuration saved.')
      setSecretAccessKey('') // Clear secret key field after save
      // Refresh config to reflect saved state
      const cfg = await fetchConfig()
      setConfig(cfg)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, privateEndpointUrl, publicEndpointUrl, clearMessages])

  const handleTest = useCallback(async () => {
    clearMessages()
    setTesting(true)
    try {
      const result = await testConnection({
        endpoint: endpoint || undefined,
        region: region || undefined,
        bucket: bucket || undefined,
        accessKeyId: accessKeyId || undefined,
        secretAccessKey: secretAccessKey || undefined,
        forcePathStyle,
      })
      setTestResult(result)
    } catch (err: unknown) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }, [endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, clearMessages])

  // -----------------------------------------------------------------------
  // Loading / empty state
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading storage configuration...</p>
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Storage Configuration</h1>

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
        {/* Endpoint */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Endpoint
          </label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => { clearMessages(); setEndpoint(e.target.value) }}
            placeholder="http://localhost:9000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Region */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Region
          </label>
          <input
            type="text"
            value={region}
            onChange={(e) => { clearMessages(); setRegion(e.target.value) }}
            placeholder="us-east-1"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Bucket */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Bucket
          </label>
          <input
            type="text"
            value={bucket}
            onChange={(e) => { clearMessages(); setBucket(e.target.value) }}
            placeholder="my-bucket"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Access Key ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Access Key ID
          </label>
          <input
            type="text"
            value={accessKeyId}
            onChange={(e) => { clearMessages(); setAccessKeyId(e.target.value) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoComplete="off"
          />
        </div>

        {/* Secret Access Key (write-only) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Secret Access Key
            {config?.hasSecretKey && !secretAccessKey && (
              <span className="ml-2 text-xs text-gray-500 font-normal">(configured — leave blank to keep current)</span>
            )}
          </label>
          <input
            type="password"
            value={secretAccessKey}
            onChange={(e) => { clearMessages(); setSecretAccessKey(e.target.value) }}
            placeholder={config?.hasSecretKey ? '••••••••' : 'Enter secret key'}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoComplete="new-password"
          />
        </div>

        {/* Force Path Style */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="force-path-style"
            checked={forcePathStyle}
            onChange={(e) => { clearMessages(); setForcePathStyle(e.target.checked) }}
            className="rounded border-gray-300"
          />
          <label htmlFor="force-path-style" className="text-sm font-medium text-gray-700">
            Force path-style addressing
          </label>
        </div>

        {/* Private Endpoint URL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Private Endpoint URL
          </label>
          <input
            type="text"
            value={privateEndpointUrl}
            onChange={(e) => { clearMessages(); setPrivateEndpointUrl(e.target.value) }}
            placeholder="http://minio:9000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Public Endpoint URL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Public Endpoint URL
          </label>
          <input
            type="text"
            value={publicEndpointUrl}
            onChange={(e) => { clearMessages(); setPublicEndpointUrl(e.target.value) }}
            placeholder="https://storage.example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>

          <button
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {/* Connection test result */}
        {testResult && (
          <div className={`mt-4 p-3 rounded text-sm ${testResult.success ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            <p className="font-medium">{testResult.success ? '✓ Connection successful' : '✗ Connection failed'}</p>
            <p className="mt-1">{testResult.message}</p>
          </div>
        )}
      </div>
    </div>
  )
}
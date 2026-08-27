import { useState, useEffect, useCallback } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { t } from '@barghsa/i18n'
import { useLocale } from '../hooks/useLocale.js'
import { withCsrf } from '../lib/csrf.js'

// ---------------------------------------------------------------------------
// Types (mirror apps/api EmailProviderConfigResult + schemas)
// ---------------------------------------------------------------------------

type Transport = 'smtp' | 'resend'
type Status = 'draft' | 'active' | 'superseded' | 'disabled'
type TestStatus = 'pending' | 'passed' | 'failed'

interface EmailProvider {
  id: string
  transport: Transport
  label: string
  status: Status
  createdBy: string
  activatedAt: string | null
  activatedBy: string | null
  lastTestAt: string | null
  lastTestStatus: TestStatus
  lastTestError: string | null
  supersedesId: string | null
  createdAt: string
  updatedAt: string
}

/** Row returned by `POST :id/test-connection`. */
interface TestConnectionResponse extends EmailProvider {
  test: { ok: boolean; error: string | null }
}

interface TestConnectionOutcome {
  ok: boolean
  error: string | null
}

const STATUS_COLORS: Record<Status, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  superseded: 'bg-gray-100 text-gray-600',
  disabled: 'bg-red-100 text-red-800',
}

const TEST_COLORS: Record<TestStatus, string> = {
  pending: 'bg-gray-100 text-gray-500',
  passed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function apiUrl(path: string): string {
  return `/api/admin/email-providers${path}`
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json()
    if (typeof data?.message === 'string' && data.message) return data.message
    if (typeof data?.error === 'string' && data.error) return data.error
  } catch {
    /* fall through */
  }
  return `HTTP ${res.status}`
}

async function listProviders(): Promise<EmailProvider[]> {
  const res = await fetch(apiUrl(''))
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

async function createProvider(
  transport: Transport,
  label: string,
  config: Record<string, unknown>,
): Promise<EmailProvider> {
  const res = await fetch(apiUrl(''), {
    method: 'POST',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ transport, label, config }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

async function updateProvider(
  id: string,
  body: { label?: string; config?: Record<string, unknown> },
): Promise<EmailProvider> {
  const res = await fetch(apiUrl(`/${id}`), {
    method: 'PUT',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

async function testConnection(
  id: string,
  recipient?: string,
): Promise<TestConnectionOutcome> {
  const res = await fetch(apiUrl(`/${id}/test-connection`), {
    method: 'POST',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(recipient ? { recipient } : {}),
  })
  if (!res.ok) {
    const message = await parseError(res)
    throw new Error(message)
  }
  const data = (await res.json()) as TestConnectionResponse
  return { ok: data.test.ok, error: data.test.error }
}

async function activateProvider(id: string): Promise<EmailProvider> {
  const res = await fetch(apiUrl(`/${id}/activate`), { method: 'POST', headers: withCsrf({}) })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

async function disableProvider(id: string): Promise<EmailProvider> {
  const res = await fetch(apiUrl(`/${id}/disable`), { method: 'POST', headers: withCsrf({}) })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

async function rollbackProvider(id: string): Promise<EmailProvider> {
  const res = await fetch(apiUrl(`/${id}/rollback`), { method: 'POST', headers: withCsrf({}) })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

// ---------------------------------------------------------------------------
// Transport-specific form state
// ---------------------------------------------------------------------------

interface SmtpForm {
  host: string
  port: string
  security: 'TLS' | 'STARTTLS'
  username: string
  password: string
  connectionTimeout: string
  commandTimeout: string
  fromName: string
  fromEmail: string
  replyTo: string
}

interface ResendForm {
  apiKey: string
  fromName: string
  fromEmail: string
  replyTo: string
  sendingDomain: string
}

type TransportForm = SmtpForm | ResendForm

const EMPTY_SMTP: SmtpForm = {
  host: '',
  port: '587',
  security: 'STARTTLS',
  username: '',
  password: '',
  connectionTimeout: '10',
  commandTimeout: '15',
  fromName: '',
  fromEmail: '',
  replyTo: '',
}

const EMPTY_RESEND: ResendForm = {
  apiKey: '',
  fromName: '',
  fromEmail: '',
  replyTo: '',
  sendingDomain: '',
}

function smtpConfig(form: SmtpForm): Record<string, unknown> {
  const config: Record<string, unknown> = {
    host: form.host,
    port: Number(form.port),
    security: form.security,
    connection_timeout: Number(form.connectionTimeout),
    command_timeout: Number(form.commandTimeout),
    from_email: form.fromEmail,
  }
  if (form.username) config.username = form.username
  if (form.password) config.password = form.password
  if (form.fromName) config.from_name = form.fromName
  if (form.replyTo) config.reply_to = form.replyTo
  return config
}

function resendConfig(form: ResendForm): Record<string, unknown> {
  const config: Record<string, unknown> = {
    api_key: form.apiKey,
    from_email: form.fromEmail,
  }
  if (form.fromName) config.from_name = form.fromName
  if (form.replyTo) config.reply_to = form.replyTo
  if (form.sendingDomain) config.sending_domain = form.sendingDomain
  return config
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminEmailProvidersPage() {
  const uiLocale = useLocale()
  const [providers, setProviders] = useState<EmailProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Editor state
  const [showEditor, setShowEditor] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editStatus, setEditStatus] = useState<Status | null>(null)
  const [label, setLabel] = useState('')
  const [transport, setTransport] = useState<Transport>('smtp')
  const [form, setForm] = useState<TransportForm>(EMPTY_SMTP)

  // Per-row test outcome cache
  const [testOutcome, setTestOutcome] = useState<Record<string, TestConnectionOutcome>>({})

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true)
      const data = await listProviders()
      setProviders(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.providers.error.load', uiLocale))
    } finally {
      setLoading(false)
    }
  }, [uiLocale])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  function openCreate() {
    setEditId(null)
    setEditStatus(null)
    setLabel('')
    setTransport('smtp')
    setForm(EMPTY_SMTP)
    setError(null)
    setNotice(null)
    setShowEditor(true)
  }

  function openEdit(p: EmailProvider) {
    // Superseded/disabled versions are read-only; only drafts may be edited.
    if (p.status !== 'draft') {
      setError(t('admin.providers.supersededNote', uiLocale))
      return
    }
    setEditId(p.id)
    setEditStatus(p.status)
    setLabel(p.label)
    setTransport(p.transport)
    setForm(p.transport === 'smtp' ? { ...EMPTY_SMTP } : { ...EMPTY_RESEND })
    setError(null)
    setNotice(null)
    setShowEditor(true)
  }

  function closeEditor() {
    setShowEditor(false)
    setEditId(null)
    setEditStatus(null)
  }

  function handleTransportChange(next: Transport) {
    setTransport(next)
    // Reset the form when switching transports to avoid stale secret fields.
    setForm(next === 'smtp' ? { ...EMPTY_SMTP } : { ...EMPTY_RESEND })
  }

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      // Client-side required-field validation mirrors the server schemas.
      if (!label.trim()) throw new Error(t('admin.providers.field.required', uiLocale))
      if (transport === 'smtp') {
        const f = form as SmtpForm
        if (!f.host.trim() || !f.fromEmail.trim()) {
          throw new Error(t('admin.providers.field.required', uiLocale))
        }
        if (editId) {
          await updateProvider(editId, { label: label.trim(), config: smtpConfig(f) })
        } else {
          await createProvider(transport, label.trim(), smtpConfig(f))
        }
      } else {
        const f = form as ResendForm
        if (!f.apiKey.trim() || !f.fromEmail.trim()) {
          throw new Error(t('admin.providers.field.required', uiLocale))
        }
        if (editId) {
          await updateProvider(editId, { label: label.trim(), config: resendConfig(f) })
        } else {
          await createProvider(transport, label.trim(), resendConfig(f))
        }
      }
      closeEditor()
      await fetchAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.providers.error.save', uiLocale))
    } finally {
      setBusy(false)
    }
  }

  async function handleTest(p: EmailProvider, recipient: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const outcome = await testConnection(p.id, recipient)
      setTestOutcome((prev) => ({ ...prev, [p.id]: outcome }))
      await fetchAll()
    } catch (err) {
      // Connection errors surfaced inline on the row, not as a page error.
      setTestOutcome((prev) => ({
        ...prev,
        [p.id]: { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      }))
    } finally {
      setBusy(false)
    }
  }

  async function handleActivate(p: EmailProvider) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await activateProvider(p.id)
      await fetchAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.providers.error.activate', uiLocale))
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable(p: EmailProvider) {
    if (!window.confirm(t('admin.providers.disableConfirm', uiLocale))) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await disableProvider(p.id)
      await fetchAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.providers.error.disable', uiLocale))
    } finally {
      setBusy(false)
    }
  }

  async function handleRollback(p: EmailProvider) {
    if (!window.confirm(t('admin.providers.rollbackConfirm', uiLocale)))
      return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await rollbackProvider(p.id)
      await fetchAll()
      setNotice(t('admin.providers.rollback', uiLocale))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.providers.error.rollback', uiLocale))
    } finally {
      setBusy(false)
    }
  }

  const activeCount = providers.filter((p) => p.status === 'active').length
  const onlyActive = activeCount === 1

  function activeProviderIsRisky(p: EmailProvider): boolean {
    return p.status === 'active' && onlyActive
  }

  function lastTestLabel(p: EmailProvider): string {
    if (p.lastTestStatus === 'passed') return t('admin.providers.test.passed', uiLocale)
    if (p.lastTestStatus === 'failed') return t('admin.providers.test.failed', uiLocale)
    return t('admin.providers.test.pending', uiLocale)
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.providers.title', uiLocale)}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('admin.providers.subtitle', uiLocale)}</p>
        </div>
        {!showEditor && (
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {t('admin.providers.new', uiLocale)}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
          {error}
          <button
            onClick={() => setError(null)}
            className="absolute top-2 right-2 text-red-500 hover:text-red-700"
            aria-label="dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {notice && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded relative">
          {notice}
          <button
            onClick={() => setNotice(null)}
            className="absolute top-2 right-2 text-green-500 hover:text-green-700"
            aria-label="dismiss notice"
          >
            ✕
          </button>
        </div>
      )}

      {/* Editor */}
      {showEditor && (
        <form onSubmit={handleSave} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold">
            {editId
              ? t('admin.providers.update.title', uiLocale)
              : t('admin.providers.create.title', uiLocale)}
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('admin.providers.label', uiLocale)} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('admin.providers.transport', uiLocale)} <span className="text-red-500">*</span>
            </label>
            <select
              value={transport}
              onChange={(e) => handleTransportChange(e.target.value as Transport)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              disabled={editId !== null}
            >
              <option value="smtp">SMTP</option>
              <option value="resend">Resend</option>
            </select>
          </div>

          {transport === 'smtp' ? (
            <SmtpFields form={form as SmtpForm} setField={setField} editing={editId !== null} />
          ) : (
            <ResendFields form={form as ResendForm} setField={setField} editing={editId !== null} />
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {busy
                ? t('admin.providers.saving', uiLocale)
                : editId
                  ? t('admin.providers.update', uiLocale)
                  : t('admin.providers.create', uiLocale)}
            </button>
            <button
              type="button"
              onClick={closeEditor}
              disabled={busy}
              className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {t('admin.providers.cancel', uiLocale)}
            </button>
          </div>
        </form>
      )}

      {/* Provider list */}
      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">{t('admin.providers.col.label', uiLocale)}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">{t('admin.providers.col.transport', uiLocale)}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">{t('admin.providers.col.status', uiLocale)}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">{t('admin.providers.col.test', uiLocale)}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">{t('admin.providers.col.activated', uiLocale)}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-600">{t('admin.providers.col.actions', uiLocale)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {providers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  {t('admin.providers.empty', uiLocale)}
                </td>
              </tr>
            ) : (
              providers.map((p) => {
                const risky = activeProviderIsRisky(p)
                return (
                  <tr key={p.id} className="align-top">
                    <td className="px-4 py-3 font-medium">{p.label}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs uppercase tracking-wide text-gray-500">
                        {t(`admin.providers.transport.${p.transport}`, uiLocale)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status]}`}>
                        {t(`admin.providers.status.${p.status}`, uiLocale)}
                      </span>
                      {p.status === 'superseded' && (
                        <p className="text-xs text-gray-400 mt-1">{t('admin.providers.supersededNote', uiLocale)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TEST_COLORS[p.lastTestStatus]}`}>
                        {lastTestLabel(p)}
                      </span>
                      {p.lastTestAt && <p className="text-xs text-gray-400 mt-1">{formatDate(p.lastTestAt)}</p>}
                      {p.lastTestError && (
                        <p className="text-xs text-red-600 mt-1" title={p.lastTestError}>{p.lastTestError}</p>
                      )}
                      {(() => {
                        const outcome = testOutcome[p.id]
                        if (outcome) {
                          return (
                            <p className={`text-xs mt-1 ${outcome.ok ? 'text-green-600' : 'text-red-600'}`}>
                              {outcome.ok
                                ? t('admin.providers.test.passed', uiLocale)
                                : outcome.error || t('admin.providers.test.failed', uiLocale)}
                            </p>
                          )
                        }
                        return null
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {p.activatedAt ? formatDate(p.activatedAt) : '—'}
                      {p.activatedAt && p.activatedBy && (
                        <p className="text-xs text-gray-400 mt-1">{t('admin.providers.meta.activatedBy', uiLocale)}: {p.activatedBy}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 space-y-1">
                      {/* Draft row actions */}
                      {p.status === 'draft' && (
                        <>
                          <button
                            onClick={() => openEdit(p)}
                            disabled={busy}
                            className="px-3 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50 disabled:opacity-50 w-full text-left"
                          >
                            {t('admin.providers.update', uiLocale)}
                          </button>
                          {p.transport === 'resend' ? (
                            <ResendTestRow provider={p} onTest={handleTest} busy={busy} />
                          ) : (
                            <button
                              onClick={() => handleTest(p, '')}
                              disabled={busy}
                              className="px-3 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50 disabled:opacity-50 w-full text-left"
                            >
                              {busy ? t('admin.providers.test.running', uiLocale) : t('admin.providers.test.run', uiLocale)}
                            </button>
                          )}
                          <button
                            onClick={() => handleActivate(p)}
                            disabled={busy || p.lastTestStatus !== 'passed'}
                            title={p.lastTestStatus !== 'passed' ? t('admin.providers.activateHint', uiLocale) : undefined}
                            className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-40 w-full text-left"
                          >
                            {t('admin.providers.activate', uiLocale)}
                          </button>
                        </>
                      )}

                      {p.status === 'active' && (
                        <>
                          {risky && (
                            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-2 py-1.5 rounded text-xs mb-2">
                              {t('admin.providers.disableWarn', uiLocale)}
                            </div>
                          )}
                          <button
                            onClick={() => handleDisable(p)}
                            disabled={busy}
                            className="px-3 py-1 border border-red-300 text-red-600 rounded text-xs hover:bg-red-50 disabled:opacity-50 w-full text-left"
                          >
                            {t('admin.providers.disable', uiLocale)}
                          </button>
                        </>
                      )}

                      {(p.status === 'superseded' || p.status === 'disabled') && (
                        <button
                          onClick={() => handleRollback(p)}
                          disabled={busy}
                          className="px-3 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50 disabled:opacity-50 w-full text-left"
                        >
                          {t('admin.providers.rollback', uiLocale)}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Smtp fields
// ---------------------------------------------------------------------------

function SmtpFields({ form, setField, editing }: { form: SmtpForm; setField: (k: string, v: string) => void; editing: boolean }) {
  const uiLocale = useLocale()
  const set = (k: keyof SmtpForm, v: string) => setField(k as string, v)
  const sec = (k: string) => t(`admin.providers.field.${k}`, uiLocale)
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label={sec('host')} required>
        <input type="text" value={form.host} onChange={(e) => set('host', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
      </Field>
      <Field label={sec('port')} required>
        <input type="number" value={form.port} onChange={(e) => set('port', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
      </Field>
      <Field label={sec('security')}>
        <select value={form.security} onChange={(e) => set('security', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2">
          <option value="STARTTLS">STARTTLS</option>
          <option value="TLS">TLS</option>
        </select>
      </Field>
      <Field label={sec('username')}>
        <input type="text" value={form.username} onChange={(e) => set('username', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
      </Field>
      <Field label={sec('password')} secret>
        <input
          type="password"
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
          placeholder={editing ? t('admin.providers.field.secretPlaceholder', uiLocale) : undefined}
          autoComplete="new-password"
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
      </Field>
      <Field label={sec('fromName')}>
        <input type="text" value={form.fromName} onChange={(e) => set('fromName', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
      </Field>
      <Field label={sec('fromEmail')} required>
        <input type="email" value={form.fromEmail} onChange={(e) => set('fromEmail', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
      </Field>
      <Field label={sec('replyTo')}>
        <input type="email" value={form.replyTo} onChange={(e) => set('replyTo', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
      </Field>
    </div>
  )
}

function ResendFields({ form, setField, editing }: { form: ResendForm; setField: (k: string, v: string) => void; editing: boolean }) {
  const uiLocale = useLocale()
  const set = (k: keyof ResendForm, v: string) => setField(k as string, v)
  const sec = (k: string) => t(`admin.providers.field.${k}`, uiLocale)
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label={sec('apiKey')} required secret>
        <input
          type="password"
          value={form.apiKey}
          onChange={(e) => set('apiKey', e.target.value)}
          placeholder={editing ? t('admin.providers.field.secretPlaceholder', uiLocale) : undefined}
          autoComplete="new-password"
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
      </Field>
      <Field label={sec('fromName')}>
        <input type="text" value={form.fromName} onChange={(e) => set('fromName', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
      </Field>
      <Field label={sec('fromEmail')} required>
        <input type="email" value={form.fromEmail} onChange={(e) => set('fromEmail', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
      </Field>
      <Field label={sec('replyTo')}>
        <input type="email" value={form.replyTo} onChange={(e) => set('replyTo', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
      </Field>
      <Field label={sec('sendingDomain')}>
        <input type="text" value={form.sendingDomain} onChange={(e) => set('sendingDomain', e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
      </Field>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resend test row (requires a recipient email)
// ---------------------------------------------------------------------------

function ResendTestRow({ provider, onTest, busy }: { provider: EmailProvider; onTest: (p: EmailProvider, recipient: string) => void; busy: boolean }) {
  const uiLocale = useLocale()
  const [recipient, setRecipient] = useState('')
  return (
    <div className="space-y-1">
      <input
        type="email"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder={t('admin.providers.test.recipient', uiLocale)}
        className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
      />
      <button
        onClick={() => onTest(provider, recipient.trim())}
        disabled={busy || !recipient.trim()}
        className="px-3 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50 disabled:opacity-50 w-full text-left"
      >
        {busy ? t('admin.providers.test.running', uiLocale) : t('admin.providers.test.run', uiLocale)}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

function Field({ label, required, secret, children }: { label: string; required?: boolean; secret?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500"> *</span>}
        {secret && <span className="ml-1 text-xs text-gray-400" />}
      </label>
      {children}
    </div>
  )
}
import { useState, useEffect, useCallback } from 'react'
import type { FormEvent } from 'react'

interface NotificationTemplate {
  id: string
  eventKey: string
  channel: 'email' | 'sms' | 'in_app'
  locale: 'fa' | 'en'
  subject: string | null
  bodyTemplate: string
  variables: string[]
  status: 'draft' | 'active'
  isActive: boolean
  publishedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

type TemplateChannel = 'email' | 'sms' | 'in_app'
type TemplateLocale = 'fa' | 'en'

const CHANNEL_LABELS: Record<TemplateChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  in_app: 'In-App',
}

const LOCALE_LABELS: Record<TemplateLocale, string> = {
  fa: 'فارسی',
  en: 'English',
}

/**
 * Known notification event keys used in the system.
 * These are the canonical events admin can template.
 */
const KNOWN_EVENT_KEYS = [
  'welcome_email',
  'profile_verified',
  'profile_rejected',
  'password_changed',
  'otp_generated',
  'invoice_available',
  'invoice_paid',
  'invoice_overdue',
  'wallet_credited',
  'wallet_debited',
  'contract_signed',
  'contract_expiring',
  'subscription_renewed',
  'subscription_expired',
  'support_ticket_created',
  'support_ticket_resolved',
  'agent_assigned',
]

const CHANNEL_OPTIONS: TemplateChannel[] = ['email', 'sms', 'in_app']
const LOCALE_OPTIONS: TemplateLocale[] = ['fa', 'en']

/**
 * Admin notification template editor page (T-09.04.01).
 *
 * Lists all notification templates, allows creating/editing drafts,
 * publishing active templates, and unpublishing.
 */
export default function AdminNotificationsPage() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [filterLocale, setFilterLocale] = useState<string>('')
  const [filterChannel, setFilterChannel] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')

  // Editor state
  const [showEditor, setShowEditor] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [eventKey, setEventKey] = useState('')
  const [channel, setChannel] = useState<TemplateChannel>('email')
  const [locale, setLocale] = useState<TemplateLocale>('en')
  const [subject, setSubject] = useState('')
  const [bodyTemplate, setBodyTemplate] = useState('')
  const [variablesStr, setVariablesStr] = useState('')
  const [saving, setSaving] = useState(false)

  // Publish confirm state
  const [publishId, setPublishId] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (filterLocale) params.set('locale', filterLocale)
      if (filterChannel) params.set('channel', filterChannel)
      if (filterStatus) params.set('status', filterStatus)
      const qs = params.toString()
      const res = await fetch(`/api/admin/notifications/templates${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTemplates(data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notification templates')
    } finally {
      setLoading(false)
    }
  }, [filterLocale, filterChannel, filterStatus])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  function openCreate() {
    setEditId(null)
    setEventKey(KNOWN_EVENT_KEYS[0]!)
    setChannel('email')
    setLocale('en')
    setSubject('')
    setBodyTemplate('')
    setVariablesStr('')
    setShowEditor(true)
  }

  function openEdit(t: NotificationTemplate) {
    setEditId(t.id)
    setEventKey(t.eventKey)
    setChannel(t.channel)
    setLocale(t.locale)
    setSubject(t.subject ?? '')
    setBodyTemplate(t.bodyTemplate)
    setVariablesStr(t.variables.join(', '))
    setShowEditor(true)
  }

  function closeEditor() {
    setShowEditor(false)
    setEditId(null)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)

    const variables = variablesStr
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)

    const body: Record<string, unknown> = {
      eventKey,
      channel,
      locale,
      bodyTemplate,
      variables,
    }
    if (subject) body.subject = subject

    try {
      if (editId) {
        // Update existing draft
        const updateBody: Record<string, unknown> = {}
        if (subject) updateBody.subject = subject
        updateBody.bodyTemplate = bodyTemplate
        updateBody.variables = variables

        const res = await fetch(`/api/admin/notifications/templates/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateBody),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
        }
      } else {
        // Create new draft
        const res = await fetch('/api/admin/notifications/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
        }
      }

      closeEditor()
      await fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    if (!publishId) return
    setPublishing(true)

    try {
      const res = await fetch(`/api/admin/notifications/templates/${publishId}/publish`, {
        method: 'POST',
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
      }

      setPublishId(null)
      await fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish template')
    } finally {
      setPublishing(false)
    }
  }

  async function handleUnpublish(id: string) {
    if (!window.confirm('Unpublish this template? Active notifications will stop using it until a new version is published.')) return

    try {
      const res = await fetch(`/api/admin/notifications/templates/${id}/unpublish`, {
        method: 'POST',
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
      }
      await fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unpublish template')
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return

    try {
      const res = await fetch(`/api/admin/notifications/templates/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
      }
      await fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template')
    }
  }

  if (loading && templates.length === 0) {
    return <div className="p-4 text-gray-500">Loading notification templates...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notification Templates</h1>
        {!showEditor && (
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            New Template
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
          {error}
          <button
            onClick={() => setError(null)}
            className="absolute top-2 right-2 text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <select
          value={filterLocale}
          onChange={(e) => setFilterLocale(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Locales</option>
          <option value="fa">فارسی</option>
          <option value="en">English</option>
        </select>
        <select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Channels</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="in_app">In-App</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
        </select>
      </div>

      {/* Editor form */}
      {showEditor && (
        <form onSubmit={handleSave} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold">
            {editId ? 'Edit Template' : 'Create New Template'}
          </h2>

          {/* Event key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Event Key <span className="text-red-500">*</span>
            </label>
            {editId ? (
              <p className="text-sm text-gray-500 py-2">{eventKey}</p>
            ) : (
              <select
                value={eventKey}
                onChange={(e) => setEventKey(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
                required
              >
                {KNOWN_EVENT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Channel + Locale */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Channel <span className="text-red-500">*</span>
              </label>
              {editId ? (
                <p className="text-sm text-gray-500 py-2">
                  {CHANNEL_LABELS[channel as TemplateChannel] ?? channel}
                </p>
              ) : (
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as TemplateChannel)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                >
                  {CHANNEL_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Locale <span className="text-red-500">*</span>
              </label>
              {editId ? (
                <p className="text-sm text-gray-500 py-2">
                  {LOCALE_LABELS[locale as TemplateLocale] ?? locale}
                </p>
              ) : (
                <select
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as TemplateLocale)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                >
                  {LOCALE_OPTIONS.map((l) => (
                    <option key={l} value={l}>
                      {LOCALE_LABELS[l]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Subject (email only) */}
          {channel === 'email' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject Line
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
                placeholder="e.g. Your profile has been verified"
                maxLength={200}
              />
            </div>
          )}

          {/* Body template */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Body Template <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-1">
              Use {'{{variableName}}'} for variables. The available variables depend on the event.
            </p>
            <textarea
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
              rows={8}
              required
              dir={locale === 'fa' ? 'rtl' : 'ltr'}
            />
          </div>

          {/* Variables */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Variables (comma-separated)
            </label>
            <p className="text-xs text-gray-400 mb-1">
              Allow-listed variable names that can be used in the template
            </p>
            <input
              type="text"
              value={variablesStr}
              onChange={(e) => setVariablesStr(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
              placeholder="userName, profileLink, verificationCode"
            />
          </div>

          {/* Save / Cancel */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editId ? 'Update Template' : 'Create Template'}
            </button>
            <button
              type="button"
              onClick={closeEditor}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Publish confirm dialog */}
      {publishId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold">Publish Template</h3>
          <p className="text-sm text-gray-600">
            Publishing will make this template active for the event+channel+locale combination.
            Any previously active template for this combination will be deactivated.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {publishing ? 'Publishing...' : 'Publish'}
            </button>
            <button
              onClick={() => setPublishId(null)}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Template list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Event</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Channel</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Locale</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {templates.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No notification templates yet. Create one to get started.
                </td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-mono">{t.eventKey}</td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded ${
                      t.channel === 'email'
                        ? 'bg-blue-100 text-blue-800'
                        : t.channel === 'sms'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {CHANNEL_LABELS[t.channel]}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className={t.locale === 'fa' ? 'font-medium' : ''}>
                    {LOCALE_LABELS[t.locale]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded ${
                      t.status === 'draft'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">
                  {t.subject ?? '—'}
                </td>
                <td className="px-4 py-3">
                  {t.isActive ? (
                    <span className="text-green-600 text-sm font-medium">✓ Active</span>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm space-x-2">
                  {t.status === 'draft' && (
                    <>
                      <button
                        onClick={() => openEdit(t)}
                        className="text-blue-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setPublishId(t.id)}
                        className="text-green-600 hover:underline"
                      >
                        Publish
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </>
                  )}
                  {t.status === 'active' && (
                    <>
                      <button
                        onClick={() => openEdit(t)}
                        className="text-blue-600 hover:underline"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleUnpublish(t.id)}
                        className="text-orange-600 hover:underline"
                      >
                        Unpublish
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
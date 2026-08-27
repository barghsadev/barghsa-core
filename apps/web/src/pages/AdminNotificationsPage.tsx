import { useState, useEffect, useCallback, useRef } from 'react'
import type { FormEvent } from 'react'
import { t } from '@barghsa/i18n'
import { useLocale } from '../hooks/useLocale.js'
import DeadLetterPanel from '../components/DeadLetterPanel.js'
import DeliveryWindowConfigPanel from '../components/DeliveryWindowConfigPanel.js'

interface NotificationVariable {
  name: string
  description: string | null
}

interface NotificationTemplate {
  id: string
  eventKey: string
  channel: 'email' | 'sms' | 'in_app'
  locale: 'fa' | 'en'
  subject: string | null
  bodyTemplate: string
  variables: NotificationVariable[]
  status: 'draft' | 'active' | 'archived'
  isActive: boolean
  version: number
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

/** HTML-escape a value for safe display in a rendered template (mirrors server). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Neutral sample values for each allow-listed variable name (preview / test-send). */
function buildSampleData(variables: NotificationVariable[]): Record<string, string> {
  const data: Record<string, string> = {}
  for (const v of variables) {
    const key = v.name.trim()
    if (key) data[key] = key.replace(/([A-Z])/g, ' $1').trim().toLowerCase()
  }
  return data
}

/** Select just the allow-listed variable names. */
function variableNames(variables: NotificationVariable[]): string[] {
  return variables.map((v) => v.name.trim()).filter(Boolean)
}

/** Substitute {{variable}} placeholders with escaped sample values.
 * MUST mirror NotificationTemplateService.render() (apps/api) so the client
 * preview matches what the server validates on save — keep in lockstep. */
function renderTemplate(
  template: string,
  variables: NotificationVariable[],
  data?: Record<string, string>,
): string {
  const allowed = new Set(variableNames(variables))
  const ctx = data ?? buildSampleData(variables)
  return template.replace(/{{([^{}]+)}}/g, (match, raw: string) => {
    const name = raw.trim()
    if (!allowed.has(name)) return escapeHtml(match)
    const value = ctx[name]
    return escapeHtml(value === undefined ? '' : value)
  })
}

/**
 * Parse the editor's variable textarea/lines into structured variable
 * definitions. Each comma-or-newline-separated entry is either `name` or
 * `name: description`; empty entries and duplicates are dropped and the
 * description defaults to null (legacy template strings round-trip cleanly).
 */
function parseVariablesText(text: string): NotificationVariable[] {
  const out: NotificationVariable[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/[,\n]/)) {
    const entry = raw.trim()
    if (!entry) continue
    const colon = entry.indexOf(':')
    const name = (colon === -1 ? entry : entry.slice(0, colon)).trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const description = colon === -1 ? null : entry.slice(colon + 1).trim()
    out.push({ name, description: description || null })
  }
  return out
}

/** Serialize variable definitions back to the comma-separated text format. */
function variablesToText(variables: NotificationVariable[]): string {
  return variables
    .map((v) => (v.description ? `${v.name}: ${v.description}` : v.name))
    .join(', ')
}

/**
 * Admin notification template editor page (T-09.04.01).
 *
 * Lists all notification templates, allows creating/editing drafts,
 * publishing active templates, and unpublishing.
 */
export default function AdminNotificationsPage() {
  const uiLocale = useLocale()
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

  // Test-send state
  const [testSending, setTestSending] = useState(false)
  const [testSendMsg, setTestSendMsg] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  const parsedVariables = parseVariablesText(variablesStr)

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
      setError(err instanceof Error ? err.message : t('admin.notifications.error.load', uiLocale))
    } finally {
      setLoading(false)
    }
  }, [filterLocale, filterChannel, filterStatus, uiLocale])

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
    setTestSendMsg(null)
    setShowEditor(true)
  }

  function openEdit(template: NotificationTemplate) {
    setEditId(template.id)
    setEventKey(template.eventKey)
    setChannel(template.channel)
    setLocale(template.locale)
    setSubject(template.subject ?? '')
    setBodyTemplate(template.bodyTemplate)
    setVariablesStr(variablesToText(template.variables))
    setTestSendMsg(null)
    setShowEditor(true)
  }

  function closeEditor() {
    setShowEditor(false)
    setEditId(null)
  }

  /** Insert a {{variable}} placeholder at the caret position in the body. */
  function insertVariable(variable: string) {
    const el = bodyRef.current
    if (!el) {
      setBodyTemplate((prev) => `${prev}{{${variable}}}`)
      return
    }
    const start = el.selectionStart ?? bodyTemplate.length
    const end = el.selectionEnd ?? bodyTemplate.length
    const insert = `{{${variable}}}`
    const next = bodyTemplate.slice(0, start) + insert + bodyTemplate.slice(end)
    setBodyTemplate(next)
    requestAnimationFrame(() => {
      if (el) {
        const pos = start + insert.length
        el.focus()
        el.setSelectionRange(pos, pos)
      }
    })
  }

  async function handleTestSend() {
    if (!editId) {
      setTestSendMsg(null)
      return
    }
    setTestSending(true)
    setTestSendMsg(null)
    try {
      const res = await fetch(`/api/admin/notifications/templates/${editId}/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
      }
      setTestSendMsg(t('admin.notifications.testSent', uiLocale))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.notifications.error.testSend', uiLocale))
    } finally {
      setTestSending(false)
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)

    const variables = parseVariablesText(variablesStr)

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
        // Update existing draft; always send subject so an empty subject
        // (cleared by the admin) is persisted as null server-side.
        const updateBody: Record<string, unknown> = {
          subject: subject || null,
          bodyTemplate,
          variables,
        }

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
      setError(err instanceof Error ? err.message : t('admin.notifications.error.save', uiLocale))
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
      setError(err instanceof Error ? err.message : t('admin.notifications.error.publish', uiLocale))
    } finally {
      setPublishing(false)
    }
  }

  async function handleUnpublish(id: string) {
    if (!window.confirm(t('admin.notifications.unpublishConfirm', uiLocale))) return

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
      setError(err instanceof Error ? err.message : t('admin.notifications.error.unpublish', uiLocale))
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('admin.notifications.deleteConfirm', uiLocale))) return

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
      setError(err instanceof Error ? err.message : t('admin.notifications.error.delete', uiLocale))
    }
  }

  if (loading && templates.length === 0) {
    return <div className="p-4 text-gray-500">{t('admin.notifications.loading', uiLocale)}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('admin.notifications.title', uiLocale)}</h1>
        {!showEditor && (
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {t('admin.notifications.newTemplate', uiLocale)}
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

      {/* Delivery-window config (T-05.03.03) */}
      <DeliveryWindowConfigPanel uiLocale={uiLocale} />

      {/* Dead-letter queue (T-05.01.06) */}
      <DeadLetterPanel uiLocale={uiLocale} />

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <select
          value={filterLocale}
          onChange={(e) => setFilterLocale(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        >
          <option value="">{t('admin.notifications.allLocales', uiLocale)}</option>
          <option value="fa">فارسی</option>
          <option value="en">English</option>
        </select>
        <select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        >
          <option value="">{t('admin.notifications.allChannels', uiLocale)}</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="in_app">In-App</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        >
          <option value="">{t('admin.notifications.allStatus', uiLocale)}</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
        </select>
      </div>

      {/* Editor form */}
      {showEditor && (
        <form onSubmit={handleSave} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold">
            {editId
              ? t('admin.notifications.editTitle', uiLocale)
              : t('admin.notifications.createTitle', uiLocale)}
          </h2>

          {/* Event key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('admin.notifications.eventKey', uiLocale)} <span className="text-red-500">*</span>
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
                {t('admin.notifications.channel', uiLocale)} <span className="text-red-500">*</span>
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
                {t('admin.notifications.locale', uiLocale)} <span className="text-red-500">*</span>
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
                {t('admin.notifications.subject', uiLocale)}
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

          {/* Body template + variable sidebar + preview */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('admin.notifications.bodyTemplate', uiLocale)} <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-1">{t('admin.notifications.bodyHint', uiLocale)}</p>
            <div className="flex gap-4">
              <div className="flex-1">
                <textarea
                  ref={bodyRef}
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
                  rows={8}
                  required
                  dir={locale === 'fa' ? 'rtl' : 'ltr'}
                />
              </div>
              {parsedVariables.length > 0 && (
                <aside className="w-48 shrink-0 border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                    {t('admin.notifications.variables', uiLocale)}
                  </h4>
                  <p className="text-[11px] text-gray-400 mb-2">
                    {t('admin.notifications.insertHint', uiLocale)}
                  </p>
                  <ul className="space-y-1">
                    {parsedVariables.map((v) => (
                      <li key={v.name}>
                        <button
                          type="button"
                          onClick={() => insertVariable(v.name)}
                          className="w-full text-left px-2 py-1 text-xs font-mono bg-white border border-gray-200 rounded hover:bg-blue-50 hover:border-blue-300"
                          title={v.description ?? undefined}
                        >
                          {'{{'}
                          {v.name}
                          {'}}'}
                        </button>
                        {v.description && (
                          <p className="px-1 pt-0.5 text-[11px] text-gray-500 leading-snug">
                            {v.description}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </aside>
              )}
            </div>
            {/* Live preview pane */}
            <div className="mt-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
              <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                {t('admin.notifications.preview', uiLocale)}
              </h4>
              {channel === 'email' && subject.trim() !== '' && (
                <p className="text-sm text-gray-700 mb-2" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
                  <span className="font-semibold">{t('admin.notifications.subjectLabel', uiLocale)}</span>{' '}
                  {renderTemplate(subject, parsedVariables)}
                </p>
              )}
              <pre
                className="text-sm whitespace-pre-wrap font-sans text-gray-800"
                dir={locale === 'fa' ? 'rtl' : 'ltr'}
              >
                {renderTemplate(bodyTemplate, parsedVariables)}
              </pre>
            </div>
          </div>

          {/* Variables (allow-list: names + optional descriptions) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('admin.notifications.variablesLabel', uiLocale)}
            </label>
            <p className="text-xs text-gray-400 mb-1">
              {t('admin.notifications.variablesHintNew', uiLocale)}
            </p>
            <textarea
              value={variablesStr}
              onChange={(e) => setVariablesStr(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
              rows={3}
              placeholder="userName: The user's display name, profileLink: Verification link"
              dir="ltr"
            />
          </div>

          {/* Save / Cancel */}
          <div className="flex gap-3 items-center">
            {editId && (
              <>
                <button
                  type="button"
                  onClick={handleTestSend}
                  disabled={testSending || saving}
                  className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  {testSending
                    ? t('admin.notifications.sending', uiLocale)
                    : t('admin.notifications.testSend', uiLocale)}
                </button>
                {testSendMsg && (
                  <span className="text-sm text-green-600">{testSendMsg}</span>
                )}
              </>
            )}
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving
                ? t('admin.notifications.saving', uiLocale)
                : editId
                  ? t('admin.notifications.update', uiLocale)
                  : t('admin.notifications.create', uiLocale)}
            </button>
            <button
              type="button"
              onClick={closeEditor}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              {t('admin.notifications.cancel', uiLocale)}
            </button>
          </div>
        </form>
      )}

      {/* Publish confirm dialog */}
      {publishId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold">{t('admin.notifications.publishTitle', uiLocale)}</h3>
          <p className="text-sm text-gray-600">{t('admin.notifications.publishDesc', uiLocale)}</p>
          <div className="flex gap-3">
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {publishing
                ? t('admin.notifications.publishing', uiLocale)
                : t('admin.notifications.publish', uiLocale)}
            </button>
            <button
              onClick={() => setPublishId(null)}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              {t('admin.notifications.cancel', uiLocale)}
            </button>
          </div>
        </div>
      )}

      {/* Template list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('admin.notifications.col.event', uiLocale)}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('admin.notifications.channel', uiLocale)}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('admin.notifications.locale', uiLocale)}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('admin.notifications.col.status', uiLocale)}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('admin.notifications.col.subject', uiLocale)}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('admin.notifications.col.active', uiLocale)}</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t('admin.notifications.col.actions', uiLocale)}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {templates.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {t('admin.notifications.empty', uiLocale)}
                </td>
              </tr>
            )}
            {templates.map((template) => (
              <tr key={template.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-mono">{template.eventKey}</td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded ${
                      template.channel === 'email'
                        ? 'bg-blue-100 text-blue-800'
                        : template.channel === 'sms'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {CHANNEL_LABELS[template.channel]}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className={template.locale === 'fa' ? 'font-medium' : ''}>
                    {LOCALE_LABELS[template.locale]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded ${
                      template.status === 'draft'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {template.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">
                  {template.subject ?? '—'}
                </td>
                <td className="px-4 py-3">
                  {template.isActive ? (
                    <span className="text-green-600 text-sm font-medium">✓ {t('admin.notifications.active', uiLocale)}</span>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm space-x-2">
                  {template.status === 'draft' && (
                    <>
                      <button
                        onClick={() => openEdit(template)}
                        className="text-blue-600 hover:underline"
                      >
                        {t('admin.notifications.edit', uiLocale)}
                      </button>
                      <button
                        onClick={() => setPublishId(template.id)}
                        className="text-green-600 hover:underline"
                      >
                        {t('admin.notifications.publish', uiLocale)}
                      </button>
                      <button
                        onClick={() => handleDelete(template.id)}
                        className="text-red-600 hover:underline"
                      >
                        {t('admin.notifications.delete', uiLocale)}
                      </button>
                    </>
                  )}
                  {template.status === 'active' && (
                    <>
                      <button
                        onClick={() => openEdit(template)}
                        className="text-blue-600 hover:underline"
                      >
                        {t('admin.notifications.view', uiLocale)}
                      </button>
                      <button
                        onClick={() => handleUnpublish(template.id)}
                        className="text-orange-600 hover:underline"
                      >
                        {t('admin.notifications.unpublish', uiLocale)}
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
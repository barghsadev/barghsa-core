import { useState, useEffect, useCallback } from 'react'
import { t } from '@barghsa/i18n'
import type { Locale } from '@barghsa/i18n'
import {
  renderTemplatePreview,
  buildSampleData,
  type TemplateVariable,
} from '../lib/template-preview.js'

/**
 * Template preview panel (E-05, T-05.04.03).
 *
 * Lets an admin select a notification template by event key, language,
 * channel, and version, then see the rendered subject and body using neutral
 * sample data. It lists the template's allow-listed variables with their
 * descriptions and highlights two kinds of problems:
 *
 *  - Undeclared variables: `{{name}}` placeholders used in the template body
 *    that are NOT in the template's allow-list. Rendered as their literal text
 *    and surfaced as a warning (these are the "missing required variables").
 *  - Missing required variables: allow-listed variables that this preview
 *    could not supply a value for (only occurs when a caller passes explicit
 *    sample data that omits the variable).
 *
 * The panel does not write anything; it only previews stored templates.
 */
export interface TemplateVersionSummary {
  id: string
  version: number
  status: 'draft' | 'active' | 'archived'
  isActive: boolean
  publishedAt: string | null
  subject: string | null
  bodyTemplate: string
  variables: TemplateVariable[]
}

export interface NotificationTemplateForPreview {
  id: string
  eventKey: string
  channel: 'email' | 'sms' | 'in_app'
  locale: 'fa' | 'en'
  version: number
  status: 'draft' | 'active' | 'archived'
  isActive: boolean
  publishedAt: string | null
  subject: string | null
  bodyTemplate: string
  variables: TemplateVariable[]
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

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
}

interface TemplatePreviewPanelProps {
  uiLocale: Locale
  templates: NotificationTemplateForPreview[]
  loading?: boolean
}

export default function TemplatePreviewPanel({
  uiLocale,
  templates,
  loading,
}: TemplatePreviewPanelProps) {
  // Selection state (filters)
  const [eventKey, setEventKey] = useState<string>('')
  const [channel, setChannel] = useState<TemplateChannel | ''>('')
  const [locale, setLocale] = useState<TemplateLocale | ''>('')
  const [versionId, setVersionId] = useState<string>('')

  const eventKeys = [...new Set(templates.map((tp) => tp.eventKey))].sort()

  // Reset selections when they no longer exist among the loaded templates.
  useEffect(() => {
    if (eventKey && !eventKeys.includes(eventKey)) setEventKey('')
  }, [eventKey, eventKeys])

  const channels: TemplateChannel[] =
    eventKey === ''
      ? (['email', 'sms', 'in_app'] as TemplateChannel[])
      : ([...new Set(
          templates.filter((tp) => tp.eventKey === eventKey).map((tp) => tp.channel),
        )] as TemplateChannel[])

  useEffect(() => {
    if (channel && !channels.includes(channel)) setChannel('')
  }, [channel, channels])

  const locales: TemplateLocale[] =
    eventKey === '' || channel === ''
      ? (['fa', 'en'] as TemplateLocale[])
      : ([...new Set(
          templates
            .filter((tp) => tp.eventKey === eventKey && tp.channel === channel)
            .map((tp) => tp.locale),
        )] as TemplateLocale[])

  useEffect(() => {
    if (locale && !locales.includes(locale)) setLocale('')
  }, [locale, locales])

  // Versions for the current selection.
  const versions = templates.filter(
    (tp) =>
      (eventKey === '' || tp.eventKey === eventKey) &&
      (channel === '' || tp.channel === channel) &&
      (locale === '' || tp.locale === locale),
  )

  useEffect(() => {
    if (versionId && !versions.some((v) => v.id === versionId)) setVersionId('')
  }, [versionId, versions])

  const selected =
    versions.find((v) => v.id === versionId) ??
    versions.find((v) => v.isActive) ??
    versions[0]

  const reset = useCallback(() => {
    setEventKey('')
    setChannel('')
    setLocale('')
    setVersionId('')
  }, [])

  const subjectPreview =
    selected?.subject != null && selected.subject.trim() !== ''
      ? renderTemplatePreview(selected.subject, selected.variables)
      : null

  const bodyContext = buildSampleData(selected?.variables)
  const bodyPreview = selected
    ? renderTemplatePreview(selected.bodyTemplate, selected.variables, bodyContext)
    : null

  const undeclared = new Set<string>([
    ...(subjectPreview?.undeclared ?? []),
    ...(bodyPreview?.undeclared ?? []),
  ])
  const missingRequired = new Set<string>([
    ...(subjectPreview?.missingRequired ?? []),
    ...(bodyPreview?.missingRequired ?? []),
  ])
  const problems = new Set([...undeclared, ...missingRequired])

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('admin.notifications.preview.title', uiLocale)}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('admin.notifications.preview.description', uiLocale)}</p>
        </div>
        {eventKey !== '' && (
          <button
            onClick={reset}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            {t('admin.notifications.preview.reset', uiLocale)}
          </button>
        )}
      </div>

      {loading && templates.length === 0 ? (
        <div className="text-gray-500">{t('admin.notifications.loading', uiLocale)}</div>
      ) : (
        <>
          {/* Selection controls: event / language / channel / version */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label htmlFor="tpl-preview-event" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.notifications.eventKey', uiLocale)}
              </label>
              <select
                id="tpl-preview-event"
                value={eventKey}
                onChange={(e) => {
                  setEventKey(e.target.value)
                  setVersionId('')
                }}
                className="w-full border border-gray-300 rounded px-3 py-2"
              >
                <option value="">—</option>
                {eventKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="tpl-preview-channel" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.notifications.channel', uiLocale)}
              </label>
              <select
                id="tpl-preview-channel"
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value as TemplateChannel | '')
                  setVersionId('')
                }}
                className="w-full border border-gray-300 rounded px-3 py-2"
              >
                <option value="">—</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="tpl-preview-locale" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.notifications.locale', uiLocale)}
              </label>
              <select
                id="tpl-preview-locale"
                value={locale}
                onChange={(e) => {
                  setLocale(e.target.value as TemplateLocale | '')
                  setVersionId('')
                }}
                className="w-full border border-gray-300 rounded px-3 py-2"
              >
                <option value="">—</option>
                {locales.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABELS[l]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="tpl-preview-version" className="block text-sm font-medium text-gray-700 mb-1">
                {t('admin.notifications.preview.version', uiLocale)}
              </label>
              <select
                id="tpl-preview-version"
                value={versionId}
                onChange={(e) => setVersionId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
                disabled={versions.length === 0}
              >
                {versions.length === 0 && <option value="">—</option>}
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version} · {STATUS_LABELS[v.status] ?? v.status}
                    {v.isActive ? ' ✓' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Preview results */}
          {!selected ? (
            <p className="text-sm text-gray-500">{t('admin.notifications.preview.empty', uiLocale)}</p>
          ) : (
            <div className="space-y-4">
              {/* Emphasize version metadata + selected identity */}
              <div className="text-xs text-gray-500 space-y-0.5">
                <p>
                  {selected.eventKey} · {CHANNEL_LABELS[selected.channel]} ·{' '}
                  {LOCALE_LABELS[selected.locale]} · v{selected.version} ·{' '}
                  {STATUS_LABELS[selected.status]}
                </p>
              </div>

              {/* Rendered subject (email only) */}
              {selected.channel === 'email' && subjectPreview != null && (
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                    {t('admin.notifications.subjectLabel', uiLocale)}
                  </h4>
                  <p dir={selected.locale === 'fa' ? 'rtl' : 'ltr'} className="text-sm text-gray-800">
                    {subjectPreview.output}
                  </p>
                </div>
              )}

              {/* Rendered body */}
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                  {t('admin.notifications.bodyTemplate', uiLocale)}
                </h4>
                <pre
                  dir={selected.locale === 'fa' ? 'rtl' : 'ltr'}
                  className="text-sm whitespace-pre-wrap font-sans text-gray-800"
                >
                  {bodyPreview?.output}
                </pre>
              </div>

              {/* Available variables + descriptions */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                  {t('admin.notifications.preview.variables', uiLocale)}
                </h4>
                {selected.variables.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {t('admin.notifications.preview.noVariables', uiLocale)}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {selected.variables.map((v) => {
                      const problem = problems.has(v.name)
                      return (
                        <li
                          key={v.name}
                          className={`text-sm px-3 py-1.5 rounded border ${
                            problem
                              ? 'bg-amber-50 border-amber-200 text-amber-800'
                              : 'bg-gray-50 border-gray-200 text-gray-700'
                          }`}
                        >
                          <span className="font-mono">{'{{'}{v.name}{'}}'}</span>
                          {v.description && (
                            <span className="ml-2 text-gray-500">{v.description}</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {/* Missing / undeclared variable warnings */}
              {problems.size > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-amber-900">
                    {t('admin.notifications.preview.warnings.title', uiLocale)}
                  </h4>
                  <ul className="mt-2 space-y-1 text-sm text-amber-800">
                    {[...undeclared].map((name) => (
                      <li key={name}>
                        • {name} — {t('admin.notifications.preview.warnings.undeclared', uiLocale)}
                      </li>
                    ))}
                    {[...missingRequired].map((name) => (
                      <li key={name}>
                        • {name} — {t('admin.notifications.preview.warnings.missing', uiLocale)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
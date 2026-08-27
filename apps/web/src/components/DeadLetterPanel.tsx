import { useState, useEffect, useCallback } from 'react'
import { t } from '@barghsa/i18n'
import type { Locale } from '@barghsa/i18n'

/**
 * Admin dead-letter queue panel (E-05, T-05.01.06).
 *
 * Lists dead-lettered notification deliveries written by the outbox worker
 * when a job exhausts its retry budget, and exposes the three triage actions:
 * Retry (re-queue with the same idempotency key), Resolve (mark final), and
 * Dismiss (acknowledge/remove from the active view).
 *
 * Reads /api/admin/notifications/dead-letters and posts to the per-record
 * action endpoints. Open items default to the front; a toggle reveals all
 * statuses.
 */

interface DeadLetterRow {
  id: string
  outboxId: string
  jobId: string
  channel: 'in_app' | 'email' | 'sms'
  eventKey: string
  severity: 'error' | 'critical'
  profileId: string | null
  userId: string | null
  cause: string | null
  errorCategory: string | null
  attempts: number
  maxAttempts: number
  idempotencyKey: string
  status: 'open' | 'retried' | 'resolved' | 'dismissed'
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  updatedAt: string
}

const STATUS_LABELS: Record<DeadLetterRow['status'], string> = {
  open: 'Open',
  retried: 'Retried',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
}

function channelLabel(channel: DeadLetterRow['channel'], uiLocale: Locale): string {
  const key = `admin.notifications.deadLetter.channel${
    channel === 'email' ? 'Email' : channel === 'sms' ? 'Sms' : 'InApp'
  }` as const
  return t(key, uiLocale)
}

function statusLabel(status: DeadLetterRow['status'], uiLocale: Locale): string {
  const key =
    `admin.notifications.deadLetter.status${
      status === 'open' ? 'Open' : status === 'retried' ? 'Retried' : status === 'resolved' ? 'Resolved' : 'Dismissed'
    }` as const
  return t(key, uiLocale)
}

export default function DeadLetterPanel({ uiLocale }: { uiLocale: Locale }) {
  const [rows, setRows] = useState<DeadLetterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openOnly, setOpenOnly] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = openOnly ? '?status=open' : ''
      const res = await fetch(`/api/admin/notifications/dead-letters${qs}`)
      if (res.status === 403) {
        setError(t('admin.notifications.deadLetter.accessDenied', uiLocale))
        return
      }
      if (!res.ok) {
        setError(t('admin.notifications.deadLetter.loadFailed', uiLocale))
        return
      }
      const data = (await res.json()) as DeadLetterRow[]
      setRows(data)
    } catch {
      setError(t('admin.notifications.deadLetter.loadFailed', uiLocale))
    } finally {
      setLoading(false)
    }
  }, [openOnly, uiLocale])

  useEffect(() => {
    void load()
  }, [load])

  async function act(id: string, action: 'retry' | 'resolve' | 'dismiss') {
    setError(null)
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/notifications/dead-letters/${id}/${action}`, {
        method: 'POST',
      })
      if (res.status === 403) {
        setError(t('admin.notifications.deadLetter.accessDenied', uiLocale))
        return
      }
      if (!res.ok) {
        setError(t('admin.notifications.deadLetter.actionFailed', uiLocale))
        return
      }
      await load()
    } catch {
      setError(t('admin.notifications.deadLetter.actionFailed', uiLocale))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {t('admin.notifications.deadLetter.title', uiLocale)}
        </h2>
        <button
          onClick={() => setOpenOnly((v) => !v)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50"
        >
          {openOnly
            ? t('admin.notifications.deadLetter.openOnly', uiLocale)
            : t('admin.notifications.deadLetter.showAll', uiLocale)}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-4 text-gray-500">{t('admin.notifications.loading', uiLocale)}</div>
      ) : rows.length === 0 ? (
        <div className="p-4 text-gray-500">
          {t('admin.notifications.deadLetter.empty', uiLocale)}
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
          <table
            className="min-w-full divide-y divide-gray-200 text-sm"
            aria-label={t('admin.notifications.deadLetter.title', uiLocale)}
          >
            <caption className="sr-only">
              {t('admin.notifications.deadLetter.title', uiLocale)}
            </caption>
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.eventKey', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.channel', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.severity', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.cause', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.attempts', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.date', uiLocale)}
                </th>
                <th className="px-4 py-2 font-medium text-gray-600">
                  {t('admin.notifications.deadLetter.actions', uiLocale)}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                    {row.eventKey}
                  </td>
                  <td className="px-4 py-3">{channelLabel(row.channel, uiLocale)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        row.severity === 'critical'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {row.severity === 'critical'
                        ? t('admin.notifications.deadLetter.severityCritical', uiLocale)
                        : t('admin.notifications.deadLetter.severityError', uiLocale)}
                    </span>
                    {row.status !== 'open' && (
                      <span className="block text-xs text-gray-400 mt-1">
                        {statusLabel(row.status, uiLocale)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                    {row.cause ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {row.attempts}/{row.maxAttempts}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(row.createdAt).toLocaleString(uiLocale === 'fa' ? 'fa-IR' : 'en-US')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.status === 'open' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => void act(row.id, 'retry')}
                          disabled={busyId === row.id}
                          aria-label={`${t('admin.notifications.deadLetter.retry', uiLocale)} ${row.eventKey}`}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          {t('admin.notifications.deadLetter.retry', uiLocale)}
                        </button>
                        <button
                          onClick={() => void act(row.id, 'resolve')}
                          disabled={busyId === row.id}
                          aria-label={`${t('admin.notifications.deadLetter.resolve', uiLocale)} ${row.eventKey}`}
                          className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                        >
                          {t('admin.notifications.deadLetter.resolve', uiLocale)}
                        </button>
                        <button
                          onClick={() => void act(row.id, 'dismiss')}
                          disabled={busyId === row.id}
                          aria-label={`${t('admin.notifications.deadLetter.dismiss', uiLocale)} ${row.eventKey}`}
                          className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {t('admin.notifications.deadLetter.dismiss', uiLocale)}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

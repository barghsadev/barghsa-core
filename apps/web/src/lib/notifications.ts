import type { Locale } from '@barghsa/i18n'
import { withCsrf } from './csrf.js'

/**
 * Notification center client (E-05, T-05.02.03).
 *
 * Thin typed wrapper over the notification-center API (T-05.02.02):
 *   GET   /api/v1/notifications?cursor=&limit=&filter=
 *   PATCH /api/v1/notifications/read-all
 *   PATCH /api/v1/notifications/:id/read
 *
 * Also provides pure helpers for rendering: interpolation of i18n title/body
 * templates with the row's `params`, and relative-time formatting. These are
 * kept dependency-free (no React) so they can be unit-tested in isolation.
 */

/** A single notification as surfaced by the center. */
export interface NotificationItem {
  id: string
  /** Business type — security | payment | contract | order | system | … */
  type: string
  /** i18n key resolving to the title template. */
  titleI18nKey: string
  /** i18n key resolving to the body template. */
  bodyI18nKey: string
  /** JSON interpolation variables used when rendering title/body. */
  params: Record<string, unknown>
  /** Optional client route the item links to (e.g. '/electricity/order'). */
  linkRoute: string | null
  /** Query/params for the linked route. */
  linkParams: Record<string, unknown> | null
  isRead: boolean
  readAt: string | null
  createdAt: string
}

/** A cursor-keyed page of notifications plus the unread count. */
export interface NotificationPage {
  data: NotificationItem[]
  next_cursor: string | null
  unread_count: number
}

/** Supported notification center filters. */
export type NotificationFilter = 'all' | 'unread'

/** All keys a notification `type` maps to (with a system fallback). */
export const NOTIFICATION_TYPES = [
  'security',
  'payment',
  'contract',
  'order',
  'system',
] as const

/**
 * Map a backend `type` string to its i18n label key. Unknown types fall back
 * to the generic `system` label so the UI never renders a bare key.
 */
export function notificationTypeLabelKey(type: string): string {
  if ((NOTIFICATION_TYPES as readonly string[]).includes(type)) {
    return `notifications.type.${type}`
  }
  return 'notifications.type.system'
}

/**
 * Fetch a page of notifications.
 *
 * @param cursor Opaque cursor to continue pagination (omit for the newest page)
 * @param filter 'all' | 'unread'
 * @param limit Page size (server clamps to 1..100)
 */
export async function fetchNotifications(
  cursor?: string,
  filter: NotificationFilter = 'all',
  limit = 20,
): Promise<NotificationPage> {
  const params = new URLSearchParams({ filter, limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  const res = await fetch(`/api/v1/notifications?${params.toString()}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as NotificationPage
}

/** Mark a single notification read. Returns the fresh unread count. */
export async function markOneRead(id: string): Promise<number> {
  const res = await fetch(
    `/api/v1/notifications/${encodeURIComponent(id)}/read`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: withCsrf({ 'Content-Type': 'application/json' }),
    },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { unread_count: number }
  return body.unread_count
}

/** Mark every notification in the active profile read. Returns the new count. */
export async function markAllRead(): Promise<number> {
  const res = await fetch('/api/v1/notifications/read-all', {
    method: 'PATCH',
    credentials: 'include',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { unread_count: number }
  return body.unread_count
}

/**
 * Interpolate an i18n template string with `params`.
 *
 * Accepts both `{name}` (used by the existing i18n dictionary) and the
 * template-engine double-brace `{{name}}` form, so stored title/body keys
 * render regardless of authoring style. Unknown placeholders are left as-is so
 * missing data never surfaces as `undefined`.
 */
export function interpolate(
  template: string,
  params: Record<string, unknown> = {},
): string {
  return template.replace(/\{\{?(\w+)\}?\}/g, (match, name: string) =>
    params[name] !== undefined && params[name] !== null
      ? String(params[name])
      : match,
  )
}

const RELATIVE_UNITS: Array<{
  unit: Intl.RelativeTimeFormatUnit
  seconds: number
}> = [
  { unit: 'year', seconds: 365 * 24 * 60 * 60 },
  { unit: 'month', seconds: 30 * 24 * 60 * 60 },
  { unit: 'week', seconds: 7 * 24 * 60 * 60 },
  { unit: 'day', seconds: 24 * 60 * 60 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
]

/**
 * Format a past timestamp as a compact relative string in the active locale,
 * e.g. "۳ دقیقه پیش" / "2 hours ago". Future timestamps (clock skew) and
 * anything older than ~a year fall back to an absolute short date.
 */
export function formatRelativeTime(
  date: string | Date,
  locale: Locale,
  now: Date = new Date(),
): string {
  const target = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(target.getTime())) return '—'
  const diffSeconds = Math.floor((target.getTime() - now.getTime()) / 1000)

  if (diffSeconds > -30) return ''

  const abs = Math.abs(diffSeconds)
  const rtf = new Intl.RelativeTimeFormat(
    locale === 'fa' ? 'fa-IR' : 'en',
    { numeric: 'auto' },
  )

  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (abs >= seconds) {
      return rtf.format(Math.round(diffSeconds / seconds), unit)
    }
  }
  // Extremely recent (sub-minute)
  return rtf.format(Math.round(diffSeconds / 60), 'minute')
}

/** True when the given timestamp is older than the supplied cutoff. */
export function isOlderThan(
  date: string | Date,
  cutoffMs: number,
  now: Date = new Date(),
): boolean {
  const target = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(target.getTime())) return false
  return now.getTime() - target.getTime() > cutoffMs
}

/**
 * Build a client navigation target from a notification's `linkRoute` /
 * `linkParams`. Returns null when no route is set so callers can render the
 * item as non-navigable.
 */
export function toNavigationTarget(item: NotificationItem): {
  to: string
  search?: Record<string, unknown>
} | null {
  if (!item.linkRoute) return null
  const target: { to: string; search?: Record<string, unknown> } = {
    to: item.linkRoute,
  }
  if (item.linkParams && Object.keys(item.linkParams).length > 0) {
    target.search = item.linkParams as Record<string, unknown>
  }
  return target
}
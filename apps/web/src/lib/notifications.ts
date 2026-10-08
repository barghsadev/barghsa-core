import { notificationLink } from '@barghsa/shared/notifications';
import type { Locale } from '@barghsa/i18n/app';
export { notificationContent } from './notification-content.js';
import { withCsrf } from './csrf.js';
import { isAccountSettingsPath } from './session-role.js';

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
  id: string;
  /** Business type — security | payment | contract | order | system | … */
  type: string;
  /** i18n key resolving to the title template. */
  localizedContent?: Record<string, { title: string; body: string }> | null;
  titleI18nKey: string;
  /** i18n key resolving to the body template. */
  bodyI18nKey: string;
  /** JSON interpolation variables used when rendering title/body. */
  params: Record<string, unknown>;
  /** Optional client route the item links to (e.g. '/electricity/order'). */
  linkRoute: string | null;
  /** Query/params for the linked route. */
  linkParams: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

/** A cursor-keyed page of notifications plus the unread count. */
export interface NotificationPage {
  data: NotificationItem[];
  next_cursor: string | null;
  unread_count: number;
}

/** Supported notification center filters. */
export type NotificationFilter = 'all' | 'unread';

/** All keys a notification `type` maps to (with a system fallback). */
export const NOTIFICATION_TYPES = [
  'security',
  'payment',
  'contract',
  'order',
  'document',
  'system',
] as const;

/**
 * Map a backend `type` string to its i18n label key. Unknown types fall back
 * to the generic `system` label so the UI never renders a bare key.
 */
export function notificationDisplayType(type: string): (typeof NOTIFICATION_TYPES)[number] {
  const category = type.split(/[._]/, 1)[0];
  if (category === 'auth' || category === 'security') return 'security';
  if (['payment', 'wallet', 'invoice', 'refund', 'chargeback', 'finance'].includes(category ?? ''))
    return 'payment';
  if (category === 'contract' || category === 'order') return category;
  if (category === 'document') return 'document';
  return 'system';
}

export function notificationTypeLabelKey(type: string): string {
  return `notifications.type.${notificationDisplayType(type)}`;
}

export class NotificationApiError extends Error {
  constructor(readonly status: number) {
    super('Notification request unavailable');
  }
}
export const isNotificationDenied = (error: unknown) =>
  error instanceof NotificationApiError && (error.status === 401 || error.status === 403);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function isNotificationItem(value: unknown): value is NotificationItem {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id) &&
    typeof value.type === 'string' &&
    !!value.type.trim() &&
    typeof value.titleI18nKey === 'string' &&
    typeof value.bodyI18nKey === 'string' &&
    record(value.params) &&
    (value.linkRoute === null || typeof value.linkRoute === 'string') &&
    (value.linkParams === null || record(value.linkParams)) &&
    typeof value.isRead === 'boolean' &&
    (value.readAt === null || timestamp(value.readAt)) &&
    timestamp(value.createdAt) &&
    (value.localizedContent == null ||
      (record(value.localizedContent) &&
        Object.values(value.localizedContent).every(
          (content) =>
            record(content) && typeof content.title === 'string' && typeof content.body === 'string'
        )))
  );
}
export function isNotificationPage(value: unknown): value is NotificationPage {
  return (
    record(value) &&
    Array.isArray(value.data) &&
    value.data.every(isNotificationItem) &&
    new Set(value.data.map((item) => item.id)).size === value.data.length &&
    (value.next_cursor === null ||
      (typeof value.next_cursor === 'string' &&
        !!value.next_cursor &&
        value.next_cursor.length <= 2000)) &&
    count(value.unread_count)
  );
}
async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new NotificationApiError(response.status);
  return response.json();
}
async function responseCount(response: Response): Promise<number> {
  const body = await responseJson(response);
  if (!record(body) || !count(body.unread_count)) throw new Error('Invalid unread count');
  return body.unread_count;
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
  limit = 20
): Promise<NotificationPage> {
  const params = new URLSearchParams({ filter, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`/api/v1/notifications?${params.toString()}`, {
    credentials: 'include',
  });
  const body = await responseJson(res);
  if (
    !isNotificationPage(body) ||
    body.data.length > limit ||
    (filter === 'unread' && body.data.some((item) => item.isRead))
  )
    throw new Error('Invalid notification page');
  return body;
}

/** Mark a single notification read. Returns the fresh unread count. */
export async function markOneRead(id: string): Promise<number> {
  const res = await fetch(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
    credentials: 'include',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
  });
  return responseCount(res);
}

/** Mark every notification in the active profile read. Returns the new count. */
export async function markAllRead(): Promise<number> {
  const res = await fetch('/api/v1/notifications/read-all', {
    method: 'PATCH',
    credentials: 'include',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
  });
  return responseCount(res);
}

/**
 * Fetch only the current unread count (T-05.02.04).
 *
 * Backed by the lightweight `GET /api/v1/notifications/unread-count` route so
 * the real-time bell badge can short-poll every 30s without transporting a
 * full notification page.
 */
export async function fetchUnreadCount(): Promise<number> {
  const res = await fetch('/api/v1/notifications/unread-count', {
    credentials: 'include',
  });
  return responseCount(res);
}

/**
 * Interpolate an i18n template string with `params`.
 *
 * Accepts both `{name}` (used by the existing i18n dictionary) and the
 * template-engine double-brace `{{name}}` form, so stored title/body keys
 * render regardless of authoring style. Unknown placeholders are left as-is so
 * missing data never surfaces as `undefined`.
 */
export function interpolate(template: string, params: Record<string, unknown> = {}): string {
  return template.replace(/\{\{?(\w+)\}?\}/g, (match, name: string) =>
    params[name] !== undefined && params[name] !== null ? String(params[name]) : match
  );
}

const RELATIVE_UNITS: Array<{
  unit: Intl.RelativeTimeFormatUnit;
  seconds: number;
}> = [
  { unit: 'year', seconds: 365 * 24 * 60 * 60 },
  { unit: 'month', seconds: 30 * 24 * 60 * 60 },
  { unit: 'week', seconds: 7 * 24 * 60 * 60 },
  { unit: 'day', seconds: 24 * 60 * 60 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
];

/**
 * Format a past timestamp as a compact relative string in the active locale,
 * e.g. "۳ دقیقه پیش" / "2 hours ago". Future timestamps (clock skew) and
 * anything older than ~a year fall back to an absolute short date.
 */
export function formatRelativeTime(
  date: string | Date,
  locale: Locale,
  now: Date = new Date()
): string {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return '—';
  const diffSeconds = Math.floor((target.getTime() - now.getTime()) / 1000);

  if (diffSeconds > -30) return '';

  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale === 'fa' ? 'fa-IR' : 'en', { numeric: 'auto' });

  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (abs >= seconds) {
      return rtf.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  // Extremely recent (sub-minute)
  return rtf.format(Math.round(diffSeconds / 60), 'minute');
}

/** True when the given timestamp is older than the supplied cutoff. */
export function isOlderThan(
  date: string | Date,
  cutoffMs: number,
  now: Date = new Date()
): boolean {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return false;
  return now.getTime() - target.getTime() > cutoffMs;
}

/**
 * Build a client navigation target from a notification's `linkRoute` /
 * `linkParams`. Returns null when no route is set so callers can render the
 * item as non-navigable.
 */
export function toNavigationTarget(
  item: NotificationItem,
  operatingContext: 'staff' | 'customer' = 'customer'
): {
  to: string;
  search?: Record<string, unknown>;
} | null {
  const link = notificationLink(item.linkRoute);
  if (!link) return null;
  const pathname = new URL(link, 'https://barghsa.invalid').pathname;
  const staffRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  if (
    operatingContext === 'staff' &&
    !staffRoute &&
    pathname !== '/app' &&
    !isAccountSettingsPath(pathname)
  )
    return null;
  if (operatingContext === 'customer' && staffRoute) return null;
  const target: { to: string; search?: Record<string, unknown> } = {
    to: link,
  };
  if (item.linkParams && Object.keys(item.linkParams).length > 0) {
    target.search = item.linkParams as Record<string, unknown>;
  }
  return target;
}

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  interpolate,
  formatRelativeTime,
  notificationTypeLabelKey,
  notificationDisplayType,
  toNavigationTarget,
  fetchUnreadCount,
  type NotificationItem,
} from './notifications.js';

describe('interpolate', () => {
  it('replaces {name} placeholders with params', () => {
    expect(interpolate('مبلغ {amount} تومان شارژ شد', { amount: '10000' })).toBe(
      'مبلغ 10000 تومان شارژ شد'
    );
  });

  it('replaces double-brace {{name}} template-style placeholders', () => {
    expect(interpolate('Hello {{user}}!', { user: 'Ali' })).toBe('Hello Ali!');
  });

  it('leaves unknown placeholders untouched and never emits undefined', () => {
    expect(interpolate('Hi {missing}', {})).toBe('Hi {missing}');
    expect(interpolate('Hi {missing}', { missing: undefined })).toBe('Hi {missing}');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-27T12:00:00Z');

  it('returns the empty string for extremely recent timestamps (just now)', () => {
    expect(formatRelativeTime('2026-08-27T11:59:45Z', 'fa', now)).toBe('');
  });

  it('formats minutes in Persian', () => {
    const out = formatRelativeTime('2026-08-27T11:50:00Z', 'fa', now);
    expect(out).toContain('دقیقه پیش');
  });

  it('formats hours in English', () => {
    expect(formatRelativeTime('2026-08-27T09:00:00Z', 'en', now)).toContain('3 hours ago');
  });

  it('handles invalid dates gracefully', () => {
    expect(formatRelativeTime('not-a-date', 'en', now)).toBe('—');
  });
});

describe('notificationTypeLabelKey', () => {
  it('maps known types to their label key', () => {
    expect(notificationTypeLabelKey('security')).toBe('notifications.type.security');
    expect(notificationTypeLabelKey('payment')).toBe('notifications.type.payment');
  });

  it('falls back to system for unknown types', () => {
    expect(notificationTypeLabelKey('mystery')).toBe('notifications.type.system');
  });
});

describe('toNavigationTarget', () => {
  const base: NotificationItem = {
    id: '1',
    type: 'system',
    titleI18nKey: 'x.title',
    bodyI18nKey: 'x.body',
    params: {},
    linkRoute: null,
    linkParams: null,
    isRead: false,
    readAt: null,
    createdAt: '2026-08-27T10:00:00Z',
  };

  it('returns null when there is no link route', () => {
    expect(toNavigationTarget(base)).toBeNull();
  });

  it('returns a route target with search params when present', () => {
    const item = { ...base, linkRoute: '/wallet', linkParams: { state: 'Unpaid' } };
    expect(toNavigationTarget(item)).toEqual({
      to: '/wallet',
      search: { state: 'Unpaid' },
    });
  });

  it('keeps staff links inside the staff workspace', () => {
    expect(toNavigationTarget({ ...base, linkRoute: '/admin/tickets' }, 'staff')).toEqual({
      to: '/admin/tickets',
    });
    for (const path of [
      '/settings',
      '/settings/security/',
      '/settings/privacy',
      '/settings/username',
      '/settings/timezone',
    ]) {
      expect(toNavigationTarget({ ...base, linkRoute: path }, 'staff')).toEqual({ to: path });
    }
    for (const path of [
      '/wallet',
      '/settings/profile',
      '/settings/addresses',
      '/settings/security/extra',
    ]) {
      expect(toNavigationTarget({ ...base, linkRoute: path }, 'staff')).toBeNull();
    }
    expect(toNavigationTarget({ ...base, linkRoute: '/admin/tickets' }, 'customer')).toBeNull();
    expect(toNavigationTarget({ ...base, linkRoute: '/admin/../wallet' }, 'staff')).toBeNull();
    expect(toNavigationTarget({ ...base, linkRoute: '/admin/%2e%2e/wallet' }, 'staff')).toBeNull();
  });
});

describe('fetchUnreadCount', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the unread count from the unread-count endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ unread_count: 7 }),
      })
    );
    await expect(fetchUnreadCount()).resolves.toBe(7);
  });

  it('throws when the endpoint is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchUnreadCount()).rejects.toThrow('HTTP 500');
  });
});

it.each([
  ['auth.password_changed', 'security'],
  ['security.session_revoked', 'security'],
  ['payment.invoice_paid', 'payment'],
  ['wallet.topup_completed', 'payment'],
  ['invoice_paid', 'payment'],
  ['refund.completed', 'payment'],
  ['finance.chargeback_unresolved', 'payment'],
  ['contract.cancelled', 'contract'],
  ['order.submitted', 'order'],
  ['document.review_completed', 'document'],
  ['custom.event', 'system'],
])('renders business event %s with its notification category', (event, category) => {
  expect(notificationDisplayType(event!)).toBe(category);
  expect(notificationTypeLabelKey(event!)).toBe(`notifications.type.${category}`);
});

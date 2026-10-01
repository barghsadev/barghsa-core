import type { NotificationItem } from '../lib/notifications.js';
export const notificationItem = (
  title = 'Current notice',
  id = '10000000-0000-4000-8000-000000000001'
): NotificationItem => ({
  id,
  type: 'payment.invoice_paid',
  titleI18nKey: '',
  bodyI18nKey: '',
  localizedContent: {
    en: { title, body: 'Payment received' },
    fa: { title, body: 'پرداخت دریافت شد' },
  },
  params: {},
  linkRoute: null,
  linkParams: null,
  isRead: false,
  readAt: null,
  createdAt: '2026-10-01T00:00:00Z',
});
export const notificationPage = (title = 'Current notice') => ({
  data: [notificationItem(title)],
  next_cursor: null as string | null,
  unread_count: 1,
});

export const notificationCursor = (
  timestamp = '2026-10-01T00:00:00.123456Z',
  id = '10000000-0000-4000-8000-000000000001'
) => btoa(`${timestamp}|${id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

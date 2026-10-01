import type { NotificationTemplate, TosVersion } from '../lib/content-catalogues.js';
export function notificationTemplate(): NotificationTemplate {
  return {
    id: 'template-recovery',
    eventKey: 'welcome_email',
    channel: 'email',
    locale: 'en',
    subject: 'Recovery subject',
    bodyTemplate: 'Recovery body',
    variables: [],
    status: 'draft',
    isActive: false,
    version: 1,
    publishedAt: null,
    createdBy: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}
export function termsVersion(): TosVersion {
  return {
    id: 'draft-one',
    revision: 'a'.repeat(64),
    versionId: 'v2',
    contentFa: 'شرایط',
    contentEn: 'Terms',
    status: 'draft',
    changeType: null,
    isActive: false,
    publishedAt: null,
    createdBy: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

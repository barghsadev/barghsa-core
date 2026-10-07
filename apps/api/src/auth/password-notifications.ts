import type { PoolClient } from 'pg';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import { NotificationsService } from '../notifications/notifications.service.js';

/** Only the completed credential-change audit is carried to delivery. */
export async function notifyPasswordChanged(
  client: PoolClient,
  userId: string,
  auditId: string,
  notifications: Pick<
    NotificationsService,
    'createAccountBusinessEvent'
  > = new NotificationsService()
): Promise<void> {
  const localizedContent = Object.fromEntries(
    (['fa', 'en'] as const).map((locale) => [
      locale,
      {
        title: securitySettingsText('passwordChangedTitle', locale),
        body: securitySettingsText('passwordChangedBody', locale),
      },
    ])
  ) as Record<'fa' | 'en', { title: string; body: string }>;
  await notifications.createAccountBusinessEvent(
    {
      userId,
      operatingContext: 'account',
      type: 'general',
      ...localizedContent.fa,
      localizedContent,
      link: '/settings/security',
      eventKey: 'auth.password_changed',
      occurrenceKey: `auth.password_changed:${auditId}:${userId}`,
      payload: { auditId },
    },
    client
  );
}

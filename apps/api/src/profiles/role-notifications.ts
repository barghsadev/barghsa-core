import type { PoolClient } from 'pg';
import { lifecycleFormText } from '@barghsa/i18n/profile-lifecycle-forms';
import { NotificationsService } from '../notifications/notifications.service.js';

/** The original account must learn about removal even after profile access is gone. */
export async function notifyAgentRoleChange(
  client: PoolClient,
  input: { recipientUserId: string; profileId: string; roles: string[]; auditId: string },
  notifications: Pick<NotificationsService, 'createProfileRoleEvent'> = new NotificationsService()
): Promise<void> {
  const row = (
    await client.query(
      "SELECT COALESCE(NULLIF(lp.legal_name,''),NULLIF(p.title,''),p.id::text) AS name FROM profiles p LEFT JOIN legal_profiles lp ON lp.id=p.id WHERE p.id=$1",
      [input.profileId]
    )
  ).rows[0];
  if (!row) throw new Error('Role notification profile is missing');
  const roles = [...input.roles].sort();
  const localizedContent = Object.fromEntries(
    (['fa', 'en'] as const).map((locale) => {
      const labels = roles.map((role) =>
        lifecycleFormText(
          ({ Manager: 'roleManager', Finance: 'roleFinance', Legal: 'roleLegal' } as const)[
            role as 'Manager' | 'Finance' | 'Legal'
          ],
          locale
        )
      );
      const body = lifecycleFormText('roleChangedBody', locale).replace(
        /\{(name|roles)\}/g,
        (_, key: string) =>
          key === 'name' ? row.name : labels.join(', ') || lifecycleFormText('roleRemoved', locale)
      );
      return [locale, { title: lifecycleFormText('roleChangedTitle', locale), body }];
    })
  ) as Record<'fa' | 'en', { title: string; body: string }>;
  await notifications.createProfileRoleEvent(
    {
      userId: input.recipientUserId,
      operatingContext: 'customer',
      type: 'general',
      ...localizedContent.fa,
      localizedContent,
      link: '/dashboard',
      eventKey: 'profile.agent_role_changed',
      occurrenceKey: `profile.agent_role_changed:${input.auditId}:${input.recipientUserId}`,
      payload: { auditId: input.auditId, entityName: row.name, newRole: roles.join(', ') || '—' },
    },
    client
  );
}

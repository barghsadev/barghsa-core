import { NotificationsService } from '../notifications/notifications.service.js';

/** The invitation and its registered recipient's notice share the caller's transaction. */
export async function notifyAgentInvitation(
  client: { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> },
  input: { recipientUserId: string; profileId: string; role: string },
  notifications: Pick<NotificationsService, 'create'> = new NotificationsService()
): Promise<void> {
  const row = (
    await client.query(
      "SELECT COALESCE(lp.legal_name,NULLIF(p.title,''),'') AS name FROM profiles p LEFT JOIN legal_profiles lp ON lp.id=p.id WHERE p.id=$1",
      [input.profileId]
    )
  ).rows[0];
  const name = typeof row?.name === 'string' ? row.name : '';
  const roleFa = { Manager: 'مدیر', Finance: 'مالی', Legal: 'حقوقی' }[input.role] ?? input.role;
  const localizedContent = {
    fa: {
      title: 'دعوت به تیم',
      body: `${name || 'یک پروفایل حقوقی'} شما را به عنوان ${roleFa} دعوت کرده است. جزئیات دعوت‌نامه را در داشبورد بررسی کنید و آن را بپذیرید یا رد کنید.`,
    },
    en: {
      title: 'Team invitation',
      body: `${name || 'A legal profile'} has invited you as ${input.role}. Review the invitation on your dashboard and accept or decline it.`,
    },
  };
  // User-scoped: an invitee cannot select the inviting profile before acceptance.
  await notifications.create(
    {
      userId: input.recipientUserId,
      type: 'general',
      ...localizedContent.fa,
      localizedContent,
      link: '/dashboard',
    },
    client
  );
}

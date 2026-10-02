import type { Pool, PoolClient } from 'pg';

/** Read only after history authorization/filtering. Never infer names from login or profile data. */
export async function activityNames(
  client: Pick<Pool | PoolClient, 'query'>,
  userIds: Array<string | null>,
  scope: 'business' | 'payment' = 'business'
) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (!ids.length) return new Map<string, string>();
  const result = await client.query<{ user_id: string; display_name: string }>(
    `SELECT i.user_id,i.display_name FROM conversation_identities i
     JOIN users u ON u.user_id=i.user_id AND u.disabled_at IS NULL AND u.activation_token IS NULL
     WHERE i.user_id=ANY($1::text[]) AND i.display_name IS NOT NULL
       AND (($2::text='business' AND i.share_in_activity)
         OR ($2::text='payment' AND i.share_in_payment_activity))`,
    [ids, scope]
  );
  return new Map(result.rows.map((row) => [row.user_id, row.display_name]));
}

import { withStaffReadAuthority, type StaffReadActor } from './staff-read-authority.js';

export async function searchStaffAccounts(search: string, actor: StaffReadActor) {
  return withStaffReadAuthority(actor, 'admin:staff:view', async (client) => {
    const limit = 10;
    const result = await client.query<{ userId: string; username: string; name: string | null }>(
      `SELECT u.user_id AS "userId", u.username,
              NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '') AS name
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.user_id AND p.is_default = true
       WHERE (u.is_staff OR u.is_admin OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.user_id))
         AND (
           STRPOS(LOWER(u.username), LOWER($1)) > 0
           OR STRPOS(LOWER(TRIM(CONCAT_WS(' ', p.first_name, p.last_name))), LOWER($1)) > 0
         )
       ORDER BY u.username, u.user_id
       LIMIT $2`,
      [search, limit + 1]
    );
    return { items: result.rows.slice(0, limit), hasMore: result.rows.length > limit };
  });
}

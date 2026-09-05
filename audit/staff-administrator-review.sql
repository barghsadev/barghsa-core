-- Read-only account review for the deployment owner. Run against a restored
-- copy before changing any is_admin flag. A candidate is not a confirmed
-- accidental grant: preserve bootstrap and deliberately assigned admins.
SELECT u.user_id, u.username, u.is_admin, u.is_staff, u.disabled_at,
       COALESCE((SELECT array_agg(ur.role_id ORDER BY ur.role_id)
                 FROM user_roles ur WHERE ur.user_id=u.user_id), ARRAY[]::text[]) AS roles,
       EXISTS(SELECT 1 FROM audit_log a
              WHERE a.event='staff_user_created'
                AND a.metadata->>'targetUserId'=u.user_id) AS created_by_staff_flow,
       EXISTS(SELECT 1 FROM user_roles ur
              WHERE ur.user_id=u.user_id AND ur.role_id='role-admin') AS has_admin_role
FROM users u
WHERE u.is_admin=true
ORDER BY u.created_at, u.user_id;

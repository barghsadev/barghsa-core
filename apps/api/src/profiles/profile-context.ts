import {
  hasPermission,
  type AgentRole,
  type AgentPermission,
} from '@barghsa/shared/agent-permissions';

/** Selection is usable only while current ownership or agent membership allows it. */
export function activeProfileSql(permission: AgentPermission = 'profile:view') {
  const roles: AgentRole[] = ['Manager', 'Finance', 'Legal'];
  const permitted =
    roles
      .filter((role) => hasPermission(role, permission))
      .map((role) => `'${role}'`)
      .join(',') || "''";
  return `SELECT p.id,(p.user_id=$1) AS is_owner,
    ARRAY(SELECT pa.role FROM profile_agents pa WHERE pa.profile_id=p.id AND pa.user_id=$1 AND pa.role IN ('Manager','Finance','Legal')) AS roles
    FROM profiles p
  JOIN users u ON u.user_id=$1 AND u.disabled_at IS NULL
  LEFT JOIN user_profile_contexts c ON c.user_id=u.user_id
  WHERE NOT p.archived
    AND (p.user_id=$1 OR (p.profile_type='LEGAL' AND EXISTS (
      SELECT 1 FROM profile_agents pa WHERE pa.profile_id=p.id AND pa.user_id=$1 AND pa.role IN (${permitted}))))
    AND ((c.user_id IS NULL AND p.user_id=$1 AND p.is_default)
      OR (c.user_id IS NOT NULL AND p.id=c.profile_id)) LIMIT 1`;
}
export const ACTIVE_PROFILE_SQL = activeProfileSql();

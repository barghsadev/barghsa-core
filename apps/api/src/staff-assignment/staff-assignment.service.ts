import { Injectable } from '@nestjs/common'
import type { PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { STAFF_ASSIGNMENT_RULES_CONFIG_KEY, toStaffAssignmentRules, validateStaffAssignmentRules, type StaffAssignmentWorkType } from '@barghsa/shared/admin'
import { resolveStaffPermissions } from '../session/staff-permissions.js'

export interface WorkAssignment { userId: string; teamId: string; strategy: string; configVersion: number }
/** Runs only while creating new work, using the caller's transaction. */
@Injectable()
export class StaffAssignmentService {
  async choose(client: PoolClient, workType: StaffAssignmentWorkType, itemId: string, actorId: string, skills: string[]): Promise<WorkAssignment|null> {
    await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))',[STAFF_ASSIGNMENT_RULES_CONFIG_KEY])
    const config = (await client.query('SELECT value,version FROM app_config WHERE key=$1',[STAFF_ASSIGNMENT_RULES_CONFIG_KEY])).rows[0]
    if (!config || !validateStaffAssignmentRules(config.value).ok) return null
    const rule = toStaffAssignmentRules(config.value)[workType]
    if (!rule.teamId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(rule.teamId)) return null
    // Serialize selection against team edits and other selections in this team.
    const team = (await client.query('SELECT id,skill_tags FROM staff_teams WHERE id=$1 AND is_active FOR UPDATE',[rule.teamId])).rows[0]
    if (!team) return null
    if (rule.strategy === 'expertise') {
      const tags = Array.isArray(team.skill_tags) ? team.skill_tags.filter((tag:unknown):tag is string=>typeof tag==='string').map((tag:string)=>tag.trim().toLowerCase()) : []
      // Expertise belongs to the team in the current configuration model.
      // A matching team then selects its least-loaded eligible member.
      if (![workType,...skills].some(skill=>tags.includes(skill))) return null
    }
    const rows = (await client.query(`SELECT u.user_id,u.is_admin,
      ARRAY(SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id) AS role_permissions
      FROM users u JOIN staff_team_members m ON m.user_id=u.user_id
      WHERE m.team_id=$1 AND u.disabled_at IS NULL AND u.activation_token IS NULL
        AND ($2::text IS NULL OR u.user_id<>$2)
      ORDER BY u.user_id FOR NO KEY UPDATE OF u`,[rule.teamId,workType==='verification_case'?actorId:null])).rows
    const candidates = rows.filter(row=>{
      const permissions=resolveStaffPermissions(row.role_permissions)
      return row.is_admin || permissions.includes('*') || (workType==='ticket'
        ? permissions.some(permission=>['tickets:*','tickets:write','tickets:assigned'].includes(permission))
        : permissions.includes('crm:verify') && permissions.includes('verification:read'))
    }).map(row=>row.user_id as string)
    if (!candidates.length) return null
    let userId: string
    if (rule.strategy === 'round_robin') {
      const previous=(await client.query('SELECT last_user_id FROM staff_assignment_cursors WHERE team_id=$1 AND work_type=$2',[rule.teamId,workType])).rows[0]?.last_user_id as string|undefined
      userId=candidates[(candidates.indexOf(previous ?? '')+1)%candidates.length]!
      await client.query(`INSERT INTO staff_assignment_cursors(team_id,work_type,last_user_id) VALUES ($1,$2,$3)
        ON CONFLICT(team_id,work_type) DO UPDATE SET last_user_id=EXCLUDED.last_user_id,updated_at=NOW()`,[rule.teamId,workType,userId])
    } else {
      const loads=(await client.query(`SELECT u.user_id,
        (SELECT count(*) FROM tickets t WHERE t.assigned_to=u.user_id AND t.status NOT IN ('resolved','closed'))+
        (SELECT count(*) FROM verification_cases v WHERE v.assigned_to=u.user_id AND v.status IN ('Open','Under Review')) AS work_count
        FROM users u WHERE u.user_id=ANY($1::text[]) ORDER BY work_count,u.user_id LIMIT 1`,[candidates])).rows
      userId=loads[0].user_id
    }
    const assignment={userId,teamId:rule.teamId,strategy:rule.strategy,configVersion:config.version as number}
    await client.query(`INSERT INTO audit_log(id,user_id,event,metadata) VALUES ($1,$2,'work_auto_assigned',$3::jsonb)`,
      [randomUUID(),actorId,JSON.stringify({workType,itemId,...assignment})])
    return assignment
  }
}

import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  STAFF_ASSIGNMENT_RULES_CONFIG_KEY,
  toStaffAssignmentRules,
  validateStaffAssignmentRules,
  type StaffAssignmentWorkType,
} from '@barghsa/shared/admin';
import { resolveStaffPermissions } from '../session/staff-permissions.js';

export interface WorkAssignment {
  userId: string;
  teamId: string;
  strategy: string;
  configVersion: number;
}
/** Runs only while creating new work, using the caller's transaction. */
@Injectable()
export class StaffAssignmentService {
  async choose(
    client: PoolClient,
    workType: StaffAssignmentWorkType,
    itemId: string,
    actorId: string,
    skills: string[],
    additionalUserLocks: string[] = []
  ): Promise<WorkAssignment | null> {
    await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [
      STAFF_ASSIGNMENT_RULES_CONFIG_KEY,
    ]);
    const config = (
      await client.query('SELECT value,version FROM app_config WHERE key=$1', [
        STAFF_ASSIGNMENT_RULES_CONFIG_KEY,
      ])
    ).rows[0];
    if (!config || !validateStaffAssignmentRules(config.value).ok) return null;
    const configured = toStaffAssignmentRules(config.value)[workType];
    if (!configured.teamId) return null;
    const choices = [
      { teamId: configured.teamId, strategy: configured.strategy },
      ...(configured.fallbacks ?? []),
    ];
    if (
      choices.some(
        (choice) =>
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(choice.teamId)
      )
    )
      return null;
    const teamIds = choices.map((choice) => choice.teamId).sort();
    // Lock every candidate team and member in stable order before applying priority.
    // Opposite fallback orders must not produce opposite lock orders.
    const teams = (
      await client.query(
        'SELECT id,skill_tags FROM staff_teams WHERE id=ANY($1::uuid[]) AND is_active ORDER BY id FOR UPDATE',
        [teamIds]
      )
    ).rows;
    if (additionalUserLocks.length) {
      // Callers that validate an actor after choosing must include that account
      // in the same ordered lock set as candidates. Teams always come first.
      await client.query(
        `SELECT u.user_id FROM users u
         WHERE u.user_id=ANY($2::text[]) OR EXISTS (
           SELECT 1 FROM staff_team_members m
           WHERE m.user_id=u.user_id AND m.team_id=ANY($1::uuid[])
         ) ORDER BY u.user_id FOR NO KEY UPDATE OF u`,
        [teams.map((team) => team.id), additionalUserLocks]
      );
    }
    const rows = (
      await client.query(
        `SELECT u.user_id,u.is_admin,m.team_id
       FROM users u JOIN staff_team_members m ON m.user_id=u.user_id
       WHERE m.team_id=ANY($1::uuid[]) AND u.disabled_at IS NULL AND u.activation_token IS NULL
         AND ($2::text IS NULL OR u.user_id<>$2)
       ORDER BY u.user_id,m.team_id FOR NO KEY UPDATE OF u`,
        [teams.map((team) => team.id), workType === 'verification_case' ? actorId : null]
      )
    ).rows;
    const roles = await client.query(
      `SELECT ur.user_id,r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id
       WHERE ur.user_id=ANY($1::text[]) ORDER BY r.role_id,ur.user_id FOR SHARE OF ur,r`,
      [[...new Set(rows.map((row) => row.user_id))]]
    );
    const permissionsByUser = new Map<string, unknown[]>();
    for (const role of roles.rows) {
      const permissions = permissionsByUser.get(role.user_id) ?? [];
      permissions.push(role.permissions);
      permissionsByUser.set(role.user_id, permissions);
    }
    for (const [priorityIndex, rule] of choices.entries()) {
      const team = teams.find((candidate) => candidate.id === rule.teamId);
      if (!team) continue;
      if (rule.strategy === 'expertise') {
        const tags: string[] = Array.isArray(team.skill_tags)
          ? team.skill_tags
              .filter((tag: unknown): tag is string => typeof tag === 'string')
              .map((tag: string) => tag.trim().toLowerCase())
          : [];
        if (![workType, ...skills].some((skill) => tags.includes(skill.trim().toLowerCase())))
          continue;
      }
      const candidates = rows
        .filter((row) => row.team_id === rule.teamId)
        .filter((row) => {
          const permissions = resolveStaffPermissions(permissionsByUser.get(row.user_id));
          return (
            row.is_admin ||
            permissions.includes('*') ||
            (workType === 'ticket'
              ? permissions.some((permission) =>
                  ['tickets:*', 'tickets:write', 'tickets:assigned'].includes(permission)
                )
              : permissions.includes('crm:verify') && permissions.includes('verification:read'))
          );
        })
        .map((row) => row.user_id as string);
      if (!candidates.length) continue;
      let userId: string;
      if (rule.strategy === 'round_robin') {
        const previous = (
          await client.query(
            'SELECT last_user_id FROM staff_assignment_cursors WHERE team_id=$1 AND work_type=$2',
            [rule.teamId, workType]
          )
        ).rows[0]?.last_user_id as string | undefined;
        userId = candidates[(candidates.indexOf(previous ?? '') + 1) % candidates.length]!;
        await client.query(
          `INSERT INTO staff_assignment_cursors(team_id,work_type,last_user_id) VALUES ($1,$2,$3)
        ON CONFLICT(team_id,work_type) DO UPDATE SET last_user_id=EXCLUDED.last_user_id,updated_at=NOW()`,
          [rule.teamId, workType, userId]
        );
      } else {
        const loads = (
          await client.query(
            `SELECT u.user_id,
        (SELECT count(*) FROM tickets t WHERE t.assigned_to=u.user_id AND t.status NOT IN ('resolved','closed'))+
        (SELECT count(*) FROM verification_cases v WHERE v.assigned_to=u.user_id AND v.status IN ('Open','Under Review')) AS work_count
        FROM users u WHERE u.user_id=ANY($1::text[]) ORDER BY work_count,u.user_id LIMIT 1`,
            [candidates]
          )
        ).rows;
        userId = loads[0].user_id;
      }
      const assignment = {
        userId,
        teamId: rule.teamId,
        strategy: rule.strategy,
        configVersion: config.version as number,
      };
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata) VALUES ($1,$2,'work_auto_assigned',$3::jsonb)`,
        [randomUUID(), actorId, JSON.stringify({ workType, itemId, priorityIndex, ...assignment })]
      );
      return assignment;
    }
    return null;
  }
}

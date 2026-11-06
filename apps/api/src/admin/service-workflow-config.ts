import {
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getDbPool } from '@barghsa/db';
import type { Pool, PoolClient } from 'pg';
import {
  DEFAULT_SERVICE_WORKFLOWS,
  SERVICE_WORKFLOW_CONFIG_KEY,
  SERVICE_WORKFLOW_KEYS,
  isServiceWorkflowPolicy,
  type ServiceWorkflowPolicy,
  type ServiceWorkflowView,
} from '@barghsa/shared/admin';
import type { ValidatedSession } from '../session/session.service.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

async function state(db: Pool | PoolClient): Promise<ServiceWorkflowView> {
  const row = (
    await db.query('SELECT value,version FROM app_config WHERE key=$1', [
      SERVICE_WORKFLOW_CONFIG_KEY,
    ])
  ).rows[0];
  const policy: unknown = row ? row.value : structuredClone(DEFAULT_SERVICE_WORKFLOWS);
  if (!isServiceWorkflowPolicy(policy))
    throw new ServiceUnavailableException('Invalid service workflow policy');
  const roles = (await db.query('SELECT role_id AS id,name FROM staff_roles ORDER BY name,role_id'))
    .rows;
  const teams = (await db.query('SELECT id,name FROM staff_teams WHERE is_active ORDER BY name,id'))
    .rows;
  return { policy, version: Number(row?.version ?? 0), roles, teams };
}
export async function readServiceWorkflows() {
  return state(getDbPool());
}
export async function saveServiceWorkflows(
  policy: ServiceWorkflowPolicy,
  expectedVersion: number,
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
  ip: string
) {
  if (!isServiceWorkflowPolicy(policy)) throw new BadRequestException('Invalid service workflows');
  const client = await getDbPool().connect();
  const authorize = async () => {
    await requireStaffMutationPermission(client, actor.userId, 'admin:service-targets:edit');
    await requireStaffMutationPermission(client, actor.userId, 'admin:service-escalation:edit');
    await requireSessionStepUp(client, actor);
  };
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [SERVICE_WORKFLOW_CONFIG_KEY]);
    await authorize();
    // Reference changes and worker recipients serialize on the same protected tables.
    await client.query(
      'LOCK TABLE users,staff_roles,user_roles,staff_teams,staff_team_members IN SHARE MODE'
    );
    const previous = await state(client);
    if (previous.version !== expectedVersion)
      throw new ConflictException('Service workflow policy changed');
    for (const key of SERVICE_WORKFLOW_KEYS) {
      const rule = policy[key]?.escalation;
      for (const audience of rule ? [rule.from, rule.to] : []) {
        if (
          (audience.kind === 'role' && !previous.roles.some((r) => r.id === audience.id)) ||
          (audience.kind === 'team' && !previous.teams.some((r) => r.id === audience.id))
        )
          throw new ConflictException('Selected routing role or team is unavailable');
      }
    }
    await client.query(
      `INSERT INTO app_config(key,value,version,updated_at) VALUES($1,$2::jsonb,1,NOW())
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=app_config.version+1,updated_at=NOW()`,
      [SERVICE_WORKFLOW_CONFIG_KEY, JSON.stringify(policy)]
    );
    await client.query(
      "UPDATE config_version SET version=version+1,updated_at=NOW() WHERE id='global'"
    );
    const next = { ...previous, policy, version: previous.version + 1 };
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
      VALUES($1,$2,'config_change',$3::jsonb,$4,$5)`,
      [
        randomUUID(),
        actor.userId,
        JSON.stringify({
          key: SERVICE_WORKFLOW_CONFIG_KEY,
          previous,
          next,
          sessionId: actor.sessionId,
        }),
        correlationIdStorage.getStore() ?? randomUUID(),
        ip,
      ]
    );
    await authorize();
    await client.query('COMMIT');
    return next;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { tServiceSettings } from '@barghsa/i18n/service-settings';
import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@barghsa/db';
import {
  SERVICE_WORKFLOW_CONFIG_KEY,
  SERVICE_WORKFLOW_KEYS,
  SERVICE_WORKFLOW_TARGETS,
  DEFAULT_SERVICE_WORKFLOWS,
  isServiceWorkflowPolicy,
  managedServiceWorkflows,
  serviceWorkflowBasis,
  type ServiceWorkflowKey,
  type ServiceWorkflowPolicy,
  type WorkflowAudience,
} from '@barghsa/shared/admin';
import { enqueueOutbox } from '../notifications/outbox-writer.js';

/** Static SQL only. No administrator-provided table, predicate, permission or route is executed. */
function domain(key: ServiceWorkflowKey) {
  const spec = SERVICE_WORKFLOW_TARGETS[key];
  if (spec.workType === 'ticket')
    return {
      table: 'tickets',
      predicate: `status IN ('open','in_progress','waiting_staff') AND priority='${spec.priority}'`,
      clock: 'updated_at',
      owner: 'assigned_to',
      permission: 'tickets:read',
      route: '/admin/tickets',
    };
  if (spec.workType === 'verification_case')
    return {
      table: 'verification_cases',
      predicate: "status IN ('Open','Under Review')",
      clock: 'updated_at',
      owner: 'COALESCE(assigned_to,created_by)',
      permission: 'verification:read',
      route: '/admin/crm/corrections',
    };
  if (spec.workType === 'consultation')
    return {
      table: 'consultation_requests',
      predicate: "status IN ('submitted','under_review','offer_accepted')",
      clock: 'updated_at',
      owner: 'staff_owner_id',
      permission: 'orders:read',
      route: '/admin/consultations',
    };
  if (spec.workType === 'contract_review')
    return {
      table: 'contracts',
      predicate: `state='AwaitingStaffReview' AND service_type='${spec.service}'`,
      clock: 'updated_at',
      owner: 'NULL::text',
      permission: 'contracts:read',
      route: '/admin/contracts',
    };
  if (key === 'electricity_order')
    return {
      table: 'electricity_orders',
      predicate: "status IN ('submitted','awaiting_staff_review','approved')",
      clock: 'submitted_at',
      owner: 'NULL::text',
      permission: 'orders:read',
      route: '/admin/electricity-orders',
    };
  if (key === 'saving_order')
    return {
      table: 'saving_orders',
      predicate:
        "status IN ('submitted','awaiting_staff_review') OR (status IN ('approved','in_progress') AND financial_status='paid')",
      clock: 'submitted_at',
      owner: 'NULL::text',
      permission: 'orders:read',
      route: '/admin/saving-orders',
    };
  return {
    table: 'solar_construction_requests',
    predicate:
      "status IN ('submitted','documents_under_review','postal_documents_received','final_review','approved')",
    clock: 'submitted_at',
    owner: 'NULL::text',
    permission: 'orders:read',
    route: '/admin/solar-requests',
  };
}
type Db = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
export async function readWorkflowPolicy(db: Db): Promise<ServiceWorkflowPolicy> {
  const row = (
    await db.query('SELECT key,value FROM app_config WHERE key=$1', [SERVICE_WORKFLOW_CONFIG_KEY])
  ).rows[0];
  if (!row || row.key !== SERVICE_WORKFLOW_CONFIG_KEY)
    return structuredClone(DEFAULT_SERVICE_WORKFLOWS);
  if (!isServiceWorkflowPolicy(row.value)) throw new Error('Invalid service workflow policy');
  return row.value;
}
export async function workflowManagedTypes(pool: Db) {
  return managedServiceWorkflows(await readWorkflowPolicy(pool));
}
interface Recipient {
  user_id: string;
  is_admin: boolean;
  permissions: string[];
  roles: string[];
  teams: string[];
}
function inAudience(a: WorkflowAudience, user: Recipient) {
  return (
    a.kind === 'any' ||
    (a.kind === 'admins' && user.is_admin) ||
    (a.kind === 'role' && user.roles.includes(a.id)) ||
    (a.kind === 'team' && user.teams.includes(a.id))
  );
}
function canRead(user: Recipient, permission: string, owner: string | null) {
  return (
    user.is_admin ||
    user.permissions.includes('*') ||
    user.permissions.includes(permission) ||
    user.permissions.includes(`${permission.split(':')[0]}:*`) ||
    (permission === 'tickets:read' &&
      user.user_id === owner &&
      user.permissions.includes('tickets:assigned'))
  );
}
async function staff(client: PoolClient): Promise<Recipient[]> {
  // Do not give a recipient access to a business item. Only current readers receive even its ID.
  return (
    await client.query<Recipient>(`SELECT u.user_id,u.is_admin,
    ARRAY(SELECT DISTINCT p FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id,
      LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.permissions::jsonb)='array' THEN r.permissions::jsonb ELSE '[]'::jsonb END) p WHERE ur.user_id=u.user_id) AS permissions,
    ARRAY(SELECT role_id FROM user_roles WHERE user_id=u.user_id) AS roles,
    ARRAY(SELECT m.team_id::text FROM staff_team_members m JOIN staff_teams t ON t.id=m.team_id AND t.is_active WHERE m.user_id=u.user_id) AS teams
    FROM users u WHERE disabled_at IS NULL AND activation_token IS NULL AND
      (is_admin OR is_staff OR EXISTS(SELECT 1 FROM user_roles WHERE user_id=u.user_id)) ORDER BY u.user_id`)
  ).rows;
}
export async function scanServiceWorkflows(
  options: {
    pool?: Pool;
    now?: () => Date;
    batchSize?: number;
    enqueue?: typeof enqueueOutbox;
  } = {}
) {
  const pool = options.pool ?? getDbPool(),
    now = options.now?.() ?? new Date();
  const size = options.batchSize ?? 200,
    enqueue = options.enqueue ?? enqueueOutbox;
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Invalid workflow page size');
  const result = { alerted: 0, escalated: 0, pruned: 0, errors: [] as string[] };
  for (const key of SERVICE_WORKFLOW_KEYS) {
    let after: string | null = null;
    let more = true;
    while (more) {
      const client = await pool.connect();
      const counts = { alerted: 0, escalated: 0, pruned: 0 };
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [
          SERVICE_WORKFLOW_CONFIG_KEY,
        ]);
        const policy = await readWorkflowPolicy(client),
          target = policy[key],
          type = `workflow_${key}`;
        const d = domain(key);
        if (!target) {
          counts.pruned =
            (await client.query('DELETE FROM service_breach_alerts WHERE service_type=$1', [type]))
              .rowCount ?? 0;
          await client.query('COMMIT');
          result.pruned += counts.pruned;
          break;
        }
        const fingerprint = createHash('sha256')
          .update(serviceWorkflowBasis({ ...DEFAULT_SERVICE_WORKFLOWS, [key]: target }))
          .digest('hex');
        const cutoff = new Date(now.getTime() - target.hours * 3600000);
        // ponytail: table SHARE locks keep each page's recipients current. Use ordered
        // recipient row locks if staff volume makes these bounded pages too slow.
        await client.query(
          'LOCK TABLE users,staff_roles,user_roles,staff_teams,staff_team_members IN SHARE MODE'
        );
        const members = await staff(client);
        counts.pruned =
          (
            await client.query(
              `DELETE FROM service_breach_alerts l WHERE l.service_type=$1 AND
          (l.policy_fingerprint IS DISTINCT FROM $2 OR NOT EXISTS(SELECT 1 FROM ${d.table} r
            WHERE r.id::text=l.item_id AND (${d.predicate}) AND r.${d.clock} <= $3
              AND r.${d.clock}=l.source_activity_at))`,
              [type, fingerprint, cutoff]
            )
          ).rowCount ?? 0;
        const rows: {
          id: string;
          owner: string | null;
          activity: string;
          priority_due: boolean;
        }[] = (
          await client.query<{
            id: string;
            owner: string | null;
            activity: string;
            priority_due: boolean;
          }>(
            `SELECT id::text,${d.owner} AS owner,${d.clock}::text AS activity,
            ${d.clock} <= $4::timestamptz - ($5::integer * INTERVAL '1 hour') AS priority_due FROM ${d.table}
          WHERE (${d.predicate}) AND ${d.clock}<=$1 AND ($2::text IS NULL OR id::text>$2)
          ORDER BY id::text LIMIT $3 FOR SHARE`,
            [cutoff, after, size, now, target.escalation?.afterHours ?? 1]
          )
        ).rows;
        more = rows.length === size;
        after = rows.at(-1)?.id ?? after;
        for (const row of rows) {
          const readers = members.filter((u) => canRead(u, d.permission, row.owner));
          const rule = target.escalation;
          const assigned = readers.filter((u) => u.user_id === row.owner);
          const initial = assigned.length
            ? assigned
            : rule && rule.from.kind !== 'any'
              ? readers.filter((u) => inAudience(rule.from, u))
              : readers.filter((u) => u.is_admin);
          const destination = rule ? readers.filter((u) => inAudience(rule.to, u)) : [];
          if (!initial.length && !destination.length) continue; // keep retryable, no silent claim
          const fresh = (
            await client.query<{ id: string }>(
              `INSERT INTO service_breach_alerts(service_type,item_id,target_hours,source_activity_at,policy_fingerprint,alerted_at)
            VALUES($1,$2,$3,$4::timestamptz,$5,$6) ON CONFLICT(service_type,item_id) DO NOTHING RETURNING id`,
              [type, row.id, target.hours, row.activity, fingerprint, now]
            )
          ).rows[0];
          if (target.notification === 'breach' && !initial.length) {
            // A missing first recipient must not permanently suppress that notification.
            if (fresh)
              await client.query('DELETE FROM service_breach_alerts WHERE id=$1', [fresh.id]);
            continue;
          }
          const episode = (
            await client.query<{ id: string; alerted_at: Date; escalation_level: number }>(
              'SELECT id,alerted_at,escalation_level FROM service_breach_alerts WHERE service_type=$1 AND item_id=$2 FOR UPDATE',
              [type, row.id]
            )
          ).rows[0]!;
          async function notify(
            users: Recipient[],
            eventKey: string,
            email: boolean,
            level: number
          ) {
            for (const user of users)
              await enqueue(client, {
                profileId: null,
                userId: user.user_id,
                eventKey,
                payload: {
                  service_type: type,
                  service_type_name_fa: tServiceSettings(`workflow.${key}`, 'fa'),
                  service_type_name_en: tServiceSettings(`workflow.${key}`, 'en'),
                  item_id: row.id,
                  target_hours: target!.hours,
                  escalation_level: level,
                  link_route: d.route,
                },
                channels: email ? ['in_app', 'email'] : ['in_app'],
                idempotencyKey: `${eventKey}:${episode.id}:${level}:${user.user_id}`,
              });
          }
          if (fresh && target.notification === 'breach') {
            await notify(initial, 'admin.service_target_breached', target.email, 1);
            counts.alerted++;
          }
          if (!rule || episode.escalation_level !== 1 || !destination.length) continue;
          const sourceMatches =
            rule.from.kind === 'any' ||
            readers.some(
              (u) => inAudience(rule.from, u) && (!row.owner || u.user_id === row.owner)
            );
          const due =
            rule.condition === 'ticket_priority'
              ? row.priority_due
              : now.getTime() >= episode.alerted_at.getTime() + rule.afterHours * 3600000;
          if (!sourceMatches || !due) continue;
          const claim = await client.query(
            `UPDATE service_breach_alerts SET escalation_level=2,escalated_at=$2,updated_at=$2 WHERE id=$1 AND escalation_level=1 RETURNING id`,
            [episode.id, now]
          );
          if (!claim.rowCount) continue;
          const configuredActor = process.env['WORKER_SYSTEM_ACTOR_USER_ID']?.trim();
          const actor = (
            await client.query<{ user_id: string }>(
              configuredActor
                ? 'SELECT user_id FROM users WHERE user_id=$1 AND disabled_at IS NULL AND activation_token IS NULL'
                : 'SELECT user_id FROM users WHERE is_admin AND disabled_at IS NULL AND activation_token IS NULL ORDER BY created_at,user_id LIMIT 1',
              configuredActor ? [configuredActor] : []
            )
          ).rows[0];
          if (!actor) throw new Error('Workflow escalation requires an active worker audit actor');
          const auditId = randomUUID();
          await client.query(
            `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,$2,'service_workflow_escalated',$3::jsonb,$1)`,
            [
              auditId,
              actor.user_id,
              JSON.stringify({
                actorContext: 'system',
                source: 'worker',
                target: key,
                itemId: row.id,
                episodeId: episode.id,
                policyFingerprint: fingerprint,
                rule,
                recipients: destination.map((u) => u.user_id),
              }),
            ]
          );
          await notify(destination, 'admin.service_escalated', rule.email, 2);
          counts.escalated++;
        }
        await client.query('COMMIT');
        result.alerted += counts.alerted;
        result.escalated += counts.escalated;
        result.pruned += counts.pruned;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        result.errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
        more = false;
      } finally {
        client.release();
      }
    }
  }
  return result;
}

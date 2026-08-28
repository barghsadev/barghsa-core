import type { Pool, PoolClient } from 'pg'
import { getDbPool } from '@barghsa/db'
import {
  ESCALATION_POLICY_CONFIG_KEY,
  toEscalationPolicies,
  type EscalationLevelConfig,
  type ServiceResponseTargetType,
} from '@barghsa/shared/admin'
import { enqueueOutbox } from '../notifications/outbox-writer.js'
import { CASE_OPEN_STATUSES, TICKET_OPEN_STATUSES } from './breach-scanner.js'

/**
 * Service escalation scanner (S-09.08, T-09.08.03).
 *
 * Sits on top of the T-09.08.01 breach scan. The breach scanner records a
 * breached episode in `service_breach_alerts` and alerts the *assigned*
 * staff — that is the **level-1** tier of the escalation model
 * (`escalation_level = 1`). This scanner advances un-responded episodes up
 * the remaining tiers:
 *
 * - **level 2 — team lead**: an episode escalates to the responsible
 *   staff's team once `level2.delayHours` has elapsed past the breach
 *   alert (`alerted_at`), for as long as the item remains breached. Because
 *   the staff-team model (T-09.08.02) has no dedicated lead role yet, the
 *   team-lead recipient is resolved as the responsible user's team members
 *   (the escalation surface that lifts the item to the wider team); if the
 *   responsible user belongs to no team, they fall back to platform admins.
 * - **level 3 — admin**: the episode escalates to platform admins once
 *   `level3.delayHours` has elapsed past the level-2 escalation
 *   (`escalated_at`).
 *
 * Level 3 is terminal. Each tier has its own configurable delivery channels
 * (in-app mandatory; email optional), satisfying the "Configurable alert
 * channels (in-app, email)" requirement.
 *
 * ## Guarantees
 * - **At-most-once per escalation tier.** A tier is advanced with an atomic
 *   conditional UPDATE (`UPDATE … WHERE escalation_level = <expected>
 *   RETURNING id`). Only the row this scan actually advanced is enqueued, so
 *   a concurrent scanner or a crash can never double-escalate the same tier.
 * - **Atomicity.** The conditional escalation UPDATE and the outbox rows for
 *   one tier share one transaction: a crash mid-scan rolls back both, so an
 *   escalation notification is never enqueued without its ledger state.
 * - **No escalation of dead/recovered items.** A candidate's source item is
 *   re-verified as still open *and* still past its own `target_hours` cutoff
 *   (the ledger stores the target per episode), so an item that was just
 *   responded to or resolved is not escalated even if the breach scanner has
 *   not yet pruned its ledger row.
 * - **No silent alert loss.** If a tier's recipients cannot be resolved, the
 *   escalation claim is reverted so the item is re-evaluated next scan
 *   rather than permanently stuck at the higher tier.
 * - **Failure isolation.** A failure while scanning one service type is
 *   recorded and skipped; the other types are still scanned.
 *
 * The time base for each tier's delay is the moment the *previous* tier's
 * alert was emitted — `alerted_at` (the breach alert) for level 2, and
 * `escalated_at` (the level-2 escalation) for level 3 — so a delay measures
 * how long the item has waited since the last alert before climbing again.
 */

/** Milliseconds per target hour. */
const HOUR_MS = 3_600_000

/** In-app/email notification event key for a service escalation. */
export const SERVICE_ESCALATED_EVENT_KEY = 'admin.service_escalated'

/** Default number of escalation candidates processed per service type per scan. */
export const DEFAULT_ESCALATION_BATCH_SIZE = 200

/** Outcome statistics of one escalation scan. */
export interface EscalationScanResult {
  /** False when no config row is persisted (escalation not configured yet). */
  enabled: boolean
  /** Escalation tiers fired per service type. */
  escalated: Record<ServiceResponseTargetType, { level2: number; level3: number }>
  /** Episodes skipped because a concurrent scan already advanced them or the item recovered. */
  skippedConcurrent: number
  /** Per-type failure messages; the other types still got scanned. */
  errors: string[]
}

/** Behavioural hook for one escalation domain (service type). */
interface EscalationDomainSpec {
  serviceType: ServiceResponseTargetType
  /** Statuses that count as "open and awaiting staff" (source re-verify). */
  openStatuses: readonly string[]
  /**
   * SQL template returning up to `$6` ledger rows due for the given
   * escalation tier.
   * `$column` is substituted with the tier's base time column.
   * Params:
   * `$1` service_type, `$2` expected escalation_level,
   * `$3` escalation cutoff (previous-tier time + delay),
   * `$4` `now` (for the per-episode target-hours re-verify),
   * `$5` open statuses (source re-verify), `$6` batch size.
   * Selects `l.id AS ledger_id`, `l.item_id`, and the responsible staff user.
   */
  findDueSql: (baseColumn: 'alerted_at' | 'escalated_at') => string
}

const ESCALATION_DOMAINS: readonly EscalationDomainSpec[] = [
  {
    serviceType: 'ticket',
    openStatuses: TICKET_OPEN_STATUSES,
    findDueSql: (column) => `SELECT l.id AS ledger_id, l.item_id, t.assigned_to AS responsible_user_id
        FROM service_breach_alerts l
        JOIN tickets t ON t.id = l.item_id::uuid
        WHERE l.service_type = $1
          AND l.escalation_level = $2
          AND t.status = ANY($5::text[])
          AND t.updated_at <= $4 - (l.target_hours * INTERVAL '1 hour')
          AND l.${column} <= $3
        ORDER BY l.updated_at ASC
        LIMIT $6`,
  },
  {
    serviceType: 'verification_case',
    openStatuses: CASE_OPEN_STATUSES,
    findDueSql: (column) => `SELECT l.id AS ledger_id, l.item_id, vc.created_by AS responsible_user_id
        FROM service_breach_alerts l
        JOIN verification_cases vc ON vc.id = l.item_id
        WHERE l.service_type = $1
          AND l.escalation_level = $2
          AND vc.status = ANY($5::text[])
          AND vc.updated_at <= $4 - (l.target_hours * INTERVAL '1 hour')
          AND l.${column} <= $3
        ORDER BY l.updated_at ASC
        LIMIT $6`,
  },
]

/**
 * SQL atomically advancing one episode to the next escalation tier.
 * `$1` = ledger id, `$2` = expected current level, `$3` = new level,
 * `$4` = `now`. Returns a row only when the expectation held (concurrent
 * scans that already advanced the tier get no row and thus no enqueue).
 */
const ADVANCE_SQL = `UPDATE service_breach_alerts
   SET escalation_level = $3, escalated_at = $4, updated_at = $4
   WHERE id = $1 AND escalation_level = $2
   RETURNING id`

/** SQL reverting a claim whose recipients could not be resolved. */
const REVERT_SQL = `UPDATE service_breach_alerts
   SET escalation_level = $2, escalated_at = $3, updated_at = $4
   WHERE id = $1`

/** Human-readable in-app label per service type (both locales). */
const SERVICE_TYPE_LABELS: Record<ServiceResponseTargetType, { fa: string; en: string }> = {
  ticket: { fa: 'تیکت', en: 'ticket' },
  verification_case: { fa: 'پرونده تأیید هویت', en: 'verification case' },
}

export interface EscalationScanOptions {
  /** Query pool override for tests; defaults to the worker's shared pool. */
  pool?: Pool
  /** Clock override for tests. */
  now?: () => Date
  /** Outbox-enqueue override for tests; defaults to {@link enqueueOutbox}. */
  enqueue?: typeof enqueueOutbox
  /** Logger override for tests. */
  logger?: Pick<Console, 'warn' | 'info'>
  /** Max escalation candidates processed per service type per scan (default 200). */
  batchSize?: number
}

const defaultLogger: Pick<Console, 'warn' | 'info'> = {
  warn: (msg: unknown) => console.warn(`[worker:escalation-scan] ${String(msg)}`),
  info: (msg: unknown) => console.log(`[worker:escalation-scan] ${String(msg)}`),
}

/** A recipient profile resolved for notification delivery. */
interface RecipientProfile {
  id: string
  userId: string
}

/** A due-to-escalate ledger row. */
interface DueRow {
  ledger_id: string
  item_id: string
  responsible_user_id: string | null
}

/**
 * Run one escalation pass.
 *
 * No config row → returns `{ enabled: false }` with no escalation (the
 * breach scanner owns the ledger lifecycle, so we never clear escalation
 * state here — a missing policy simply means "stop escalating", and
 * re-enabling later resumes from the recorded tiers).
 */
export async function scanServiceEscalations(
  options: EscalationScanOptions = {},
): Promise<EscalationScanResult> {
  const pool = options.pool ?? getDbPool()
  const now = options.now?.() ?? new Date()
  const enqueue = options.enqueue ?? enqueueOutbox
  const logger = options.logger ?? defaultLogger
  const batchSize = options.batchSize ?? DEFAULT_ESCALATION_BATCH_SIZE

  const result: EscalationScanResult = {
    enabled: true,
    escalated: { ticket: { level2: 0, level3: 0 }, verification_case: { level2: 0, level3: 0 } },
    skippedConcurrent: 0,
    errors: [],
  }

  const configResult = await pool.query<{ value: unknown }>(
    `SELECT value FROM app_config WHERE key = $1`,
    [ESCALATION_POLICY_CONFIG_KEY],
  )

  if (configResult.rows.length === 0) {
    result.enabled = false
    return result
  }

  const policies = toEscalationPolicies(configResult.rows[0]!.value)

  for (const domain of ESCALATION_DOMAINS) {
    const policy = policies[domain.serviceType]
    if (!policy) continue // type disabled

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Level 2: assigned → team lead, measured from the breach alert.
      if (policy.level2.delayHours !== null) {
        const due = await fetchDue(client, domain, policy.level2.delayHours, now, batchSize, 1, 'alerted_at')
        for (const candidate of due) {
          await escalateOne(
            client, enqueue, logger, domain, candidate,
            policy.level2, /* fromLevel */ 1, /* toLevel */ 2, now, result, 'level2',
          )
        }
      }

      // Level 3: team lead → admin, measured from the level-2 escalation.
      if (policy.level3.delayHours !== null) {
        const due = await fetchDue(client, domain, policy.level3.delayHours, now, batchSize, 2, 'escalated_at')
        for (const candidate of due) {
          await escalateOne(
            client, enqueue, logger, domain, candidate,
            policy.level3, /* fromLevel */ 2, /* toLevel */ 3, now, result, 'level3',
          )
        }
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const message = (error as Error)?.message ?? String(error)
      result.errors.push(`${domain.serviceType}: ${message}`)
      logger.warn(`Escalation scan failed for ${domain.serviceType}: ${message}`)
    } finally {
      client.release()
    }
  }

  return result
}

/** Fetch ledger rows due for one escalation tier, re-verified against the open item. */
async function fetchDue(
  client: PoolClient,
  domain: EscalationDomainSpec,
  delayHours: number,
  now: Date,
  batchSize: number,
  expectedLevel: number,
  baseColumn: 'alerted_at' | 'escalated_at',
): Promise<DueRow[]> {
  const cutoff = new Date(now.getTime() - delayHours * HOUR_MS)
  const rows = await client.query<DueRow>(domain.findDueSql(baseColumn), [
    domain.serviceType,
    expectedLevel,
    cutoff,
    now,
    domain.openStatuses,
    batchSize,
  ])
  return rows.rows
}

/**
 * Escalate one candidate to the target tier: atomically advance the ledger
 * (conditional on the expected current level) and, only if this scan wins
 * the claim, enqueue the escalation notification to the tier's recipients.
 */
async function escalateOne(
  client: PoolClient,
  enqueue: typeof enqueueOutbox,
  logger: Pick<Console, 'warn' | 'info'>,
  domain: EscalationDomainSpec,
  candidate: DueRow,
  level: EscalationLevelConfig,
  fromLevel: number,
  toLevel: number,
  now: Date,
  result: EscalationScanResult,
  tier: 'level2' | 'level3',
): Promise<void> {
  // Atomic claim: only the scan that observes the expected current level
  // wins and returns a row. A concurrent scan that already advanced the tier
  // gets nothing and never enqueues a duplicate.
  const claim = await client.query(ADVANCE_SQL, [
    candidate.ledger_id,
    fromLevel,
    toLevel,
    now,
  ])
  if (claim.rowCount === 0 || claim.rows.length === 0) {
    result.skippedConcurrent++
    return
  }

  // Resolve recipients for this tier.
  let recipients: RecipientProfile[] = []
  if (toLevel === 2) {
    // Team lead = the responsible user's team members; fall back to admins.
    recipients = await resolveLevel2Recipients(client, candidate.responsible_user_id)
  } else {
    recipients = await resolveAdminRecipients(client)
  }

  if (recipients.length === 0) {
    // No deliverable recipient: revert the claim so the item is re-evaluated
    // next scan rather than being permanently advanced with no alert.
    await client
      .query(REVERT_SQL, [candidate.ledger_id, fromLevel, toLevel === 2 ? null : now, now])
      .catch(() => {
        logger.warn(
          `Failed to revert escalation claim for ${domain.serviceType} ${candidate.item_id}`,
        )
      })
    result.errors.push(
      `${domain.serviceType}:${candidate.item_id}: no deliverable escalation recipient at level ${toLevel}`,
    )
    return
  }

  result.escalated[domain.serviceType][tier]++

  for (const profile of recipients) {
    const enqueueResult = await enqueue(client, {
      profileId: profile.id,
      userId: profile.userId,
      eventKey: SERVICE_ESCALATED_EVENT_KEY,
      payload: {
        service_type: domain.serviceType,
        service_type_name_fa: SERVICE_TYPE_LABELS[domain.serviceType].fa,
        service_type_name_en: SERVICE_TYPE_LABELS[domain.serviceType].en,
        item_id: candidate.item_id,
        escalation_level: toLevel,
      },
      channels: level.channels,
      // Tier + ledger-id scoped: a fresh key every claim guarantees a
      // re-escalation can never collide with a prior tier's outbox row.
      idempotencyKey: `${SERVICE_ESCALATED_EVENT_KEY}:${domain.serviceType}:${candidate.item_id}:${toLevel}:${profile.id}:${candidate.ledger_id}`,
    })
    if (!enqueueResult.inserted) {
      logger.warn(
        `Outbox deduped escalation for ${domain.serviceType} ${candidate.item_id} → ${profile.id} (unexpected for a fresh claim)`,
      )
    }
  }
}

/** Resolve the default in-app/email profile(s) for every platform admin. */
async function resolveAdminRecipients(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
): Promise<RecipientProfile[]> {
  const admins = await client.query(`SELECT user_id FROM users WHERE is_admin = TRUE`)
  const ids = admins.rows.map((r) => String(r.user_id))
  if (ids.length === 0) return []
  const profiles = await client.query(
    `SELECT id, user_id FROM profiles WHERE user_id = ANY($1::text[]) AND is_default = TRUE`,
    [ids],
  )
  return profiles.rows.map((r) => ({ id: String(r.id), userId: String(r.user_id) }))
}

/**
 * Resolve the team-lead recipient for a level-2 escalation.
 *
 * Team-lead is interpreted as the responsible user's team members: find the
 * teams the responsible user belongs to (T-09.08.02), then the default
 * profile of each other member. When the responsible user belongs to no
 * team (or the item is unassigned), fall back to platform admins — the
 * escalation authority of last resort, matching the breach scanner's
 * unassigned-item behaviour.
 */
async function resolveLevel2Recipients(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  responsibleUserId: string | null,
): Promise<RecipientProfile[]> {
  if (!responsibleUserId) {
    return resolveAdminRecipients(client)
  }

  // Responsible user's team members (excluding the responsible user, who was
  // already alerted at level 1 by the breach scanner).
  const members = await client.query(
    `SELECT DISTINCT stm2.user_id
       FROM staff_team_members stm
       JOIN staff_team_members stm2 ON stm2.team_id = stm.team_id
      WHERE stm.user_id = $1 AND stm2.user_id <> $1`,
    [responsibleUserId],
  )
  const memberIds = members.rows.map((r) => String(r.user_id))
  if (memberIds.length === 0) {
    // Responsible user is not in any configured team → climb to admins.
    return resolveAdminRecipients(client)
  }

  const profiles = await client.query(
    `SELECT id, user_id FROM profiles WHERE user_id = ANY($1::text[]) AND is_default = TRUE`,
    [memberIds],
  )
  return profiles.rows.map((r) => ({ id: String(r.id), userId: String(r.user_id) }))
}
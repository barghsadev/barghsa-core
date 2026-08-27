import type { Pool } from 'pg'
import { getDbPool } from '@barghsa/db'
import {
  SERVICE_RESPONSE_TARGETS_CONFIG_KEY,
  toServiceResponseTargets,
  type ServiceResponseTargetType,
} from '@barghsa/shared/admin'
import { enqueueOutbox } from '../notifications/outbox-writer.js'

/**
 * Service breach scanner (S-09.08, T-09.08.01).
 *
 * Runs periodically in the worker and checks open service items — tickets
 * and verification cases — against the admin-configured response targets
 * (app_config key `admin.service_response_targets`, hours per service type).
 * When an open item has been awaiting staff longer than its target, the
 * scanner records the breach in `service_breach_alerts` and enqueues an
 * in-app staff alert through the E-05 outbox pipeline (delivered to the
 * recipient's `in_app_notifications` by the outbox poller).
 *
 * Clock semantics: an item's age is measured from `updated_at` — the
 * last-activity timestamp, which both the ticket and verification-case
 * services stamp on every state change. A target therefore measures
 * **responsiveness** (time since the item last moved), not time since
 * creation: a waiting_customer excursion or a staff reply resets the clock,
 * and a ticket bouncing between states never re-alerts until it has been
 * silent for the full target again.
 *
 * Guarantees:
 * - **At-most-once alerting per breach episode.** The ledger's UNIQUE
 *   (service_type, item_id) constraint is the dedup mechanism: the scanner
 *   inserts with ON CONFLICT DO NOTHING and only alerts for rows it actually
 *   inserted. The same item is never re-alerted on every scan.
 * - **Episode reset.** When an item leaves the breached set (resolved,
 *   closed, or the target is raised past its age) its ledger row is pruned,
 *   so a later re-breach starts a fresh episode and alerts again. Disabling
 *   a service type entirely clears that type's whole ledger, so re-enabling
 *   later re-evaluates every open item from scratch.
 * - **No silent alert loss.** An item is only recorded as alerted after at
 *   least one recipient was resolved for it; an unresolvable recipient
 *   (staff account without a default profile) skips the ledger insert and
 *   is re-evaluated on the next scan, logged for visibility.
 * - **Atomicity.** The ledger insert and the outbox rows for a service type
 *   share one transaction: a crash mid-scan can never leave an alert without
 *   its dedup row (which would re-alert on the next scan).
 * - **Failure isolation.** A failure while scanning one service type is
 *   recorded and skipped; the other types are still scanned.
 *
 * Staff alerts are exactly what T-09.08.01 promises — breached targets
 * create staff alerts but do not promise a service level to customers.
 * Per-event i18n rendering lands with the template engine (T-05.04.02).
 */

/** Milliseconds per target hour. */
const HOUR_MS = 3_600_000

/** In-app notification event key for a breached response target. */
export const SERVICE_TARGET_BREACHED_EVENT_KEY = 'admin.service_target_breached'

/** Ticket statuses where staff owe a response (customer wait does not run the clock). */
const TICKET_OPEN_STATUSES = ['open', 'in_progress', 'waiting_staff'] as const

/** Verification-case statuses where the case is still being worked. */
const CASE_OPEN_STATUSES = ['Open', 'Under Review'] as const

/** Outcome statistics of one breach scan. */
export interface BreachScanResult {
  /** False when no config row is persisted (targets not configured yet). */
  enabled: boolean
  /** Open items evaluated per service type (only types with a target). */
  scanned: Record<ServiceResponseTargetType, number>
  /** New breach episodes that were alerted. */
  alerted: number
  /** Items already alerted that were seen again (deduped or target-refreshed). */
  skippedDuplicates: number
  /** Ledger rows pruned (episodes that ended, or a type got disabled). */
  pruned: number
  /**
   * True when any service type hit the per-scan batch cap (LIMIT), meaning
   * more breached items remain and the next scan continues draining them.
   */
  truncated: boolean
  /** Per-type failure messages; the other types still got scanned. */
  errors: string[]
}

/** Behavioural override hook for one breach domain (service type). */
interface BreachDomainSpec {
  serviceType: ServiceResponseTargetType
  /** Statuses that count as "open and awaiting staff". */
  openStatuses: readonly string[]
  /**
   * SQL returning up to `$3` breached open items, oldest activity first:
   * `id` plus `recipient_user_id` (nullable — the staff user responsible,
   * or NULL when unassigned). `$1` = statuses, `$2` = cutoff timestamp,
   * `$3` = batch size.
   */
  findBreachedSql: string
  /**
   * SQL pruning ended episodes for this type.
   * `$1` = service_type, `$2` = statuses, `$3` = cutoff timestamp.
   * The anti-join casts `item_id` to the source table's PK type (tickets.id
   * is UUID; verification_cases.id is TEXT).
   */
  pruneSql: string
  /** SQL clearing the whole ledger when the type is disabled. `$1` = service_type. */
  clearSql: string
  /** Recipient policy when an item has no responsible user assigned. */
  fallback: 'admins' | 'none'
}

const BREACH_DOMAINS: readonly BreachDomainSpec[] = [
  {
    serviceType: 'ticket',
    openStatuses: TICKET_OPEN_STATUSES,
    findBreachedSql: `SELECT id, assigned_to AS recipient_user_id
        FROM tickets
        WHERE status = ANY($1::text[])
          AND updated_at <= $2
        ORDER BY updated_at ASC
        LIMIT $3`,
    pruneSql: `DELETE FROM service_breach_alerts
        WHERE service_type = $1
          AND item_id::uuid NOT IN (
            SELECT id FROM tickets
            WHERE status = ANY($2::text[])
              AND updated_at <= $3
          )`,
    clearSql: `DELETE FROM service_breach_alerts WHERE service_type = $1`,
    // Unassigned tickets are the whole platform's responsibility.
    fallback: 'admins',
  },
  {
    serviceType: 'verification_case',
    openStatuses: CASE_OPEN_STATUSES,
    findBreachedSql: `SELECT id, created_by AS recipient_user_id
        FROM verification_cases
        WHERE status = ANY($1::text[])
          AND updated_at <= $2
        ORDER BY updated_at ASC
        LIMIT $3`,
    pruneSql: `DELETE FROM service_breach_alerts
        WHERE service_type = $1
          AND item_id NOT IN (
            SELECT id FROM verification_cases
            WHERE status = ANY($2::text[])
              AND updated_at <= $3
          )`,
    clearSql: `DELETE FROM service_breach_alerts WHERE service_type = $1`,
    // Cases are always created by a staff user (created_by is NOT NULL).
    fallback: 'none',
  },
]

/** Default number of breached items processed per service type per scan. */
export const DEFAULT_BREACH_BATCH_SIZE = 500

/**
 * SQL upserting one breach episode into the ledger.
 *
 * - Fresh episode (new row): inserted with the current target_hours and
 *   reported as `inserted = true` (xmax = 0 ⇒ row created by this insert).
 * - Existing row, same target: DO UPDATE's WHERE is false → no row is
 *   returned at all (conflict takes the do-nothing path).
 * - Existing row, changed target: the row is updated (target snapshot
 *   refreshed) and returned with `inserted = false` — already alerted, so
 *   no duplicate alert, but the ledger never advertises a stale target.
 */
const LEDGER_UPSERT_SQL = `INSERT INTO service_breach_alerts (service_type, item_id, target_hours)
     VALUES ($1, $2, $3)
     ON CONFLICT (service_type, item_id)
       DO UPDATE SET target_hours = EXCLUDED.target_hours
       WHERE service_breach_alerts.target_hours <> EXCLUDED.target_hours
     RETURNING id, (xmax = 0) AS inserted`

export interface BreachScanOptions {
  /** Query pool override for tests; defaults to the worker's shared pool. */
  pool?: Pool
  /** Clock override for tests. */
  now?: () => Date
  /** Outbox-enqueue override for tests; defaults to {@link enqueueOutbox}. */
  enqueue?: typeof enqueueOutbox
  /** Logger override for tests. */
  logger?: Pick<Console, 'warn' | 'info'>
  /** Max breached items processed per service type per scan (default 500). */
  batchSize?: number
}

const defaultLogger: Pick<Console, 'warn' | 'info'> = {
  warn: (msg: unknown) => console.warn(`[worker:breach-scan] ${String(msg)}`),
  info: (msg: unknown) => console.log(`[worker:breach-scan] ${String(msg)}`),
}

/** Human-readable in-app label per service type (both locales). */
const SERVICE_TYPE_LABELS: Record<
  ServiceResponseTargetType,
  { fa: string; en: string }
> = {
  ticket: { fa: 'تیکت', en: 'ticket' },
  verification_case: { fa: 'پرونده تأیید هویت', en: 'verification case' },
}

/**
 * Run one breach-detection pass.
 *
 * No config row → clears every service type's episode ledger and returns
 * `{ enabled: false }`: "no targets configured" and "all targets null"
 * converge on the same ledger state, so accidentally deleting the config
 * row can never leave stale rows that suppress future alerts. Corrupt
 * stored values degrade per-type to disabled through the shared normalizer.
 */
export async function scanServiceBreaches(
  options: BreachScanOptions = {},
): Promise<BreachScanResult> {
  const pool = options.pool ?? getDbPool()
  const now = options.now?.() ?? new Date()
  const enqueue = options.enqueue ?? enqueueOutbox
  const logger = options.logger ?? defaultLogger
  const batchSize = options.batchSize ?? DEFAULT_BREACH_BATCH_SIZE

  const result: BreachScanResult = {
    enabled: true,
    scanned: { ticket: 0, verification_case: 0 },
    alerted: 0,
    skippedDuplicates: 0,
    pruned: 0,
    truncated: false,
    errors: [],
  }

  const configResult = await pool.query<{ value: unknown }>(
    `SELECT value FROM app_config WHERE key = $1`,
    [SERVICE_RESPONSE_TARGETS_CONFIG_KEY],
  )

  // No config row: same ledger semantics as "everything disabled" — clear
  // every type's ledger so no stale episode can suppress a future alert.
  if (configResult.rows.length === 0) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const domain of BREACH_DOMAINS) {
        const cleared = await client.query(domain.clearSql, [domain.serviceType])
        result.pruned += cleared.rowCount ?? 0
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const message = (error as Error)?.message ?? String(error)
      result.errors.push(`ledger-clear: ${message}`)
      logger.warn(`Ledger clear failed: ${message}`)
    } finally {
      client.release()
    }
    result.enabled = false
    return result
  }

  const targets = toServiceResponseTargets(configResult.rows[0]!.value)

  for (const domain of BREACH_DOMAINS) {
    const targetHours = targets[domain.serviceType]

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Disabled type: no scanning, but clear its episode ledger so a later
      // re-enable re-evaluates every open item from scratch (episodes do not
      // survive across a disable/enable cycle).
      if (targetHours === null) {
        const cleared = await client.query(domain.clearSql, [domain.serviceType])
        result.pruned += cleared.rowCount ?? 0
        await client.query('COMMIT')
        continue
      }

      const cutoff = new Date(now.getTime() - targetHours * HOUR_MS)

      const breached = await client.query<{
        id: string
        recipient_user_id: string | null
      }>(domain.findBreachedSql, [domain.openStatuses, cutoff, batchSize])
      result.scanned[domain.serviceType] = breached.rows.length
      // A full batch means more breached items likely remain; the next scan
      // (same cutoff) continues draining the backlog oldest-first.
      if (breached.rows.length >= batchSize) {
        result.truncated = true
      }

      if (breached.rows.length > 0) {
        const recipients = await resolveRecipients(client, breached.rows, domain)
        const noRecipientSkips: Array<{ itemId: string; reason: string }> = []
        for (const row of breached.rows) {
          const itemRecipients = recipients.forItem(row.recipient_user_id)

          // No deliverable recipient (e.g. the responsible staff account has
          // no default profile): skip the ledger insert entirely so the item
          // is re-evaluated on the next scan — a silent, permanent alert
          // suppression is worse than re-checking a few minutes later.
          // Warnings are aggregated (one line per pass) so a persistent
          // condition cannot spam the worker log.
          if (itemRecipients.length === 0) {
            noRecipientSkips.push({ itemId: row.id, reason: 'no default profile' })
            continue
          }

          // Dedup + target-snapshot refresh in one statement. No row comes
          // back for an already-alerted episode with an unchanged target;
          // a fresh episode returns inserted=true; a changed target returns
          // the refreshed row with inserted=false (no re-alert).
          const ledger = await client.query<{ id: string; inserted: boolean }>(
            LEDGER_UPSERT_SQL,
            [domain.serviceType, row.id, targetHours],
          )
          if (ledger.rows.length === 0 || !ledger.rows[0]!.inserted) {
            result.skippedDuplicates++
            continue
          }
          result.alerted++
          const ledgerId = ledger.rows[0]!.id

          for (const profile of itemRecipients) {
            const enqueueResult = await enqueue(client, {
              profileId: profile.id,
              userId: profile.userId,
              eventKey: SERVICE_TARGET_BREACHED_EVENT_KEY,
              payload: {
                service_type: domain.serviceType,
                service_type_name_fa: SERVICE_TYPE_LABELS[domain.serviceType].fa,
                service_type_name_en: SERVICE_TYPE_LABELS[domain.serviceType].en,
                item_id: row.id,
                target_hours: targetHours,
              },
              channels: ['in_app'],
              // Episode-scoped: the ledger row id guarantees a NEW key every
              // episode, so an item that re-breaches after being pruned can
              // never collide with its first episode's outbox row.
              idempotencyKey: `${SERVICE_TARGET_BREACHED_EVENT_KEY}:${domain.serviceType}:${row.id}:${profile.id}:${ledgerId}`,
            })
            if (!enqueueResult.inserted) {
              logger.warn(
                `Outbox deduped breach alert for ${domain.serviceType} ${row.id} → ${profile.id} (unexpected for a fresh episode)`,
              )
            }
          }
        }
        if (noRecipientSkips.length > 0) {
          const samples = noRecipientSkips.slice(0, 3).map((s) => s.itemId).join(', ')
          logger.warn(
            `No in-app recipient for ${noRecipientSkips.length} breached ${domain.serviceType}(s) (${samples}${noRecipientSkips.length > 3 ? ', …' : ''}); re-evaluated next scan`,
          )
        }
      }

      // Episode reset: drop ledger rows whose item is no longer breached
      // (resolved, closed, silent again, or younger than the current
      // target). The anti-join is exactly the breached set (same statuses +
      // cutoff).
      const prune = await client.query(domain.pruneSql, [
        domain.serviceType,
        domain.openStatuses,
        cutoff,
      ])
      result.pruned += prune.rowCount ?? 0

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      const message = (error as Error)?.message ?? String(error)
      result.errors.push(`${domain.serviceType}: ${message}`)
      logger.warn(`Scan failed for ${domain.serviceType}: ${message}`)
    } finally {
      client.release()
    }
  }

  if (result.alerted > 0 || result.truncated) {
    logger.info(
      `alerted=${result.alerted} skippedDuplicates=${result.skippedDuplicates} pruned=${result.pruned} truncated=${result.truncated}`,
    )
  }
  return result
}

/** A recipient profile resolved for in-app delivery. */
interface RecipientProfile {
  id: string
  userId: string
}

interface ResolvedRecipients {
  /** Profiles of the responsible staff users (keyed by user id). */
  forItem: (userId: string | null) => RecipientProfile[]
}

/**
 * Resolve the default in-app profile for every staff user that must be
 * alerted for the current breached set.
 *
 * Recipient policy:
 * - an item with a responsible user assigned alerts exactly that user;
 * - an unassigned item (only in domains whose fallback is `admins`) alerts
 *   every platform admin — and **only** admins, never other items' assigned
 *   staff;
 * - a user without a default profile is skipped (in-app delivery is
 *   profile-scoped; staff created through the admin flow always get an
 *   individual profile) — the caller re-evaluates such items next scan.
 */
async function resolveRecipients(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  rows: Array<{ recipient_user_id: string | null }>,
  domain: BreachDomainSpec,
): Promise<ResolvedRecipients> {
  const assigneeUserIds = new Set<string>()
  for (const row of rows) {
    if (row.recipient_user_id) assigneeUserIds.add(row.recipient_user_id)
  }

  // Admin fallback applies only when the batch actually contains unassigned
  // items AND the domain's policy routes unassigned work to admins.
  const hasUnassigned = rows.some((row) => row.recipient_user_id === null)
  const needsAdmins = hasUnassigned && domain.fallback === 'admins'

  const adminUserIds = new Set<string>()
  if (needsAdmins) {
    const admins = await client.query(
      `SELECT user_id FROM users WHERE is_admin = TRUE`,
    )
    for (const admin of admins.rows) {
      adminUserIds.add(String(admin.user_id))
    }
  }

  // Resolve default profiles for every user that may need one: the batch's
  // assigned staff and (when applicable) the platform admins.
  const profileUserIds = new Set([...assigneeUserIds, ...adminUserIds])
  const profilesByUser = new Map<string, RecipientProfile>()
  if (profileUserIds.size > 0) {
    const profiles = await client.query(
      `SELECT id, user_id FROM profiles WHERE user_id = ANY($1::text[]) AND is_default = TRUE`,
      [[...profileUserIds]],
    )
    for (const profile of profiles.rows) {
      const userId = String(profile.user_id)
      if (!profilesByUser.has(userId)) {
        profilesByUser.set(userId, { id: String(profile.id), userId })
      }
    }
  }

  const forItem = (userId: string | null): RecipientProfile[] => {
    if (userId) {
      const profile = profilesByUser.get(userId)
      return profile ? [profile] : []
    }
    // Unassigned item: platform admins only — never other items' assigned
    // staff, whose profiles also live in the shared resolution map.
    if (needsAdmins) {
      return [...adminUserIds]
        .map((adminId) => profilesByUser.get(adminId))
        .filter((profile): profile is RecipientProfile => profile !== undefined)
    }
    return []
  }

  return { forItem }
}

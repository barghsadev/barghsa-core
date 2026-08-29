import { Inject, Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
  DEFAULT_CONTRACT_ELECTRICITY_LIMITS,
  contractElectricityLimitsToStored,
  toContractElectricityLimits,
  validateContractElectricityLimits,
  type ContractElectricityLimits,
} from '@barghsa/shared/admin'
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js'

/**
 * Contract electricity limits configuration service (S-09.12, T-09.12.06)
 * — API slice.
 *
 * Admin-configurable limits that the electricity ordering flow enforces at
 * **draft time** (T-03.06.01.02, T-04.6.01.01 — later slices):
 *   - `maxQuantityIncreasePercent` — max % by which a customer may request
 *     an increase to the contracted electricity quantity;
 *   - `maxContractDuration` — max contract duration for advanced orders,
 *     in Jalali months;
 *   - `leadTimeDays` — minimum lead time between "today" and an advanced
 *     order's start date (0 = start can be today).
 *
 * Stored as a single JSONB value under `app_config` key
 * `electricity.contract_limits` (same storage family as the mandatory
 * green-electricity rules and wallet top-up limits). When no value is
 * persisted, the documented defaults are served:
 * `{ maxQuantityIncreasePercent: 20, maxContractDuration: 24, leadTimeDays: 0 }`.
 *
 * Changes affect **new drafts only** — the ordering flow reads the config
 * when a draft is created/validated; existing contracts and already
 * confirmed orders are never re-validated or retroactively constrained.
 *
 * Every mutation runs in ONE transaction on a locked row and records an
 * `audit_log` `change_recorded` event (matching the upload-policy /
 * VAT configuration audit trail) with actor, ip, previous + new values,
 * and the correlation id. The persisted row is the single source of
 * truth; no staged/canary writes.
 *
 * Permission `admin:catalogue:edit` is enforced at the controller
 * boundary (mapped to platform admin today, per the S-09 convention).
 * The admin web UI slice (number inputs per setting with the
 * "changes apply to new orders only" note; fa/en dicts, RTL/a11y) is
 * deferred.
 */

// ─── Public types ──────────────────────────────────────────────────────────

export interface UpdateContractElectricityLimitsInput {
  /** Raw request body (snake_case wire shape accepted). */
  raw: unknown
  actorUserId: string
  ip: string
}

// ─── Internal helpers ──────────────────────────────────────────────────────

type QueryFn = <T = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[]; rowCount: number | null }>

/** Minimal query executor shared by the pool and a transactional client. */
type DbExecutor = { query: QueryFn }

@Injectable()
export class ContractElectricityLimitsService {
  private readonly logger = new Logger(ContractElectricityLimitsService.name)

  constructor(
    @Inject(CorrelationIdProvider)
    private readonly correlationIdProvider: CorrelationIdProvider,
  ) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Read the current contract electricity limits.
   *
   * Returns the T-09.12.06 defaults (`20%` increase cap, `24` Jalali
   * months, `0` lead days) when no admin value has been persisted. A
   * persisted row that does not normalize to a *valid* config is warned
   * about and served as the defaults — a corrupt value must not crash the
   * read path or silently change the enforced limits.
   */
  async get(): Promise<ContractElectricityLimits> {
    const pool = getDbPool()
    const result = await pool.query<{ value: unknown }>(
      `SELECT value FROM app_config WHERE key = $1`,
      [CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY],
    )
    if (result.rows.length === 0) {
      return { ...DEFAULT_CONTRACT_ELECTRICITY_LIMITS }
    }
    const persisted = result.rows[0]!.value as Record<string, unknown> | null
    // The stored snake_case shape must itself validate; a malformed row is
    // surfaced rather than silently served as a confusing mix of persisted
    // + default fields (same fail-safe as the green-electricity config).
    const validation = validateContractElectricityLimits(persisted)
    if (!validation.ok) {
      this.logger.warn(
        `Contract electricity limits row for key ${CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY} is invalid (${JSON.stringify(persisted)}); serving defaults`,
      )
      return { ...DEFAULT_CONTRACT_ELECTRICITY_LIMITS }
    }
    return toContractElectricityLimits(persisted)
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Persist new contract electricity limits.
   *
   * Validates the proposal (all three integer bounds) before writing; a
   * failing validation throws a 400 with the collected issue list. On
   * success it upserts `app_config` under the versioned key (row lock to
   * serialize concurrent writers and preserve the audit trail), bumps the
   * global `config_version` for cache invalidation, and records the
   * `change_recorded` audit event with the previous and new values.
   */
  async update(input: UpdateContractElectricityLimitsInput): Promise<ContractElectricityLimits> {
    const validation = validateContractElectricityLimits(input.raw)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400,
      )
    }

    const config = toContractElectricityLimits(input.raw)
    const stored = contractElectricityLimitsToStored(config)
    const pool = getDbPool()
    const client = await pool.connect()
    const now = new Date()
    try {
      await client.query('BEGIN')

      // Lock the existing row (if any) so the previous value recorded in
      // the audit trail is the true value being replaced. Concurrent
      // writers serialize on this row lock.
      const prevResult = await client.query<{ value: unknown; version: number }>(
        `SELECT value, version FROM app_config WHERE key = $1 FOR UPDATE`,
        [CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY],
      )
      const previousValue =
        prevResult.rows.length > 0 ? prevResult.rows[0]!.value : null
      const previousVersion =
        prevResult.rows.length > 0 ? prevResult.rows[0]!.version : 0

      const upsertResult = await client.query<{ version: number }>(
        `INSERT INTO app_config (key, value, version, updated_at)
         VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3
         RETURNING version`,
        [CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY, JSON.stringify(stored), now],
      )
      const newVersion = upsertResult.rows[0]!.version

      // Bump global config version for cache invalidation.
      await client.query(
        `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
        [now],
      )

      // Record the epic's change_recorded audit event (matching the
      // upload-policy / VAT audit trail).
      const correlationId = this.correlationIdProvider.getCorrelationId() ?? uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, 'change_recorded', $3::jsonb, $4, $5, $6)`,
        [
          uuidv7(),
          input.actorUserId,
          JSON.stringify({
            entity: 'contract_electricity_limits',
            action: 'updated',
            key: CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
            previousValue,
            previousVersion,
            newValue: stored,
            version: newVersion,
          }),
          correlationId,
          input.ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Contract electricity limits updated by ${input.actorUserId} (version ${newVersion})`,
      )
      return config
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to set contract electricity limits: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update config' },
        500,
      )
    } finally {
      client.release()
    }
  }
}
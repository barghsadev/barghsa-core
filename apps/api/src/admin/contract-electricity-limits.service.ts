import { privateLogId } from '@barghsa/shared/log-privacy';
import type { ValidatedSession } from '../session/session.service.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
  DEFAULT_CONTRACT_ELECTRICITY_LIMITS,
  contractElectricityLimitsToStored,
  toContractElectricityLimits,
  validateContractElectricityLimits,
  type ContractElectricityLimits,
} from '@barghsa/shared/admin';
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js';
import { withStaffReadAuthority, type StaffReadActor } from './staff-read-authority.js';
import {
  contractLimitDraftEvent,
  contractLimitHistory,
  readContractLimitDraft,
} from './contract-limit-recovery.js';
import type { PoolClient } from 'pg';

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
 * `{ maxQuantityIncreasePercent: 0, maxContractDuration: 24, leadTimeDays: 0 }`.
 *
 * Duration and lead time affect new drafts only. The quantity-increase cap
 * applies to new requests against active contracts; submitted requests
 * retain their captured cap.
 *
 * Every mutation runs in ONE transaction on a locked row and records an
 * `audit_log` `change_recorded` event (matching the upload-policy /
 * VAT configuration audit trail) with actor, ip, previous + new values,
 * and the correlation id. The persisted row is the single source of
 * truth for effective settings. Recovery drafts are append-only audit
 * events and take effect only after a separate version-bound activation.
 *
 * Permission `admin:catalogue:edit` is enforced at the controller
 * boundary and rechecked inside the mutation transaction.
 */

// ─── Public types ──────────────────────────────────────────────────────────

export interface UpdateContractElectricityLimitsInput {
  /** Raw request body (snake_case wire shape accepted). */
  raw: unknown;
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
  ip: string;
}

type RecoveryDraft = NonNullable<Awaited<ReturnType<typeof readContractLimitDraft>>>;

// ─── Internal helpers ──────────────────────────────────────────────────────

@Injectable()
export class ContractElectricityLimitsService {
  private readonly logger = new Logger(ContractElectricityLimitsService.name);

  constructor(
    @Inject(CorrelationIdProvider)
    private readonly correlationIdProvider: CorrelationIdProvider
  ) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Read the current contract electricity limits.
   *
   * Returns the T-09.12.06 defaults (`0%` increase cap, `24` Jalali
   * months, `0` lead days) when no admin value has been persisted. A
   * malformed persisted row fails closed instead of replacing saved limits
   * with defaults.
   */
  async get(): Promise<ContractElectricityLimits> {
    const pool = getDbPool();
    const result = await pool.query<{ value: unknown }>(
      `SELECT value FROM app_config WHERE key = $1`,
      [CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY]
    );
    if (result.rows.length === 0) {
      return { ...DEFAULT_CONTRACT_ELECTRICITY_LIMITS };
    }
    const persisted = result.rows[0]!.value as Record<string, unknown> | null;
    // Missing and malformed settings have different behavior.
    const validation = validateContractElectricityLimits(persisted);
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 503,
          error: 'CONFIG:STORED_VALUE_INVALID',
          message: 'Stored ordering configuration is invalid',
        },
        503
      );
    }
    return toContractElectricityLimits(persisted);
  }

  async recoveryHistory(actor: StaffReadActor, beforeVersion?: number) {
    return withStaffReadAuthority(actor, 'admin:catalogue:edit', async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock_shared(hashtext('contract-electricity-limits'))"
      );
      const baseVersion = await this.readVersion(client);
      const history = await contractLimitHistory(
        client,
        Math.min(baseVersion, beforeVersion ?? baseVersion)
      );
      return { baseVersion, ...history, draft: await readContractLimitDraft(client, baseVersion) };
    });
  }

  async stageRecovery(
    input: { sourceId: string; expectedVersion: number },
    actor: StaffReadActor,
    ip: string
  ) {
    return this.write(actor, async (client) => {
      const baseVersion = await this.readVersion(client);
      if (baseVersion !== input.expectedVersion)
        throw new ConflictException('Contract limits changed');
      const {
        items: [source],
      } = await contractLimitHistory(client, baseVersion, input.sourceId);
      if (!source) throw new NotFoundException('Contract limit revision not found');
      const current = await readContractLimitDraft(client, baseVersion);
      if (current?.sourceId === source.id) return current;
      const draft = {
        id: uuidv7(),
        baseVersion,
        sourceId: source.id,
        sourceVersion: source.version,
        config: source.config,
      };
      await client.query(
        `INSERT INTO audit_log (id,user_id,event,metadata,correlation_id,ip,created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,clock_timestamp())`,
        [
          draft.id,
          actor.userId,
          contractLimitDraftEvent,
          JSON.stringify({ key: CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY, ...draft }),
          this.correlationIdProvider.getCorrelationId() ?? uuidv7(),
          ip,
        ]
      );
      return draft;
    });
  }

  async activateRecovery(
    input: { draftId: string; expectedVersion: number },
    actor: StaffReadActor,
    ip: string
  ) {
    const result = await this.write(actor, async (client) => {
      const baseVersion = await this.readVersion(client);
      if (baseVersion !== input.expectedVersion)
        throw new ConflictException('Contract limits changed');
      const draft = await readContractLimitDraft(client, baseVersion);
      if (draft?.id !== input.draftId)
        throw new ConflictException('Contract limit recovery draft changed');
      const version = await this.persist(client, draft.config, actor, ip, draft);
      return { config: draft.config, version, draftId: draft.id };
    });
    this.logUpdate(actor.userId, result.version);
    return result;
  }

  private async readVersion(client: PoolClient) {
    const { rows } = await client.query<{ version: number }>(
      'SELECT version FROM app_config WHERE key=$1',
      [CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY]
    );
    return rows[0]?.version ?? 0;
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
    const validation = validateContractElectricityLimits(input.raw);
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400
      );
    }

    const config = toContractElectricityLimits(input.raw);
    const version = await this.write(input.actor, (client) =>
      this.persist(client, config, input.actor, input.ip)
    );
    this.logUpdate(input.actor.userId, version);
    return config;
  }

  private async write<T>(
    actor: StaffReadActor,
    change: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:catalogue:edit');
      await requireSessionStepUp(client, actor);
      await client.query("SELECT pg_advisory_xact_lock(hashtext('contract-electricity-limits'))");
      const result = await change(client);
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof HttpException) throw error;
      this.logger.error('Failed to set contract electricity limits');
      throw new HttpException(
        { statusCode: 500, error: 'INTERNAL_SERVER', message: 'Failed to update config' },
        500
      );
    } finally {
      client.release();
    }
  }

  private async persist(
    client: PoolClient,
    config: ContractElectricityLimits,
    actor: StaffReadActor,
    ip: string,
    recovery?: RecoveryDraft
  ) {
    const stored = contractElectricityLimitsToStored(config);
    const now = new Date();
    // Lock the existing row (if any) so the previous value recorded in
    // the audit trail is the true value being replaced. Concurrent
    // writers serialize on this row lock.
    const prevResult = await client.query<{ value: unknown; version: number }>(
      `SELECT value, version FROM app_config WHERE key = $1 FOR UPDATE`,
      [CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY]
    );
    const previousValue = prevResult.rows.length > 0 ? prevResult.rows[0]!.value : null;
    const previousVersion = prevResult.rows.length > 0 ? prevResult.rows[0]!.version : 0;

    const upsertResult = await client.query<{ version: number }>(
      `INSERT INTO app_config (key, value, version, updated_at)
         VALUES ($1, $2::jsonb, 1, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, version = app_config.version + 1, updated_at = $3
         RETURNING version`,
      [CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY, JSON.stringify(stored), now]
    );
    const newVersion = upsertResult.rows[0]!.version;

    // Bump global config version for cache invalidation.
    await client.query(
      `UPDATE config_version SET version = version + 1, updated_at = $1 WHERE id = 'global'`,
      [now]
    );

    // Record the epic's change_recorded audit event (matching the
    // upload-policy / VAT audit trail).
    const correlationId = this.correlationIdProvider.getCorrelationId() ?? uuidv7();
    await client.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, 'change_recorded', $3::jsonb, $4, $5, $6)`,
      [
        uuidv7(),
        actor.userId,
        JSON.stringify({
          entity: 'contract_electricity_limits',
          action: recovery ? 'rollback_activated' : 'updated',
          key: CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
          previousValue,
          previousVersion,
          newValue: stored,
          version: newVersion,
          ...(recovery && {
            draftId: recovery.id,
            sourceId: recovery.sourceId,
            sourceVersion: recovery.sourceVersion,
          }),
        }),
        correlationId,
        ip,
        now,
      ]
    );

    return newVersion;
  }

  private logUpdate(actorUserId: string, version: number) {
    this.logger.log(
      `Contract electricity limits updated by ${privateLogId('actor', actorUserId)} (version ${version})`
    );
  }
}

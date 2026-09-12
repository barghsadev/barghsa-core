import { ErrorCodes } from '@barghsa/shared/errors';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
import type { PoolClient } from 'pg';
import { AiModelTestQueueService } from './ai-model-test-queue.service.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { Injectable, Logger, HttpException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';

type MutationSession = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
import { AiModelSecretsService, isMaskedAiToken } from './ai-model-secrets.service.js';
import {
  AI_MODEL_PROVIDER_TYPES,
  type AiModelProviderType,
  type AiModelTestResult,
} from '@barghsa/shared/ai-models';

/**
 * AI model management service (S-09.11, T-09.11.01).
 *
 * CRUD for the `ai_models` table plus the test-button orchestration:
 *
 * - Tokens are encrypted at rest (AES-256-GCM, `AI_MODEL_ENCRYPTION_KEY`)
 *   and never leave the API in plaintext: every DTO carries only a masked
 *   display value (`********1234`). The update path accepts a masked value
 *   echoed back from the UI and preserves the stored token instead of
 *   re-encrypting the placeholder.
 * - The worker decrypts the token and runs the guarded provider request.
 *   The API persists `last_test_status/at/error`, and returns
 *   the outcome + response preview. Safe, non-secret diagnostics only.
 * - Every mutation records an `audit_log` event with actor, ip, and a
 *   masked-target summary.
 *
 * Permission `admin:ai:models` is enforced at the controller boundary
 * (mapped to platform admin today, per the S-09 admin convention).
 */

/** Public DTO for a model row. Never carries the plaintext token. */
export interface AiModelDto {
  id: string;
  title: string;
  providerType: AiModelProviderType;
  baseUrl: string;
  modelName: string;
  /** Masked token display value (`********1234`), '' when none stored. */
  apiTokenMasked: string;
  /** Derived UI status: reachable / unreachable / unknown (never tested). */
  status: 'reachable' | 'unreachable' | 'unknown';
  lastTestedAt: string | null;
  lastTestError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAiModelInput {
  title: string;
  providerType: AiModelProviderType;
  baseUrl: string;
  modelName: string;
  /** Plaintext token to encrypt. Omit for token-less local endpoints. */
  apiToken?: string;
  actorUserId: string;
  session: MutationSession;
  ip: string;
}

export interface UpdateAiModelInput {
  title?: string;
  providerType?: AiModelProviderType;
  baseUrl?: string;
  modelName?: string;
  /** Plaintext new token, or a masked placeholder to preserve the stored one. */
  apiToken?: string;
  actorUserId: string;
  session: MutationSession;
  ip: string;
}

/** Result of a test-button run. */
export interface TestAiModelResult {
  model: AiModelDto;
  test: AiModelTestResult;
}

interface AiModelRow {
  id: string;
  title: string;
  provider_type: AiModelProviderType;
  base_url: string;
  model_name: string;
  api_token: string | null;
  last_tested_at: string | null;
  last_test_status: 'pending' | 'passed' | 'failed';
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
}

const PG_FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class AiModelsService {
  private readonly logger = new Logger(AiModelsService.name);

  constructor(
    private readonly secrets: AiModelSecretsService,
    private readonly queue: AiModelTestQueueService
  ) {}

  // ─── Read ───────────────────────────────────────────────────────────────

  /** List all models, newest first, tokens masked. */
  async list(): Promise<AiModelDto[]> {
    const result = await getDbPool().query<AiModelRow>(
      `SELECT id, title, provider_type, base_url, model_name, api_token,
              last_tested_at, last_test_status, last_test_error, created_at, updated_at
         FROM ai_models
        ORDER BY created_at DESC`
    );
    return result.rows.map((row) => this.toDto(row));
  }

  /** Fetch a single model by id, token masked. */
  async get(id: string): Promise<AiModelDto> {
    const row = await this.findRow(id);
    if (!row) throw this.notFound(id);
    return this.toDto(row);
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  /** Create a model; the token (when given) is encrypted before insert. */
  async create(input: CreateAiModelInput): Promise<AiModelDto> {
    const id = uuidv7();
    const now = new Date();
    const token = this.prepareTokenForStore(input.apiToken, null);

    return this.withTransaction(input.actorUserId, input.session, async (client, verifiedAt) => {
      const result = await client.query<AiModelRow>(
        `INSERT INTO ai_models
         (id, title, provider_type, base_url, model_name, api_token, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id, title, provider_type, base_url, model_name, api_token,
                 last_tested_at, last_test_status, last_test_error, created_at, updated_at`,
        [
          id,
          input.title,
          input.providerType,
          input.baseUrl,
          input.modelName,
          token,
          input.actorUserId,
          now,
        ]
      );

      const row = result.rows[0];
      if (!row) {
        throw new HttpException(
          {
            statusCode: 500,
            error: 'AI_MODEL_CREATE_FAILED',
            message: 'Failed to create AI model',
          },
          500
        );
      }
      await this.recordAudit(
        verifiedAt,
        'ai_model_created',
        row,
        input.actorUserId,
        input.ip,
        {},
        client
      );
      this.logger.log(
        `AI model created: id=${id}, title=${input.title}, actor=${input.actorUserId}`
      );
      return this.toDto(row);
    });
  }

  /** Update a model; a masked placeholder token preserves the stored token. */
  async update(id: string, input: UpdateAiModelInput): Promise<AiModelDto> {
    return this.withTransaction(input.actorUserId, input.session, async (client, verifiedAt) => {
      const existing = await this.findRow(id, client);
      if (!existing) throw this.notFound(id);

      const destinationChanged =
        (input.baseUrl !== undefined && input.baseUrl !== existing.base_url) ||
        (input.providerType !== undefined && input.providerType !== existing.provider_type);
      if (
        destinationChanged &&
        existing.api_token !== null &&
        (input.apiToken === undefined || isMaskedAiToken(input.apiToken.trim()))
      ) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'AI_MODEL_TOKEN_REENTRY_REQUIRED',
            message: 'Re-enter or clear the API token when changing the provider or base URL',
          },
          400
        );
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      let param = 1;

      const push = (column: string, value: unknown): void => {
        fields.push(`${column} = $${param++}`);
        values.push(value);
      };

      if (input.title !== undefined) push('title', input.title);
      if (input.providerType !== undefined) push('provider_type', input.providerType);
      if (input.baseUrl !== undefined) push('base_url', input.baseUrl);
      if (input.modelName !== undefined) push('model_name', input.modelName);
      if (input.apiToken !== undefined) {
        push('api_token', this.prepareTokenForStore(input.apiToken, existing.api_token));
      }

      if (fields.length === 0) return this.toDto(existing);

      if (
        input.baseUrl !== undefined ||
        input.providerType !== undefined ||
        input.modelName !== undefined ||
        input.apiToken !== undefined
      ) {
        fields.push(
          'last_tested_at = NULL',
          "last_test_status = 'pending'",
          'last_test_error = NULL'
        );
      }

      fields.push(`updated_at = $${param++}`);
      values.push(new Date());
      values.push(id);

      const result = await client.query<AiModelRow>(
        `UPDATE ai_models SET ${fields.join(', ')}
        WHERE id = $${param}
        RETURNING id, title, provider_type, base_url, model_name, api_token,
                  last_tested_at, last_test_status, last_test_error, created_at, updated_at`,
        values
      );

      const row = result.rows[0];
      if (!row) throw this.notFound(id);
      await this.recordAudit(
        verifiedAt,
        'ai_model_updated',
        row,
        input.actorUserId,
        input.ip,
        {
          tokenChanged: input.apiToken !== undefined && !isMaskedAiToken(input.apiToken),
        },
        client
      );
      this.logger.log(`AI model updated: id=${id}, actor=${input.actorUserId}`);
      return this.toDto(row);
    });
  }

  /** Delete an unreferenced model; the agent foreign key protects models in use. */
  async remove(
    id: string,
    actorUserId: string,
    ip: string,
    session: MutationSession
  ): Promise<void> {
    return this.withTransaction(actorUserId, session, async (client, verifiedAt) => {
      const existing = await this.findRow(id, client);
      if (!existing) throw this.notFound(id);

      try {
        await client.query('DELETE FROM ai_models WHERE id = $1', [id]);
      } catch (error) {
        // A future ai_agents FK (T-09.11.04) will surface here as a violation.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === PG_FOREIGN_KEY_VIOLATION
        ) {
          throw new HttpException(
            {
              statusCode: 409,
              error: 'AI_MODEL_IN_USE',
              message: 'AI model is referenced by AI agents and cannot be deleted',
            },
            409
          );
        }
        throw error;
      }

      await this.recordAudit(verifiedAt, 'ai_model_deleted', existing, actorUserId, ip, {}, client);
      this.logger.log(`AI model deleted: id=${id}, actor=${actorUserId}`);
    });
  }

  /**
   * Test-button run: queue the worker request, await its safe result, persist
   * the outcome, and return the refreshed model + safe result.
   */
  async test(
    id: string,
    actorUserId: string,
    ip: string,
    session: MutationSession
  ): Promise<TestAiModelResult> {
    const { existing, jobId } = await this.withTransaction(actorUserId, session, async (client) => {
      const row = await this.findRow(id, client);
      if (!row) throw this.notFound(id);
      const jobId = await this.queue.enqueue(client, row.id, row.revision, actorUserId);
      return { existing: row, jobId };
    });
    // The API releases its transaction while the separate worker makes the request.
    const result = await this.queue.wait(jobId);

    return this.withTransaction(actorUserId, session, async (client, verifiedAt) => {
      const current = await this.findRow(id, client);
      if (!current) throw this.notFound(id);
      // PostgreSQL's tuple transaction ID also detects edits with identical
      // timestamps and competing tests. Never attach an old result to a new row.
      if (current.revision !== existing.revision) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'AI_MODEL_CHANGED',
            message: 'Model changed during testing; run the test again',
          },
          409
        );
      }
      const now = new Date();
      const updated = await client.query<AiModelRow>(
        `UPDATE ai_models
            SET last_tested_at = $1,
                last_test_status = $2,
                last_test_error = $3,
                updated_at = $1
          WHERE id = $4
          RETURNING id, title, provider_type, base_url, model_name, api_token,
                    last_tested_at, last_test_status, last_test_error, created_at, updated_at`,
        [now, result.ok ? 'passed' : 'failed', result.error ?? null, id]
      );
      const row = updated.rows[0];
      if (!row) throw this.notFound(id);
      await this.recordAudit(
        verifiedAt,
        'ai_model_tested',
        row,
        actorUserId,
        ip,
        {
          ok: result.ok,
          latencyMs: result.latencyMs,
          error: result.error ?? null,
        },
        client
      );
      return { model: this.toDto(row), test: result };
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Prepare a token for storage: encrypt it (fail closed when no key is
   * configured and a real token is given), preserve the stored value when a
   * masked placeholder is echoed back, and normalize empty input to null.
   * Token semantics (documented on the API): omit = unchanged,
   * masked placeholder = unchanged, empty string = clear.
   */
  private prepareTokenForStore(apiToken: string | undefined, stored: string | null): string | null {
    if (apiToken === undefined || apiToken === null) return stored;
    const trimmed = apiToken.trim();
    if (trimmed.length === 0) return null;
    if (isMaskedAiToken(trimmed)) return stored;
    if (!this.secrets.available) {
      // Never store a token in clear: surface an actionable 503 instead of
      // an opaque internal error from encryptToken().
      throw new HttpException(
        {
          statusCode: 503,
          error: 'AI_MODEL_ENCRYPTION_UNAVAILABLE',
          message: 'AI model token encryption is not configured (AI_MODEL_ENCRYPTION_KEY)',
        },
        503
      );
    }
    return this.secrets.encryptToken(trimmed);
  }

  private async findRow(
    id: string,
    client?: PoolClient
  ): Promise<(AiModelRow & { revision: string }) | null> {
    const result = await (client ?? getDbPool()).query<AiModelRow & { revision: string }>(
      `SELECT xmin::text AS revision, id, title, provider_type, base_url, model_name, api_token,
              last_tested_at, last_test_status, last_test_error, created_at, updated_at
         FROM ai_models
        WHERE id = $1${client ? ' FOR UPDATE' : ''}`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  private toDto(row: AiModelRow): AiModelDto {
    const status =
      row.last_test_status === 'passed'
        ? 'reachable'
        : row.last_test_status === 'failed'
          ? 'unreachable'
          : 'unknown';
    return {
      id: row.id,
      title: row.title,
      providerType: row.provider_type,
      baseUrl: row.base_url,
      modelName: row.model_name,
      apiTokenMasked: row.api_token === null ? '' : this.secrets.maskToken(row.api_token),
      status,
      lastTestedAt: row.last_tested_at,
      lastTestError: row.last_test_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private notFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'AI_MODEL_NOT_FOUND', message: `AI model ${id} not found` },
      404
    );
  }

  private async withTransaction<T>(
    actor: string,
    session: MutationSession,
    work: (client: PoolClient, verifiedAt: Date) => Promise<T>
  ): Promise<T> {
    if (!session || session.userId !== actor)
      throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor, 'admin:ai:models');
      const verifiedAt = await requireSessionStepUp(client, session);
      const result = await work(client, verifiedAt);
      await requireSessionStepUp(client, session);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async recordAudit(
    verifiedAt: Date,
    event: string,
    row: AiModelRow,
    actorUserId: string,
    ip: string,
    extra: Record<string, unknown>,
    client?: PoolClient
  ): Promise<void> {
    const auditId = uuidv7();
    const correlationId = uuidv7();
    await (client ?? getDbPool()).query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [
        auditId,
        actorUserId,
        event,
        JSON.stringify({
          targetId: row.id,
          title: row.title,
          providerType: row.provider_type,
          modelName: row.model_name,
          maskedToken: row.api_token === null ? null : this.secrets.maskToken(row.api_token),
          ...extra,
          stepUpVerified: true,
          stepUpVerifiedAt: verifiedAt.toISOString(),
        }),
        correlationId,
        ip,
        new Date(),
      ]
    );
  }
}

/** Re-export the shared provider-type list for controller validation. */
export { AI_MODEL_PROVIDER_TYPES };

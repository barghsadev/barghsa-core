import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { AiModelSecretsService, isMaskedAiToken } from './ai-model-secrets.service.js'
import {
  AiModelTesterService,
  AI_MODEL_PROVIDER_TYPES,
  type AiModelProviderType,
  type AiModelTestInput,
  type AiModelTestResult,
} from './ai-model-tester.service.js'

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
 * - The connection test decrypts the token in-process, runs the provider
 *   ping (SSRF-guarded), persists `last_test_status/at/error`, and returns
 *   the outcome + response preview. Safe, non-secret diagnostics only.
 * - Every mutation records an `audit_log` event with actor, ip, and a
 *   masked-target summary.
 *
 * Permission `admin:ai:models` is enforced at the controller boundary
 * (mapped to platform admin today, per the S-09 admin convention).
 */

/** Public DTO for a model row. Never carries the plaintext token. */
export interface AiModelDto {
  id: string
  title: string
  providerType: AiModelProviderType
  baseUrl: string
  modelName: string
  /** Masked token display value (`********1234`), '' when none stored. */
  apiTokenMasked: string
  /** Derived UI status: reachable / unreachable / unknown (never tested). */
  status: 'reachable' | 'unreachable' | 'unknown'
  lastTestedAt: string | null
  lastTestError: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAiModelInput {
  title: string
  providerType: AiModelProviderType
  baseUrl: string
  modelName: string
  /** Plaintext token to encrypt. Omit for token-less local endpoints. */
  apiToken?: string
  actorUserId: string
  ip: string
}

export interface UpdateAiModelInput {
  title?: string
  providerType?: AiModelProviderType
  baseUrl?: string
  modelName?: string
  /** Plaintext new token, or a masked placeholder to preserve the stored one. */
  apiToken?: string
  actorUserId: string
  ip: string
}

/** Result of a test-button run. */
export interface TestAiModelResult {
  model: AiModelDto
  test: AiModelTestResult
}

interface AiModelRow {
  id: string
  title: string
  provider_type: AiModelProviderType
  base_url: string
  model_name: string
  api_token: string | null
  last_tested_at: string | null
  last_test_status: 'pending' | 'passed' | 'failed'
  last_test_error: string | null
  created_at: string
  updated_at: string
}

const PG_FOREIGN_KEY_VIOLATION = '23503'

@Injectable()
export class AiModelsService {
  private readonly logger = new Logger(AiModelsService.name)

  constructor(
    private readonly secrets: AiModelSecretsService,
    private readonly tester: AiModelTesterService,
  ) {}

  // ─── Read ───────────────────────────────────────────────────────────────

  /** List all models, newest first, tokens masked. */
  async list(): Promise<AiModelDto[]> {
    const result = await getDbPool().query<AiModelRow>(
      `SELECT id, title, provider_type, base_url, model_name, api_token,
              last_tested_at, last_test_status, last_test_error, created_at, updated_at
         FROM ai_models
        ORDER BY created_at DESC`,
    )
    return result.rows.map((row) => this.toDto(row))
  }

  /** Fetch a single model by id, token masked. */
  async get(id: string): Promise<AiModelDto> {
    const row = await this.findRow(id)
    if (!row) throw this.notFound(id)
    return this.toDto(row)
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  /** Create a model; the token (when given) is encrypted before insert. */
  async create(input: CreateAiModelInput): Promise<AiModelDto> {
    const id = uuidv7()
    const now = new Date()
    const token = this.prepareTokenForStore(input.apiToken, null)

    const result = await getDbPool().query<AiModelRow>(
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
      ],
    )

    const row = result.rows[0]
    if (!row) {
      throw new HttpException(
        { statusCode: 500, error: 'AI_MODEL_CREATE_FAILED', message: 'Failed to create AI model' },
        500,
      )
    }
    await this.recordAudit('ai_model_created', row, input.actorUserId, input.ip, {})
    this.logger.log(`AI model created: id=${id}, title=${input.title}, actor=${input.actorUserId}`)
    return this.toDto(row)
  }

  /** Update a model; a masked placeholder token preserves the stored token. */
  async update(id: string, input: UpdateAiModelInput): Promise<AiModelDto> {
    const existing = await this.findRow(id)
    if (!existing) throw this.notFound(id)

    const fields: string[] = []
    const values: unknown[] = []
    let param = 1

    const push = (column: string, value: unknown): void => {
      fields.push(`${column} = $${param++}`)
      values.push(value)
    }

    if (input.title !== undefined) push('title', input.title)
    if (input.providerType !== undefined) push('provider_type', input.providerType)
    if (input.baseUrl !== undefined) push('base_url', input.baseUrl)
    if (input.modelName !== undefined) push('model_name', input.modelName)
    if (input.apiToken !== undefined) {
      push('api_token', this.prepareTokenForStore(input.apiToken, existing.api_token))
    }

    if (fields.length === 0) return this.get(id)

    fields.push(`updated_at = $${param++}`)
    values.push(new Date())
    values.push(id)

    const result = await getDbPool().query<AiModelRow>(
      `UPDATE ai_models SET ${fields.join(', ')}
        WHERE id = $${param}
        RETURNING id, title, provider_type, base_url, model_name, api_token,
                  last_tested_at, last_test_status, last_test_error, created_at, updated_at`,
      values,
    )

    const row = result.rows[0]
    if (!row) throw this.notFound(id)
    await this.recordAudit('ai_model_updated', row, input.actorUserId, input.ip, {
      tokenChanged: input.apiToken !== undefined && !isMaskedAiToken(input.apiToken),
    })
    this.logger.log(`AI model updated: id=${id}, actor=${input.actorUserId}`)
    return this.toDto(row)
  }

  /** Delete a model. Referenced-by-agents protection lands with T-09.11.04. */
  async remove(id: string, actorUserId: string, ip: string): Promise<void> {
    const existing = await this.findRow(id)
    if (!existing) throw this.notFound(id)

    try {
      await getDbPool().query('DELETE FROM ai_models WHERE id = $1', [id])
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
          409,
        )
      }
      throw error
    }

    await this.recordAudit('ai_model_deleted', existing, actorUserId, ip, {})
    this.logger.log(`AI model deleted: id=${id}, actor=${actorUserId}`)
  }

  /**
   * Test-button run: decrypt the stored token, ping the provider, persist
   * the outcome, and return the refreshed model + safe result.
   */
  async test(id: string, actorUserId: string, ip: string): Promise<TestAiModelResult> {
    const existing = await this.findRow(id)
    if (!existing) throw this.notFound(id)

    const apiToken =
      existing.api_token === null
        ? null
        : (() => {
            try {
              return this.secrets.decryptToken(existing.api_token)
            } catch (error) {
              this.logger.warn(
                `AI model test skipped (token undecryptable): id=${id} — ${String(error)}`,
              )
              return null
            }
          })()

    const input: AiModelTestInput = {
      providerType: existing.provider_type,
      baseUrl: existing.base_url,
      modelName: existing.model_name,
      apiToken,
    }

    const result = await this.tester.test(input)

    const now = new Date()
    const updated = await getDbPool().query<AiModelRow>(
      `UPDATE ai_models
          SET last_tested_at = $1,
              last_test_status = $2,
              last_test_error = $3,
              updated_at = $1
        WHERE id = $4
        RETURNING id, title, provider_type, base_url, model_name, api_token,
                  last_tested_at, last_test_status, last_test_error, created_at, updated_at`,
      [now, result.ok ? 'passed' : 'failed', result.error ?? null, id],
    )

    const row = updated.rows[0] ?? existing
    await this.recordAudit('ai_model_tested', row, actorUserId, ip, {
      ok: result.ok,
      latencyMs: result.latencyMs,
      error: result.error ?? null,
    })
    this.logger.log(`AI model tested: id=${id}, ok=${result.ok}, latencyMs=${result.latencyMs}`)
    return { model: this.toDto(row), test: result }
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
    if (apiToken === undefined || apiToken === null) return stored
    const trimmed = apiToken.trim()
    if (trimmed.length === 0) return null
    if (isMaskedAiToken(trimmed)) return stored
    if (!this.secrets.available) {
      // Never store a token in clear: surface an actionable 503 instead of
      // an opaque internal error from encryptToken().
      throw new HttpException(
        {
          statusCode: 503,
          error: 'AI_MODEL_ENCRYPTION_UNAVAILABLE',
          message: 'AI model token encryption is not configured (AI_MODEL_ENCRYPTION_KEY)',
        },
        503,
      )
    }
    return this.secrets.encryptToken(trimmed)
  }

  private async findRow(id: string): Promise<AiModelRow | null> {
    const result = await getDbPool().query<AiModelRow>(
      `SELECT id, title, provider_type, base_url, model_name, api_token,
              last_tested_at, last_test_status, last_test_error, created_at, updated_at
         FROM ai_models
        WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  private toDto(row: AiModelRow): AiModelDto {
    const status =
      row.last_test_status === 'passed'
        ? 'reachable'
        : row.last_test_status === 'failed'
          ? 'unreachable'
          : 'unknown'
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
    }
  }

  private notFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'AI_MODEL_NOT_FOUND', message: `AI model ${id} not found` },
      404,
    )
  }

  private async recordAudit(
    event: string,
    row: AiModelRow,
    actorUserId: string,
    ip: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const auditId = uuidv7()
    const correlationId = uuidv7()
    await getDbPool().query(
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
        }),
        correlationId,
        ip,
        new Date(),
      ],
    )
  }
}

/** Re-export the shared provider-type list for controller validation. */
export { AI_MODEL_PROVIDER_TYPES }

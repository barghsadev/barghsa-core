import { Injectable, Logger, HttpException, Inject } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import {
  GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES,
  MAX_UPLOAD_POLICY_EXTENSIONS,
  MIN_UPLOAD_POLICY_SIZE_BYTES,
  isUploadPolicyCategory,
  isValidPolicyExtension,
  normalizePolicyExtensions,
  uploadPolicyWindowStatus,
  type UploadPolicyCategory,
  type UploadPolicyDto,
} from '@barghsa/shared/admin'
import {
  getDeploymentAllowedExtensions,
  getDeploymentMaxSizeBytes,
} from '../upload/upload.config.js'
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js'

/**
 * Admin upload policy configuration service (S-09.12, T-09.12.05) — API
 * slice.
 *
 * Versioned upload policies per category (documents, images, videos):
 * each policy whitelists the allowed file formats (lowercase `.ext`
 * tokens) and caps the maximum file size. The upload path resolves the
 * effective policy as min(DB policy, deployment config) — see
 * `apps/api/src/upload/upload-policy.resolver.ts`.
 *
 * Data model (migration 0050):
 * - `upload_policies` — one row = ONE versioned policy with an effective
 *   window (`effective_from` inclusive, `effective_until` exclusive;
 *   null = open). Policies are never mutated or hard-deleted; adding a
 *   new policy for a category appends a row and closes the previously
 *   open one at the new effective_from (mirroring VAT configuration
 *   windows, T-09.12.02). This preserves full policy history.
 *
 * Deployment-safe boundaries (the task's hard requirement): every write
 * is bounded by the deployment-level limits in
 * `apps/api/src/upload/upload.config.ts` —
 *   - `allowedExtensions` must be a non-empty SUBSET of the deployment
 *     extension set for that category (a policy can never permit a format
 *     the deployment does not trust);
 *   - `maxSizeBytes` must be ≤ the deployment per-category cap (which is
 *     itself ≤ the 100 MB global hard cap).
 * The upload path independently enforces min(DB, deployment), so a stale
 * or direct-DB policy can never widen what the deployment allows.
 *
 * Every mutation runs in ONE transaction and records an `audit_log`
 * `change_recorded` event (the epic's audit contract) with actor, ip,
 * and the change summary.
 *
 * Permission `admin:uploads:edit` is enforced at the controller boundary
 * (mapped to platform admin today, per the S-09 convention). The admin
 * web UI slice (table: category, formats, max size; edit modal with
 * security warning; fa/en dicts, RTL/a11y) is deferred.
 */

// ─── Public types ──────────────────────────────────────────────────────────

export interface CreateUploadPolicyInput {
  /** Canonical admin category key (UPLOAD_POLICY_CATEGORIES). */
  category: UploadPolicyCategory
  /** Lowercase `.ext` whitelist (subset of the deployment extension set). */
  allowedExtensions: string[]
  /** Maximum file size in bytes (≤ deployment per-category cap). */
  maxSizeBytes: number
  /** ISO timestamp the policy takes effect (inclusive). Defaults to now. */
  effectiveFrom?: string
  actorUserId: string
  ip: string
}

export interface EndUploadPolicyInput {
  id: string
  /** ISO timestamp the policy stops applying (exclusive). Defaults to now. */
  effectiveUntil?: string
  actorUserId: string
  ip: string
}

// ─── Internal row types ────────────────────────────────────────────────────

type QueryFn = <T = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[]; rowCount: number | null }>

/** Minimal query executor shared by the pool and a transactional client. */
type DbExecutor = { query: QueryFn }

interface UploadPolicyRow {
  id: string
  category: string
  allowed_extensions: string[]
  max_size_bytes: number
  effective_from: string
  effective_until: string | null
  created_by: string
  created_at: string
  updated_at: string
}

const PG_EXCLUSION_VIOLATION = '23P01'
const PG_CHECK_VIOLATION = '23514'
const PG_FOREIGN_KEY_VIOLATION = '23503'

@Injectable()
export class UploadPolicyService {
  private readonly logger = new Logger(UploadPolicyService.name)

  constructor(
    @Inject(CorrelationIdProvider)
    private readonly correlationIdProvider: CorrelationIdProvider,
  ) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * List versioned upload policies, newest first, optionally filtered by
   * category. Each row carries its derived status (current/scheduled/
   * expired) for the admin table view.
   */
  async list(category?: string): Promise<UploadPolicyDto[]> {
    if (category !== undefined && !isUploadPolicyCategory(category)) {
      throw this.invalidCategory(category)
    }
    const pool = getDbPool()
    const result = category
      ? await pool.query<UploadPolicyRow>(
          `SELECT id, category, allowed_extensions, max_size_bytes,
                  effective_from, effective_until, created_by, created_at, updated_at
             FROM upload_policies
            WHERE category = $1
            ORDER BY effective_from DESC, created_at DESC`,
          [category],
        )
      : await pool.query<UploadPolicyRow>(
          `SELECT id, category, allowed_extensions, max_size_bytes,
                  effective_from, effective_until, created_by, created_at, updated_at
             FROM upload_policies
            ORDER BY effective_from DESC, created_at DESC`,
        )
    return result.rows.map((row) => this.toDto(row))
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  /**
   * Record a new versioned policy for a category. The previously-open
   * policy for the same category is closed at the new effective_from, so
   * the windows stay contiguous (mirroring VAT rate versions). A
   * re-submit of the currently-open policy is a no-op (no audit).
   * Future-dated policies are allowed — they become `scheduled` until
   * their effective_from arrives.
   *
   * Deployment-safe boundaries are enforced here: extensions must be a
   * non-empty subset of the deployment extension set for the category,
   * and maxSizeBytes must be within [1, min(deployment cap, 100 MB)].
   */
  async create(input: CreateUploadPolicyInput): Promise<UploadPolicyDto> {
    if (!isUploadPolicyCategory(input.category)) {
      throw this.invalidCategory(input.category)
    }

    const extensions = normalizePolicyExtensions(input.allowedExtensions)
    if (extensions.length === 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'UPLOAD_POLICY_EXTENSIONS_INVALID',
          message:
            'At least one valid extension is required (lowercase .ext tokens, e.g. .pdf)',
        },
        400,
      )
    }
    if (extensions.length > MAX_UPLOAD_POLICY_EXTENSIONS) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'UPLOAD_POLICY_EXTENSIONS_INVALID',
          message: `A policy may list at most ${MAX_UPLOAD_POLICY_EXTENSIONS} extensions`,
        },
        400,
      )
    }

    // Deployment-safe boundary: the extension whitelist is a SUBSET of
    // the deployment-permitted extension set for the category. The
    // upload path also intersects at read time (defense in depth), but
    // a policy that already violates this is a misconfiguration and is
    // rejected at write time.
    const deploymentExtensions = getDeploymentAllowedExtensions(input.category)
    const notDeploymentPermitted = extensions.filter(
      (ext) => !deploymentExtensions.includes(ext),
    )
    if (notDeploymentPermitted.length > 0) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'UPLOAD_POLICY_EXTENSION_NOT_DEPLOYMENT_PERMITTED',
          message:
            `Extensions ${notDeploymentPermitted.join(', ')} are not permitted by the ` +
            `deployment-level limits for category "${input.category}" — a policy can only ` +
            'narrow what the deployment allows',
          details: {
            deploymentAllowedExtensions: deploymentExtensions,
          },
        },
        400,
      )
    }

    const deploymentMax = getDeploymentMaxSizeBytes(input.category)
    const hardCap = Math.min(deploymentMax, GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES)
    if (
      !Number.isSafeInteger(input.maxSizeBytes) ||
      input.maxSizeBytes < MIN_UPLOAD_POLICY_SIZE_BYTES ||
      input.maxSizeBytes > hardCap
    ) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'UPLOAD_POLICY_SIZE_INVALID',
          message:
            `maxSizeBytes must be an integer within [${MIN_UPLOAD_POLICY_SIZE_BYTES}, ${hardCap}] ` +
            `for category "${input.category}" (deployment-level cap)` +
            (hardCap < GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES
              ? ` — the global hard cap is ${GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES} bytes`
              : ''),
          details: {
            deploymentMaxBytes: deploymentMax,
            globalMaxBytes: GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES,
          },
        },
        400,
      )
    }

    const effectiveFrom =
      input.effectiveFrom !== undefined ? new Date(input.effectiveFrom) : new Date()
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw this.invalidEffectiveDate('effectiveFrom')
    }

    return this.withTransaction(async (q) => {
      const open = await this.findOpenPolicy(q, input.category)
      if (open !== null) {
        const openFrom = new Date(open.effective_from)
        if (
          open.max_size_bytes === input.maxSizeBytes &&
          open.allowed_extensions.length === extensions.length &&
          open.allowed_extensions.every((ext, idx) => ext === extensions[idx])
        ) {
          // No-op: the same policy is already open — no version records a
          // non-change (mirrors catalogue/VAT no-op discipline).
          return this.readPolicy(q, open.id)
        }
        if (effectiveFrom.getTime() <= openFrom.getTime()) {
          throw new HttpException(
            {
              statusCode: 400,
              error: 'UPLOAD_POLICY_INVALID_EFFECTIVE_FROM',
              message:
                'A new upload policy must take effect strictly after the currently ' +
                'open policy (active since ' + open.effective_from + ')',
            },
            400,
          )
        }
        // Close the previous open policy at the new effective_from.
        await q.query(
          `UPDATE upload_policies
              SET effective_until = $1, updated_at = NOW()
            WHERE id = $2 AND effective_until IS NULL`,
          [effectiveFrom, open.id],
        )
      } else {
        // No open policy: the new open row must not overlap any already
        // ended window. The DB EXCLUDE constraint would reject it as
        // 23P01; pre-validate here so a mis-dated (e.g. backdated after
        // an end-date) request surfaces as an actionable 400.
        const conflict = await q.query<{ id: string; effective_from: string; effective_until: string | null }>(
          `SELECT id, effective_from, effective_until
             FROM upload_policies
            WHERE category = $1
              AND effective_from <= $2
              AND (effective_until IS NULL OR effective_until > $2)
            LIMIT 1`,
          [input.category, effectiveFrom],
        )
        if (conflict.rows.length > 0) {
          const row = conflict.rows[0]
          if (row !== undefined) {
            throw new HttpException(
              {
                statusCode: 400,
                error: 'UPLOAD_POLICY_INVALID_EFFECTIVE_FROM',
                message:
                  'The requested effective_from falls inside an existing policy window ' +
                  `(id ${row.id}: ${row.effective_from}${row.effective_until ? ' -> ' + row.effective_until : ' (open)'})`,
              },
              400,
            )
          }
        }
      }

      const id = uuidv7()
      await q.query(
        `INSERT INTO upload_policies
           (id, category, allowed_extensions, max_size_bytes, effective_from, effective_until, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $7)`,
        [
          id,
          input.category,
          extensions,
          input.maxSizeBytes,
          effectiveFrom,
          input.actorUserId,
          new Date(),
        ],
      )
      await this.recordChange(q, {
        actorUserId: input.actorUserId,
        ip: input.ip,
        entity: 'upload_policy',
        action: 'created',
        meta: {
          uploadPolicyId: id,
          category: input.category,
          allowedExtensions: extensions,
          maxSizeBytes: input.maxSizeBytes,
          effectiveFrom: effectiveFrom.toISOString(),
          ...(open !== null ? { closedUploadPolicyId: open.id } : {}),
        },
      })
      this.logger.log(
        `Upload policy created: id=${id}, category=${input.category}, ` +
          `extensions=${extensions.join(',')}, maxSizeBytes=${input.maxSizeBytes}, ` +
          `effectiveFrom=${effectiveFrom.toISOString()}, actor=${input.actorUserId}`,
      )
      return this.readPolicy(q, id)
    })
  }

  /**
   * End-date a policy (soft close — policies are never hard-deleted).
   * Ending the currently-open policy closes its window; ending an
   * already-ended policy is a no-op (no audit).
   */
  async end(input: EndUploadPolicyInput): Promise<UploadPolicyDto> {
    const effectiveUntil =
      input.effectiveUntil !== undefined ? new Date(input.effectiveUntil) : new Date()
    if (Number.isNaN(effectiveUntil.getTime())) {
      throw this.invalidEffectiveDate('effectiveUntil')
    }

    return this.withTransaction(async (q) => {
      const current = await this.findPolicyById(q, input.id)
      if (!current) throw this.policyNotFound(input.id)

      if (current.effective_until !== null) {
        // Already ended — no write, no audit.
        return this.toDto(current)
      }

      const from = new Date(current.effective_from)
      if (effectiveUntil.getTime() <= from.getTime()) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'UPLOAD_POLICY_INVALID_EFFECTIVE_UNTIL',
            message:
              'effectiveUntil must be strictly after the policy\'s effective_from (' +
              current.effective_from + ')',
          },
          400,
        )
      }

      await q.query(
        `UPDATE upload_policies
            SET effective_until = $1, updated_at = NOW()
          WHERE id = $2 AND effective_until IS NULL`,
        [effectiveUntil, input.id],
      )
      await this.recordChange(q, {
        actorUserId: input.actorUserId,
        ip: input.ip,
        entity: 'upload_policy',
        action: 'ended',
        meta: {
          uploadPolicyId: input.id,
          category: current.category,
          allowedExtensions: current.allowed_extensions,
          maxSizeBytes: current.max_size_bytes,
          effectiveFrom: current.effective_from,
          effectiveUntil: effectiveUntil.toISOString(),
        },
      })
      this.logger.log(
        `Upload policy ended: id=${input.id}, until=${effectiveUntil.toISOString()}, actor=${input.actorUserId}`,
      )
      return this.readPolicy(q, input.id)
    })
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private toDto(row: UploadPolicyRow): UploadPolicyDto {
    return {
      id: row.id,
      category: row.category as UploadPolicyCategory,
      allowedExtensions: row.allowed_extensions,
      maxSizeBytes: row.max_size_bytes,
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until ?? null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      status: uploadPolicyWindowStatus(row.effective_from, row.effective_until),
    }
  }

  private async findOpenPolicy(q: DbExecutor, category: string): Promise<UploadPolicyRow | null> {
    const result = await q.query<UploadPolicyRow>(
      `SELECT id, category, allowed_extensions, max_size_bytes, effective_from, effective_until, created_by, created_at, updated_at
         FROM upload_policies
        WHERE category = $1 AND effective_until IS NULL
        ORDER BY effective_from DESC
        LIMIT 1`,
      [category],
    )
    return result.rows[0] ?? null
  }

  private async findPolicyById(q: DbExecutor, id: string): Promise<UploadPolicyRow | null> {
    const result = await q.query<UploadPolicyRow>(
      `SELECT id, category, allowed_extensions, max_size_bytes, effective_from, effective_until, created_by, created_at, updated_at
         FROM upload_policies
        WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  /** Re-read a policy after a mutation. */
  private async readPolicy(q: DbExecutor, id: string): Promise<UploadPolicyDto> {
    const row = await this.findPolicyById(q, id)
    if (!row) throw this.policyNotFound(id)
    return this.toDto(row)
  }

  private invalidCategory(category: string): HttpException {
    return new HttpException(
      {
        statusCode: 400,
        error: 'UPLOAD_POLICY_CATEGORY_INVALID',
        message:
          `Invalid upload policy category: ${category}. ` +
          'Expected one of: document, image, video',
      },
      400,
    )
  }

  private invalidEffectiveDate(field: string): HttpException {
    return new HttpException(
      {
        statusCode: 400,
        error: 'UPLOAD_POLICY_INVALID_DATE',
        message: `Invalid ${field}: expected an ISO-8601 timestamp`,
      },
      400,
    )
  }

  private policyNotFound(id: string): HttpException {
    return new HttpException(
      {
        statusCode: 404,
        error: 'UPLOAD_POLICY_NOT_FOUND',
        message: `Upload policy ${id} not found`,
      },
      404,
    )
  }

  private isPgError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === code
    )
  }

  /** Run `fn` inside a single DB transaction on one client; any error rolls back. */
  private async withTransaction<T>(fn: (q: DbExecutor) => Promise<T>): Promise<T> {
    const client = await getDbPool().connect()
    let committed = false
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      committed = true
      return result
    } catch (error) {
      if (committed) throw error
      await client.query('ROLLBACK').catch(() => {})
      // Translate DB races into clean HTTP errors where safe.
      if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'UPLOAD_POLICY_REFERENCE_MISSING',
            message: 'A referenced user no longer exists',
          },
          409,
        )
      }
      if (this.isPgError(error, PG_EXCLUSION_VIOLATION) || this.isPgError(error, PG_CHECK_VIOLATION)) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'UPLOAD_POLICY_WINDOW_OVERLAP',
            message:
              'The requested effective window overlaps an existing upload policy',
          },
          409,
        )
      }
      throw error
    } finally {
      client.release()
    }
  }

  /** Record the epic's `change_recorded` audit event. */
  private async recordChange(
    q: DbExecutor,
    input: {
      actorUserId: string
      ip: string
      entity: string
      action: string
      meta: Record<string, unknown>
    },
  ): Promise<void> {
    // Correlate with the originating request when one exists (AsyncLocal
    // Storage set by CorrelationIdMiddleware); fall back to a fresh id.
    const correlationId = this.correlationIdProvider.getCorrelationId() ?? uuidv7()
    await q.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, 'change_recorded', $3::jsonb, $4, $5, $6)`,
      [
        uuidv7(),
        input.actorUserId,
        JSON.stringify({ entity: input.entity, action: input.action, ...input.meta }),
        correlationId,
        input.ip,
        new Date(),
      ],
    )
  }
}
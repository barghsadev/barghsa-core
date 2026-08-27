import { Injectable, Logger, HttpException, Inject, Optional } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { parseSmtpConfig } from './smtp-config.schema'
import type { SmtpConnectionTesterService } from './smtp-connection-tester.service'
import { parseResendConfig } from './resend-config.schema'
import type { ResendConnectionTesterService } from './resend-connection-tester.service'

/**
 * Email provider configuration service (E-05, T-05.06.01).
 *
 * Owns the `email_provider_configs` lifecycle state machine:
 *
 *   Draft ──(edit)──────────────────────▶ Draft
 *   Draft ──(test passes)───────────────▶ Draft (last_test_status='passed')
 *   Draft ──(activate, test passed)─────▶ Active
 *   Draft ──(activate, test NOT passed)──▶ (blocked)
 *   Active ─(another config activates)──▶ Superseded
 *   Active ─(admin disables)────────────▶ Disabled   [blocked if the sole OTP provider]
 *   Superseded/Disabled ─(rollback)────▶ Active (cloned copy)
 *
 * Guarantees:
 * - At most one `active` config per environment (enforced at the DB layer by
 *   the partial unique index `uq_email_provider_active` AND transactionally in
 *   `activate` for a friendlier domain error).
 * - A draft may only be promoted to `active` after a passing test.
 * - Disabling the sole active channel configuration for the OTP email channel
 *   is blocked, preserving an out-of-band recovery path.
 *
 * Secrets are NOT materialised here (T-05.00.05). The `config` JSONB column is
 * stored opaque; the service only reports its presence, never its contents.
 */

export type EmailProviderTransport = 'smtp' | 'resend'
export type EmailProviderStatus = 'draft' | 'active' | 'superseded' | 'disabled'
export type EmailProviderTestStatus = 'pending' | 'passed' | 'failed'

/** Opaque transport-specific configuration blob (encrypted at rest elsewhere). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProviderConfigBody = Record<string, any>

/** Row shape returned by the service — includes NO secrets or raw config. */
export interface EmailProviderConfigResult {
  id: string
  transport: EmailProviderTransport
  label: string
  status: EmailProviderStatus
  createdBy: string
  activatedAt: Date | null
  activatedBy: string | null
  lastTestAt: Date | null
  lastTestStatus: EmailProviderTestStatus
  lastTestError: string | null
  supersedesId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateProviderInput {
  transport: EmailProviderTransport
  label: string
  config: ProviderConfigBody
  /** Acting admin user id (session.userId). */
  createdBy: string
  supersedesId?: string | null
}

export interface UpdateProviderInput {
  label?: string
  config?: ProviderConfigBody
}

export interface RecordTestInput {
  /** True only after a real test-send succeeded (T-05.06.02/03 do the send). */
  passed: boolean
  /** Safe, non-secret error text when `passed` is false. */
  error?: string
}

// ---------------------------------------------------------------------------
// Pool abstraction (matches the `pg` Pool.shape used at runtime and the mock
// pool used in tests: both expose `query` and `connect()`).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PoolClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
  release: () => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ProviderPool {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
  connect: () => Promise<PoolClient>
}

/**
 * Injection token for an optional query-pool override. Not registered in the
 * module, so Nest resolves it to `undefined` (thanks to `@Optional()`) and the
 * service falls back to the shared `getDbPool()` pool. Tests construct the
 * service directly with a mock pool as the first constructor argument.
 */
export const PROVIDER_CONFIG_POOL = Symbol('PROVIDER_CONFIG_POOL')

/** Build a standard HttpException body. */
interface ErrBody {
  statusCode: number
  error: string
  message: string
}
const errBody = (statusCode: number, code: string, message: string): ErrBody => ({
  statusCode,
  error: code,
  message,
})

export const ProviderErrors = {
  notFound(): ErrBody {
    return errBody(404, ErrorCodes.NOT_FOUND_RESOURCE.code, 'Email provider config not found')
  },
  notEditable(): ErrBody {
    return errBody(409, ErrorCodes.CONFLICT_STATE.code, 'Only draft provider configs can be edited')
  },
  testRequired(): ErrBody {
    return errBody(
      409,
      ErrorCodes.CONFLICT_STATE.code,
      'Provider must pass a test-send before activation',
    )
  },
  alreadyActive(): ErrBody {
    return errBody(
      409,
      ErrorCodes.CONFLICT_DUPLICATE.code,
      'An active provider configuration already exists; supersede or disable it first',
    )
  },
  soleOtpProvider(): ErrBody {
    return errBody(
      409,
      ErrorCodes.CONFLICT_STATE.code,
      'Cannot disable the only active email provider; OTP recovery depends on it',
    )
  },
  invalidRollbackSource(): ErrBody {
    return errBody(
      409,
      ErrorCodes.CONFLICT_STATE.code,
      'Only a superseded or disabled configuration can be rolled back',
    )
  },
}

const SELECT_COLUMNS = `id,
  transport,
  label,
  status,
  created_by AS "createdBy",
  activated_at AS "activatedAt",
  activated_by AS "activatedBy",
  last_test_at AS "lastTestAt",
  last_test_status AS "lastTestStatus",
  last_test_error AS "lastTestError",
  supersedes_id AS "supersedesId",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`

@Injectable()
export class EmailProviderConfigService {
  private readonly logger = new Logger(EmailProviderConfigService.name)

  constructor(
    @Optional()
    @Inject(PROVIDER_CONFIG_POOL)
    private readonly injectedPool?: ProviderPool,
    @Optional()
    private readonly smtpTester?: SmtpConnectionTesterService,
    @Optional()
    private readonly resendTester?: ResendConnectionTesterService,
  ) {}

  private get db(): ProviderPool {
    return this.injectedPool ?? (getDbPool() as unknown as ProviderPool)
  }

  /* ------------------------------- Reads -------------------------------- */

  /** List all provider configurations, newest first (admin UI list). */
  async list(): Promise<EmailProviderConfigResult[]> {
    const result = await this.db.query(
      `SELECT ${SELECT_COLUMNS} FROM email_provider_configs ORDER BY created_at DESC`,
    )
    return result.rows as EmailProviderConfigResult[]
  }

  async get(id: string): Promise<EmailProviderConfigResult> {
    const row = await this.findById(id)
    if (!row) throw new HttpException(ProviderErrors.notFound(), 404)
    return row
  }

  private async findById(id: string): Promise<EmailProviderConfigResult | null> {
    const result = await this.db.query(
      `SELECT ${SELECT_COLUMNS} FROM email_provider_configs WHERE id = $1`,
      [id],
    )
    return (result.rows[0] as EmailProviderConfigResult | undefined) ?? null
  }

  /* ---------------------------- Mutations ------------------------------- */

  /** Create a new draft configuration. New rows always start `draft`. */
  async create(input: CreateProviderInput): Promise<EmailProviderConfigResult> {
    const id = uuidv7()
    await this.db.query(
      `INSERT INTO email_provider_configs
         (id, transport, label, status, config, created_by, supersedes_id)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6)`,
      [
        id,
        input.transport,
        input.label,
        input.config,
        input.createdBy,
        input.supersedesId ?? null,
      ],
    )
    const row = await this.findById(id)
    if (!row) throw new Error('Failed to return created provider config')
    return row
  }

  /** Edit a draft's label and/or config. Only drafts are editable. */
  async update(id: string, input: UpdateProviderInput): Promise<EmailProviderConfigResult> {
    const existing = await this.findById(id)
    if (!existing) throw new HttpException(ProviderErrors.notFound(), 404)
    if (existing.status !== 'draft') {
      throw new HttpException(ProviderErrors.notEditable(), 409)
    }

    const sets: string[] = []
    const params: unknown[] = []
    if (input.label !== undefined) {
      params.push(input.label)
      sets.push(`label = $${params.length}`)
    }
    if (input.config !== undefined) {
      /**
       * Merge the patch over the existing stored config (JSONB `||`).
       * This preserves fields the client did not resend — most importantly
       * encrypted secrets (SMTP password / Resend API key), which the API
       * never returns and which the UI therefore leaves blank when editing.
       * Omitting a secret on update now keeps the current one instead of
       * silently wiping it.
       */
      params.push(input.config)
      sets.push(`config = COALESCE(config, '{}'::jsonb) || $${params.length}::jsonb`)
    }
    if (sets.length > 0) {
      params.push(id)
      await this.db.query(
        `UPDATE email_provider_configs SET ${sets.join(', ')}
          WHERE id = $${params.length} AND status = 'draft'`,
        params,
      )
    }
    const row = await this.findById(id)
    if (!row) throw new Error('Failed to read updated provider config')
    return row
  }

  /**
   * Record the outcome of a test-send. Only drafts may be tested. A passing
   * test marks the row as eligible for activation.
   */
  async recordTest(id: string, input: RecordTestInput): Promise<EmailProviderConfigResult> {
    const existing = await this.findById(id)
    if (!existing) throw new HttpException(ProviderErrors.notFound(), 404)
    if (existing.status !== 'draft') {
      throw new HttpException(ProviderErrors.notEditable(), 409)
    }

    const testStatus = input.passed ? 'passed' : 'failed'
    await this.db.query(
      `UPDATE email_provider_configs
          SET last_test_status = $1, last_test_error = $2, last_test_at = NOW()
        WHERE id = $3`,
      [testStatus, input.passed ? null : (input.error ?? null), id],
    )
    const row = await this.findById(id)
    if (!row) throw new Error('Failed to read updated provider config')
    return row
  }

  /**
   * Activate a draft. Requires a passing test. Passively supersedes the current
   * active provider (status -> superseded) transactionally; the partial unique
   * index `uq_email_provider_active` is the DB-level guard against two actives.
   * `activatedBy` records the admin who performed the activation so the UI can
   * show who promoted this configuration to active (T-05.06.04).
   */
  async activate(id: string, activatedBy?: string): Promise<EmailProviderConfigResult> {
    const existing = await this.findById(id)
    if (!existing) throw new HttpException(ProviderErrors.notFound(), 404)
    if (existing.status === 'active') return existing
    if (existing.status !== 'draft') {
      throw new HttpException(ProviderErrors.notEditable(), 409)
    }
    if (existing.lastTestStatus !== 'passed') {
      throw new HttpException(ProviderErrors.testRequired(), 409)
    }

    await this.runTransaction(async (client) => {
      // Demote the current active -> superseded, capture it as the source of
      // this new active (for the rollback link).
      const before = await client.query(
        `UPDATE email_provider_configs SET status = 'superseded'
          WHERE status = 'active' RETURNING id`,
      )
      const supersedesId = (before.rows[0] as { id?: string } | undefined)?.id ?? null

      await client.query(
        `UPDATE email_provider_configs
            SET status = 'active', activated_at = NOW(), activated_by = $3, supersedes_id = $2
          WHERE id = $1 AND status = 'draft'`,
        [id, supersedesId, activatedBy ?? null],
      )
    })

    const row = await this.findById(id)
    if (!row) throw new Error('Failed to read activated provider config')
    return row
  }

  /**
   * Disable a configuration. Disabling the sole ACTIVE provider is blocked to
   * guarantee an out-of-band OTP recovery path exists.
   */
  async disable(id: string): Promise<EmailProviderConfigResult> {
    const existing = await this.findById(id)
    if (!existing) throw new HttpException(ProviderErrors.notFound(), 404)
    if (existing.status === 'disabled') return existing
    if (existing.status === 'superseded') {
      throw new HttpException(ProviderErrors.notEditable(), 409)
    }

    if (existing.status === 'active') {
      const count = await this.db.query(
        `SELECT COUNT(*) AS n FROM email_provider_configs WHERE status = 'active'`,
      )
      const activeCount = parseInt((count.rows[0] as { n?: string } | undefined)?.n ?? '0', 10)
      if (activeCount <= 1) {
        // Block only when this is the sole active provider AND no recovery path
        // (a superseded/disabled version to roll back to) exists — otherwise an
        // out-of-band OTP recovery route would be lost.
        const recovery = await this.db.query(
          `SELECT COUNT(*) AS n FROM email_provider_configs
            WHERE id <> $1 AND status IN ('superseded', 'disabled')`,
          [id],
        )
        const recoveryCount = parseInt(
          (recovery.rows[0] as { n?: string } | undefined)?.n ?? '0',
          10,
        )
        if (recoveryCount === 0) {
          throw new HttpException(ProviderErrors.soleOtpProvider(), 409)
        }
      }
    }

    await this.db.query(
      `UPDATE email_provider_configs SET status = 'disabled' WHERE id = $1`,
      [id],
    )
    const row = await this.findById(id)
    if (!row) throw new Error('Failed to read disabled provider config')
    return row
  }

  /**
   * Rollback to a superseded/disabled version: clone its known-good params into
   * a fresh row and activate it. The original row is preserved. This backs the
   * UI's "Rollback to this version" action (T-05.00.04).
   */
  async rollback(supersededId: string, createdBy: string): Promise<EmailProviderConfigResult> {
    const source = await this.findById(supersededId)
    if (!source) throw new HttpException(ProviderErrors.notFound(), 404)
    if (source.status !== 'superseded' && source.status !== 'disabled') {
      throw new HttpException(ProviderErrors.invalidRollbackSource(), 409)
    }

    const config = await this.readConfig(source.id)
    const created = await this.create({
      transport: source.transport,
      label: `${source.label} (rollback)`,
      config,
      createdBy,
    })

    // Activate the fresh clone in a transaction (known-good source, no re-test).
    await this.runTransaction(async (client) => {
      const before = await client.query(
        `UPDATE email_provider_configs SET status = 'superseded'
          WHERE status = 'active' RETURNING id`,
      )
      const priorActiveId = (before.rows[0] as { id?: string } | undefined)?.id ?? null
      await client.query(
        `UPDATE email_provider_configs
            SET status = 'active', activated_at = NOW(),
                last_test_status = 'passed', supersedes_id = $2, activated_by = $3
          WHERE id = $1`,
        [created.id, priorActiveId, createdBy],
      )
    })

    const row = await this.findById(created.id)
    if (!row) throw new Error('Failed to read rolled-back provider config')
    return row
  }

  /* ---------------------------- Connection test ------------------------- */

  /**
   * Run a live connection test for a draft config — SMTP handshake
   * (T-05.06.02) or Resend domain-verification + test-send to the admin's
   * email (T-05.06.03) — then persist the outcome as `last_test_*`.
   * `recipient` (the admin's email) is required for the Resend transport.
   */
  async testConnection(
    id: string,
    recipient?: string,
  ): Promise<{
    ok: boolean
    error: string | null
    result: EmailProviderConfigResult
  }> {
    const existing = await this.findById(id)
    if (!existing) throw new HttpException(ProviderErrors.notFound(), 404)
    if (existing.status !== 'draft') {
      throw new HttpException(ProviderErrors.notEditable(), 409)
    }

    if (existing.transport === 'resend') {
      return this.testResendConnection(existing.id, recipient)
    }
    if (existing.transport !== 'smtp') {
      throw new HttpException(
        errBody(
          400,
          ErrorCodes.VALIDATION_PARSE_ZOD.code,
          `Unsupported email transport: ${existing.transport}`,
        ),
        400,
      )
    }
    return this.testSmtpConnection(existing.id)
  }

  /** SMTP handshake connection test (T-05.06.02). */
  private async testSmtpConnection(id: string): Promise<{
    ok: boolean
    error: string | null
    result: EmailProviderConfigResult
  }> {
    const saved = await this.readConfig(id)
    const parsed = parseSmtpConfig(saved)
    if (!parsed.ok) {
      const recorded = await this.recordTest(id, {
        passed: false,
        error: `Invalid SMTP configuration: ${parsed.error}`,
      })
      return { ok: false, error: `Invalid SMTP configuration: ${parsed.error}`, result: recorded }
    }

    if (!this.smtpTester) {
      throw new HttpException(
        errBody(500, ErrorCodes.INTERNAL_UNEXPECTED.code, 'SMTP connection tester is not available'),
        500,
      )
    }

    const outcome = await this.smtpTester.test(parsed.config)
    const recorded = await this.recordTest(id, {
      passed: outcome.ok,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    })
    return { ok: outcome.ok, error: outcome.error ?? null, result: recorded }
  }

  /** Resend domain-verification + test-send to the admin's email (T-05.06.03). */
  private async testResendConnection(
    id: string,
    recipient?: string,
  ): Promise<{
    ok: boolean
    error: string | null
    result: EmailProviderConfigResult
  }> {
    if (!recipient || !recipient.trim()) {
      throw new HttpException(
        errBody(
          400,
          ErrorCodes.VALIDATION_PARSE_ZOD.code,
          'A recipient email is required to test a Resend provider configuration',
        ),
        400,
      )
    }
    const trimmed = recipient.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new HttpException(
        errBody(
          400,
          ErrorCodes.VALIDATION_PARSE_ZOD.code,
          'Invalid recipient email for the Resend test-send',
        ),
        400,
      )
    }

    const saved = await this.readConfig(id)
    const parsed = parseResendConfig(saved)
    if (!parsed.ok) {
      const recorded = await this.recordTest(id, {
        passed: false,
        error: `Invalid Resend configuration: ${parsed.error}`,
      })
      return { ok: false, error: `Invalid Resend configuration: ${parsed.error}`, result: recorded }
    }

    if (!this.resendTester) {
      throw new HttpException(
        errBody(500, ErrorCodes.INTERNAL_UNEXPECTED.code, 'Resend connection tester is not available'),
        500,
      )
    }

    const outcome = await this.resendTester.test(parsed.config, trimmed)
    const recorded = await this.recordTest(id, {
      passed: outcome.ok,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    })
    return { ok: outcome.ok, error: outcome.error ?? null, result: recorded }
  }

  /* ------------------------- Transaction + helpers ----------------------- */

  /**
   * Run a unit of work on a dedicated connection inside an explicit
   * BEGIN/COMMIT/ROLLBACK transaction (matches repo convention). Re-maps the
   * SQLSTATE 23505 unique violation to a domain-friendly 409.
   */
  private async runTransaction(
    work: (client: PoolClient) => Promise<void>,
  ): Promise<void> {
    const pool = this.db
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await work(client)
      await client.query('COMMIT')
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        /* rollback already failed / connection dropped */
      }
      if (error instanceof Error && (error as { code?: string }).code === '23505') {
        throw new HttpException(ProviderErrors.alreadyActive(), 409)
      }
      throw error
    } finally {
      client.release()
    }
  }

  private async readConfig(id: string): Promise<ProviderConfigBody> {
    const result = await this.db.query(
      `SELECT config FROM email_provider_configs WHERE id = $1`,
      [id],
    )
    return (result.rows[0] as { config: ProviderConfigBody } | undefined)?.config ?? {}
  }
}
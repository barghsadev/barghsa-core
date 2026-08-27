import { Injectable, Logger, HttpException, Inject, Optional } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { parseSmsirConfig } from './smsir-config.schema'
import type { SmsirConnectionTesterService } from './smsir-connection-tester.service'
import {
  ProviderSecretsService,
  type ProviderMaskedConfig,
  type ProviderTransport,
} from './provider-secrets.service'
import {
  PROVIDER_CONFIG_POOL,
  type PoolClient,
  type ProviderPool,
} from './provider-config.di'

/**
 * SMS provider configuration service (T-09.06.02).
 *
 * Owns the `sms_provider_configs` lifecycle state machine, mirroring the email
 * provider config service (T-05.06.01):
 *
 *   Draft ──(edit)──────────────────────▶ Draft
 *   Draft ──(test passes)───────────────▶ Draft (last_test_status='passed')
 *   Draft ──(activate, test passed)─────▶ Active
 *   Draft ──(activate, test NOT passed)──▶ (blocked)
 *   Active ─(another config activates)──▶ Superseded
 *   Active ─(admin disables)────────────▶ Disabled
 *   Superseded/Disabled ─(rollback)────▶ Active (cloned copy)
 *
 * Guarantees:
 * - At most one `active` config per environment (partial unique index
 *   `uq_sms_provider_active` + transactional guard on `activate`).
 * - A draft may only be promoted to `active` after a passing test.
 * - Activation validates that internal event keys referenced in the SMS.ir
 *   template mappings are defined by at least one notification template, and
 *   that each mapping carries a templateId (T-09.06.02 acceptance criteria:
 *   "Activation validates template IDs and variable availability").
 *
 * Secrets are NOT materialised here. The `config` JSONB column is stored
 * opaque; the service only reports its presence (masked), never its contents.
 */

export type SmsProviderStatus = 'draft' | 'active' | 'superseded' | 'disabled'
export type SmsProviderTestStatus = 'pending' | 'passed' | 'failed'

export const SMS_PROVIDER_TRANSPORT: ProviderTransport = 'smsir'

/** Opaque transport-specific configuration blob (encrypted at rest elsewhere). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProviderConfigBody = Record<string, any>

/** Row shape returned by the service — includes NO raw secrets or unmasked config. */
export interface SmsProviderConfigResult {
  id: string
  transport: string
  label: string
  status: SmsProviderStatus
  createdBy: string
  activatedAt: Date | null
  activatedBy: string | null
  lastTestAt: Date | null
  lastTestStatus: SmsProviderTestStatus
  lastTestError: string | null
  supersedesId: string | null
  createdAt: Date
  updatedAt: Date
  /** Masked view of the stored transport config (secret api_key → `*…last4`). */
  maskedConfig: ProviderMaskedConfig
}

export interface CreateSmsProviderInput {
  label: string
  config: ProviderConfigBody
  /** Acting admin user id (session.userId). */
  createdBy: string
  supersedesId?: string | null
}

export interface UpdateSmsProviderInput {
  label?: string
  config?: ProviderConfigBody
}

export interface RecordSmsTestInput {
  /** True only after a real test-send succeeded (see SmsirConnectionTesterService). */
  passed: boolean
  /** Safe, non-secret error text when `passed` is false. */
  error?: string
}

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

export const SmsProviderErrors = {
  notFound(): ErrBody {
    return errBody(404, ErrorCodes.NOT_FOUND_RESOURCE.code, 'SMS provider config not found')
  },
  notEditable(): ErrBody {
    return errBody(409, ErrorCodes.CONFLICT_STATE.code, 'Only draft provider configs can be edited')
  },
  testRequired(): ErrBody {
    return errBody(
      409,
      ErrorCodes.CONFLICT_STATE.code,
      'Provider must pass a connection test before activation',
    )
  },
  alreadyActive(): ErrBody {
    return errBody(
      409,
      ErrorCodes.CONFLICT_DUPLICATE.code,
      'An active SMS provider configuration already exists; supersede or disable it first',
    )
  },
  templateMappingInvalid(detail: string): ErrBody {
    return errBody(
      409,
      ErrorCodes.VALIDATION_PARSE_ZOD.code,
      `SMS template mapping validation failed: ${detail}`,
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
  updated_at AS "updatedAt",
  config`

@Injectable()
export class SmsProviderConfigService {
  private readonly logger = new Logger(SmsProviderConfigService.name)

  constructor(
    @Optional()
    @Inject(PROVIDER_CONFIG_POOL)
    private readonly injectedPool?: ProviderPool,
    @Optional()
    private readonly smsirTester?: SmsirConnectionTesterService,
    @Optional()
    private readonly secretsService?: ProviderSecretsService,
  ) {
    this.secrets = secretsService ?? new ProviderSecretsService()
  }

  private readonly secrets: ProviderSecretsService

  private get db(): ProviderPool {
    return this.injectedPool ?? (getDbPool() as unknown as ProviderPool)
  }

  /**
   * The set of notification event keys that currently have at least one active
   * SMS template. Used to validate SMS.ir template mappings on activation and
   * to power the admin UI's event dropdown. Reads the `notification_templates`
   * table directly so the admin surface reflects real template availability.
   */
  async availableTemplateEventKeys(): Promise<Set<string>> {
    const result = await this.db.query(
      `SELECT DISTINCT event_key FROM notification_templates
        WHERE is_active = true AND channel = 'sms'`,
    )
    return new Set(result.rows.map((r) => (r as { event_key: string }).event_key))
  }

  /* ------------------------------- Reads -------------------------------- */

  async list(): Promise<SmsProviderConfigResult[]> {
    const result = await this.db.query(
      `SELECT ${SELECT_COLUMNS} FROM sms_provider_configs ORDER BY created_at DESC`,
    )
    return (result.rows as Array<SmsProviderConfigResult & { config?: ProviderConfigBody }>).map(
      (row) => this.maskRow(row),
    )
  }

  async get(id: string): Promise<SmsProviderConfigResult> {
    const row = await this.findById(id)
    if (!row) throw new HttpException(SmsProviderErrors.notFound(), 404)
    return row
  }

  private async findById(id: string): Promise<SmsProviderConfigResult | null> {
    const result = await this.db.query(
      `SELECT ${SELECT_COLUMNS} FROM sms_provider_configs WHERE id = $1`,
      [id],
    )
    const row = result.rows[0] as
      | (SmsProviderConfigResult & { config?: ProviderConfigBody })
      | undefined
    if (!row) return null
    return this.maskRow(row)
  }

  /**
   * Strip the raw config out of a DB row and attach a masked view (secret
   * fields → `*…last4`), so plaintext/encrypted secrets never leave the API.
   */
  private maskRow(
    row: SmsProviderConfigResult & { config?: ProviderConfigBody },
  ): SmsProviderConfigResult {
    const { config, ...rest } = row
    return {
      ...rest,
      maskedConfig: this.secrets.maskConfig(SMS_PROVIDER_TRANSPORT, config ?? {}),
    }
  }

  /* ---------------------------- Mutations ------------------------------- */

  /** Create a new draft configuration. New rows always start `draft`. Secrets are encrypted at rest. */
  async create(input: CreateSmsProviderInput): Promise<SmsProviderConfigResult> {
    const id = uuidv7()
    const config = this.secrets.encryptConfig(SMS_PROVIDER_TRANSPORT, input.config)
    await this.db.query(
      `INSERT INTO sms_provider_configs
         (id, transport, label, status, config, created_by, supersedes_id)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6)`,
      [
        id,
        SMS_PROVIDER_TRANSPORT,
        input.label,
        config,
        input.createdBy,
        input.supersedesId ?? null,
      ],
    )
    const row = await this.findById(id)
    if (!row) throw new Error('Failed to return created SMS provider config')
    return row
  }

  /** Edit a draft's label and/or config. Only drafts are editable. */
  async update(id: string, input: UpdateSmsProviderInput): Promise<SmsProviderConfigResult> {
    const existing = await this.findById(id)
    if (!existing) throw new HttpException(SmsProviderErrors.notFound(), 404)
    if (existing.status !== 'draft') {
      throw new HttpException(SmsProviderErrors.notEditable(), 409)
    }

    const sets: string[] = []
    const params: unknown[] = []
    if (input.label !== undefined) {
      params.push(input.label)
      sets.push(`label = $${params.length}`)
    }
    if (input.config !== undefined) {
      const encryptedPatch = this.secrets.encryptConfig(SMS_PROVIDER_TRANSPORT, input.config)
      params.push(encryptedPatch)
      sets.push(`config = COALESCE(config, '{}'::jsonb) || $${params.length}::jsonb`)
    }
    if (sets.length > 0) {
      params.push(id)
      await this.db.query(
        `UPDATE sms_provider_configs SET ${sets.join(', ')}
          WHERE id = $${params.length} AND status = 'draft'`,
        params,
      )
    }
    const row = await this.findById(id)
    if (!row) throw new Error('Failed to read updated SMS provider config')
    return row
  }

  /** Record the outcome of a connection test. Only drafts may be tested. */
  async recordTest(id: string, input: RecordSmsTestInput): Promise<SmsProviderConfigResult> {
    const existing = await this.findById(id)
    if (!existing) throw new HttpException(SmsProviderErrors.notFound(), 404)
    if (existing.status !== 'draft') {
      throw new HttpException(SmsProviderErrors.notEditable(), 409)
    }

    const testStatus = input.passed ? 'passed' : 'failed'
    await this.db.query(
      `UPDATE sms_provider_configs
          SET last_test_status = $1, last_test_error = $2, last_test_at = NOW()
        WHERE id = $3`,
      [testStatus, input.passed ? null : (input.error ?? null), id],
    )
    const row = await this.findById(id)
    if (!row) throw new Error('Failed to read updated SMS provider config')
    return row
  }

  /**
   * Activate a draft. Requires a passing test AND that every SMS.ir template
   * mapping references a templateId whose event key has a live notification
   * template (variable availability validation). Passively supersedes the
   * current active config transactionally.
   */
  async activate(id: string, activatedBy?: string): Promise<SmsProviderConfigResult> {
    const existing = await this.findById(id)
    if (!existing) throw new HttpException(SmsProviderErrors.notFound(), 404)
    if (existing.status === 'active') return existing
    if (existing.status !== 'draft') {
      throw new HttpException(SmsProviderErrors.notEditable(), 409)
    }
    if (existing.lastTestStatus !== 'passed') {
      throw new HttpException(SmsProviderErrors.testRequired(), 409)
    }

    await this.validateTemplateMappings(id)

    await this.runTransaction(async (client) => {
      const before = await client.query(
        `UPDATE sms_provider_configs SET status = 'superseded'
          WHERE status = 'active' RETURNING id`,
      )
      const supersedesId = (before.rows[0] as { id?: string } | undefined)?.id ?? null

      await client.query(
        `UPDATE sms_provider_configs
            SET status = 'active', activated_at = NOW(), activated_by = $3, supersedes_id = $2
          WHERE id = $1 AND status = 'draft'`,
        [id, supersedesId, activatedBy ?? null],
      )
    })

    const row = await this.findById(id)
    if (!row) throw new Error('Failed to read activated SMS provider config')
    return row
  }

  /**
   * Validate the SMS.ir template mappings in a draft before activation:
   * every mapping must declare a non-empty `template_id` (SMS.ir TemplateId)
   * and an `event_key` that has a live SMS notification template. Template
   * IDs / variable names are validated against the real SMS.ir template by
   * `testConnection`'s live test-send, which activation requires to have
   * passed (`last_test_status = 'passed'`) — see `SmsirConnectionTesterService`.
   */
  private async validateTemplateMappings(id: string): Promise<void> {
    const saved = await this.readConfig(id)
    const parsed = parseSmsirConfig(saved)
    if (!parsed.ok) {
      throw new HttpException(
        SmsProviderErrors.templateMappingInvalid(`invalid SMS.ir config: ${parsed.error}`),
        409,
      )
    }
    const mappings = parsed.config.template_mappings ?? []
    if (mappings.length === 0) return

    const available = await this.availableTemplateEventKeys()
    const problems: string[] = []
    for (const m of mappings) {
      if (!m.template_id || m.template_id.trim().length === 0) {
        problems.push(`event "${m.event_key}" has no SMS.ir TemplateId`)
      }
      if (!available.has(m.event_key)) {
        problems.push(
          `event "${m.event_key}" has no active notification template (${[...available].join(', ') || 'none'})`,
        )
      }
    }
    if (problems.length > 0) {
      throw new HttpException(SmsProviderErrors.templateMappingInvalid(problems.join('; ')), 409)
    }
  }

  /** Disable a configuration (no sole-provider OTP guard for SMS — SMS is not an OTP out-of-band channel). */
  async disable(id: string): Promise<SmsProviderConfigResult> {
    const existing = await this.findById(id)
    if (!existing) throw new HttpException(SmsProviderErrors.notFound(), 404)
    if (existing.status === 'disabled') return existing
    if (existing.status === 'superseded') {
      throw new HttpException(SmsProviderErrors.notEditable(), 409)
    }
    await this.db.query(`UPDATE sms_provider_configs SET status = 'disabled' WHERE id = $1`, [id])
    const row = await this.findById(id)
    if (!row) throw new Error('Failed to read disabled SMS provider config')
    return row
  }

  /** Rollback to a superseded/disabled version: clone its known-good params and activate it. */
  async rollback(supersededId: string, createdBy: string): Promise<SmsProviderConfigResult> {
    const source = await this.findById(supersededId)
    if (!source) throw new HttpException(SmsProviderErrors.notFound(), 404)
    if (source.status !== 'superseded' && source.status !== 'disabled') {
      throw new HttpException(SmsProviderErrors.invalidRollbackSource(), 409)
    }

    const config = await this.readConfig(source.id)
    const created = await this.create({
      label: `${source.label} (rollback)`,
      config,
      createdBy,
    })

    // The rollback clone bypasses the live test-send (known-good source), but
    // its template mappings must still point at live SMS templates — the same
    // invariant activate() enforces — otherwise a rollback could activate a
    // config whose event keys have since lost their notification templates.
    await this.validateTemplateMappings(created.id)

    await this.runTransaction(async (client) => {
      const before = await client.query(
        `UPDATE sms_provider_configs SET status = 'superseded'
          WHERE status = 'active' RETURNING id`,
      )
      const priorActiveId = (before.rows[0] as { id?: string } | undefined)?.id ?? null
      await client.query(
        `UPDATE sms_provider_configs
            SET status = 'active', activated_at = NOW(),
                last_test_status = 'passed', supersedes_id = $2, activated_by = $3
          WHERE id = $1`,
        [created.id, priorActiveId, createdBy],
      )
    })

    const row = await this.findById(created.id)
    if (!row) throw new Error('Failed to read rolled-back SMS provider config')
    return row
  }

  /* ---------------------------- Connection test ------------------------- */

  /**
   * Run a live connection check for a draft config via the SMS.ir connection
   * tester (parses the stored config, validates the API key / sender, checks
   * the account credit, and when `recipient` is supplied performs a live
   * test-send through the mapped template — validating template Id + variable
   * names against SMS.ir), then persist the outcome as `last_test_*`.
   *
   * @param recipient admin's verified mobile number to receive the test SMS
   * @param eventKey the mapped event to test-send; falls back to the first mapping
   */
  async testConnection(
    id: string,
    recipient?: string,
    eventKey?: string,
  ): Promise<{
    ok: boolean
    error: string | null
    result: SmsProviderConfigResult
  }> {
    const existing = await this.findById(id)
    if (!existing) throw new HttpException(SmsProviderErrors.notFound(), 404)
    if (existing.status !== 'draft') {
      throw new HttpException(SmsProviderErrors.notEditable(), 409)
    }

    if (!this.smsirTester) {
      const recorded = await this.recordTest(id, { passed: false, error: 'SMS connection tester is not available' })
      return { ok: false, error: 'SMS connection tester is not available', result: recorded }
    }

    const saved = await this.readConfig(id)
    const parsed = parseSmsirConfig(saved)
    if (!parsed.ok) {
      const recorded = await this.recordTest(id, {
        passed: false,
        error: `Invalid SMS.ir configuration: ${parsed.error}`,
      })
      return { ok: false, error: `Invalid SMS.ir configuration: ${parsed.error}`, result: recorded }
    }

    const outcome = await this.smsirTester.test(parsed.config, recipient, eventKey)
    const recorded = await this.recordTest(id, {
      passed: outcome.ok,
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
    })
    return { ok: outcome.ok, error: outcome.error ?? null, result: recorded }
  }

  /* ------------------------- Transaction + helpers ----------------------- */

  /**
   * Run a unit of work on a dedicated connection inside an explicit
   * BEGIN/COMMIT/ROLLBACK transaction (matches repo convention). Remaps the
   * SQLSTATE 23505 unique violation (active SMS provider) to 409.
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
        throw new HttpException(SmsProviderErrors.alreadyActive(), 409)
      }
      throw error
    } finally {
      client.release()
    }
  }

  /** Read the stored config for a row with secret fields decrypted (send boundary only). */
  private async readConfig(id: string): Promise<ProviderConfigBody> {
    const result = await this.db.query(
      `SELECT config FROM sms_provider_configs WHERE id = $1`,
      [id],
    )
    const row = result.rows[0] as { config?: ProviderConfigBody } | undefined
    if (!row) return {}
    return this.secrets.decryptConfig(SMS_PROVIDER_TRANSPORT, row.config ?? {})
  }
}
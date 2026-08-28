import { Inject, Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import {
  extractContractTemplatePlaceholders,
  CONTRACT_TEMPLATE_STATUS_DEFAULT,
  type ContractTemplateDto,
  type ContractTemplateStatus,
  type ContractTemplateVersionDto,
} from '@barghsa/shared/admin'
import type { StorageProvider } from '@barghsa/shared/storage'
import { StorageProviderError } from '@barghsa/shared/storage'
import { STORAGE_PROVIDER } from '../storage/index.js'
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js'

/**
 * Contract template management service (T-09.12.04) — API slice.
 *
 * Admin surface (permission `admin:documents:edit` at the controller
 * boundary, mapped to platform admin today per the S-09 convention):
 * - `create` / `update` template metadata (name, description, status).
 * - `uploadVersion` stores a template file in object storage under a
 *   unique key, extracts placeholders from its content via the shared
 *   {@link extractContractTemplatePlaceholders} regex, and appends an
 *   append-only {@link createContractTemplateVersions} row. The version
 *   number is a 1-based per-template sequence; previous versions' files
 *   are never touched, so old files stay as the archive of prior
 *   versions.
 * - `list` / `get` return templates with their version history.
 * - `delete` is a hard-delete that ONLY succeeds for a template with no
 *   versions and no contract-type link rows. Any template that has
 *   version history, or is referenced by a contract type
 *   (`contract_type_templates`), is protected: versioned templates must
 *   be archived via `status = inactive`, and referenced templates are
 *   rejected with 409 (the RESTRICT FKs guarantee this at the DB level
 *   too — see migration 0049).
 *
 * Scope note (T-09.12.04 API slice): placeholder extraction operates on
 * the file's text content via the shared `{{name}}` regex. This slice
 * accepts text-based templates (`text/*` content types), which is where
 * `{{date}}`/`{{customerName}}`/`{{amount}}` are extracted and stored.
 * Binary document formats (`.docx` — a zip whose text lives in
 * `word/document.xml`) are a documented follow-up: the current
 * upload endpoint validates `text/*` only, so a `.docx` upload is
 * rejected rather than silently parsed as bytes. See the PR body /
 * controller ApiOperation for the deferred follow-up.
 *
 * Object storage: the file body is written through the global
 * `STORAGE_PROVIDER`. When storage is not configured (no S3), uploads
 * fail with 503 rather than silently dropping the file.
 *
 * Every mutation runs in ONE transaction and records an `audit_log`
 * `change_recorded` event with the request correlation id (the epic's
 * audit contract).
 */

// ─── Public types ──────────────────────────────────────────────────────────

export interface CreateContractTemplateInput {
  name: string
  description?: string
  actorUserId: string
  ip: string
}

export interface UpdateContractTemplateInput {
  name?: string
  description?: string | null
  status?: ContractTemplateStatus
  actorUserId: string
  ip: string
}

export interface UploadContractTemplateVersionInput {
  /** Original upload file name (used for the storage suffix). */
  fileName: string
  /** MIME content type. */
  contentType?: string
  /** Raw template content. Placeholders are extracted from this. */
  content: string
  actorUserId: string
  ip: string
}

// ─── Internal row types ────────────────────────────────────────────────────

type QueryFn = <T = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[]; rowCount: number | null }>

/** Minimal query executor shared by the pool and a transactional client. */
export type DbExecutor = { query: QueryFn }

interface TemplateRow {
  id: string
  name: string
  description: string | null
  status: ContractTemplateStatus
  created_by: string
  created_at: string
  updated_at: string
}

interface VersionRow {
  id: string
  template_id: string
  version_number: number
  storage_key: string
  file_name: string
  content_type: string | null
  file_size: number | null
  placeholders: string[]
  created_by: string
  created_at: string
}

const PG_UNIQUE_VIOLATION = '23505'
const PG_FOREIGN_KEY_VIOLATION = '23503'

const TEMPLATE_NOT_FOUND = 'CONTRACT_TEMPLATE_NOT_FOUND'
const TEMPLATE_ALREADY_EXISTS = 'CONTRACT_TEMPLATE_ALREADY_EXISTS'
const TEMPLATE_REFERENCED = 'CONTRACT_TEMPLATE_REFERENCED'
const TEMPLATE_VERSIONED = 'CONTRACT_TEMPLATE_VERSIONED'
const TEMPLATE_STORAGE_DISABLED = 'CONTRACT_TEMPLATE_STORAGE_DISABLED'
const TEMPLATE_INVALID_NAME = 'CONTRACT_TEMPLATE_INVALID_NAME'

/** Storage key prefix for contract template files (kept separate from
 * general `uploads/` so template history is never garbage-collected by
 * generic upload tooling). */
const TEMPLATE_STORAGE_PREFIX = 'contract-templates/'

/** Maximum template file size accepted (bytes) — guards memory pressure. */
const MAX_TEMPLATE_FILE_SIZE = 10 * 1024 * 1024

@Injectable()
export class ContractTemplateService {
  private readonly logger = new Logger(ContractTemplateService.name)

  constructor(
    @Inject(CorrelationIdProvider)
    private readonly correlationIdProvider: CorrelationIdProvider,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider | null,
  ) {}

  // ─── Admin reads ───────────────────────────────────────────────────────

  /** List templates, newest first, with version counts + latest version. */
  async list(): Promise<ContractTemplateDto[]> {
    const pool = getDbPool()
    const templates = await pool.query<TemplateRow & { version_count: number }>(
      `SELECT ct.id, ct.name, ct.description, ct.status, ct.created_by,
              ct.created_at, ct.updated_at,
              COUNT(ctv.id)::int AS version_count
         FROM contract_templates ct
         LEFT JOIN contract_template_versions ctv ON ctv.template_id = ct.id
        GROUP BY ct.id
        ORDER BY ct.created_at DESC`,
    )
    const latest = await this.latestVersions(pool, templates.rows.map((r) => r.id))
    return templates.rows.map((row) => this.toDto(row, row.version_count, latest.get(row.id) ?? null))
  }

  /** Full template detail with every version, oldest first. */
  async get(id: string): Promise<ContractTemplateDto> {
    const pool = getDbPool()
    const row = await this.findById(pool, id)
    if (!row) throw this.notFound(id)
    const count = await pool.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM contract_template_versions WHERE template_id = $1',
      [id],
    )
    const versions = await this.versionsFor(pool, id)
    const latest = versions.length > 0 ? versions[versions.length - 1]! : null
    return this.toDto(row, count.rows[0]?.n ?? 0, latest)
  }

  // ─── Admin mutations ───────────────────────────────────────────────────

  /**
   * Create a template. Name is trimmed and must be non-empty; the DB's
   * case-insensitive UNIQUE index on LOWER(name) makes duplicate names a
   * hard 409 guarantee.
   */
  async create(input: CreateContractTemplateInput): Promise<ContractTemplateDto> {
    const name = this.assertName(input.name)
    return this.withTransaction(async (q) => {
      const existing = await q.query('SELECT 1 FROM contract_templates WHERE LOWER(name) = $1', [
        name.toLowerCase(),
      ])
      if (existing.rows.length > 0) throw this.alreadyExists(name)

      const id = uuidv7()
      const now = new Date()
      await q.query(
        `INSERT INTO contract_templates
           (id, name, description, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [id, name, input.description ?? null, CONTRACT_TEMPLATE_STATUS_DEFAULT, input.actorUserId, now],
      )
      await this.recordChange(q, {
        actorUserId: input.actorUserId,
        ip: input.ip,
        entity: 'contract_template',
        action: 'created',
        meta: { templateId: id, name, ...(input.description ? { description: input.description } : {}) },
      })
      this.logger.log(`Contract template created: id=${id}, name=${name}, actor=${input.actorUserId}`)
      return this.readDto(q, id)
    })
  }

  /**
   * Update template metadata (name / description / status). Renaming
   * re-checks case-insensitive uniqueness excluding self. Status
   * `inactive` is the archival path; versioned templates can NEVER be
   * hard-deleted, so deactivation is how an admin retires them.
   */
  async update(id: string, input: UpdateContractTemplateInput): Promise<ContractTemplateDto> {
    return this.withTransaction(async (q) => {
      const current = await this.findById(q, id)
      if (!current) throw this.notFound(id)

      const name = input.name !== undefined ? this.assertName(input.name) : current.name
      if (name !== current.name) {
        const dup = await q.query(
          'SELECT 1 FROM contract_templates WHERE LOWER(name) = $1 AND id <> $2',
          [name.toLowerCase(), id],
        )
        if (dup.rows.length > 0) throw this.alreadyExists(name)
      }
      const status = input.status ?? current.status
      const description =
        input.description !== undefined ? input.description : current.description

      await q.query(
        `UPDATE contract_templates
            SET name = $1, description = $2, status = $3
          WHERE id = $4`,
        [name, description, status, id],
      )
      await this.recordChange(q, {
        actorUserId: input.actorUserId,
        ip: input.ip,
        entity: 'contract_template',
        action: 'updated',
        meta: {
          templateId: id,
          ...(input.name !== undefined ? { name, previousName: current.name } : {}),
          ...(input.description !== undefined ? { description } : {}),
          ...(input.status !== undefined ? { status } : {}),
        },
      })
      this.logger.log(`Contract template updated: id=${id}, actor=${input.actorUserId}`)
      return this.readDto(q, id)
    })
  }

  /**
   * Upload a new version of a template: store the file in object
   * storage, extract placeholders from its content, and append an
   * append-only version row. Version numbers sequence from 1 per
   * template; prior versions and their files are never touched.
   */
  async uploadVersion(
    id: string,
    input: UploadContractTemplateVersionInput,
  ): Promise<ContractTemplateVersionDto> {
    if (!this.storage) {
      throw new HttpException(
        {
          statusCode: 503,
          error: TEMPLATE_STORAGE_DISABLED,
          message: 'Object storage is not configured (set S3_BUCKET and S3_REGION)',
        },
        503,
      )
    }
    const name = this.assertFileName(input.fileName)
    const content = this.assertContent(input.content)
    const placeholders = extractContractTemplatePlaceholders(content)
    const effectiveContentType = input.contentType ?? 'text/plain'
    const storageKey = this.buildStorageKey(name)

    // Cheap pre-transaction existence check so an unknown template id
    // never touches object storage (the reviewer r2 minor; the FOR UPDATE
    // read inside the transaction remains authoritative for races).
    const pool = getDbPool()
    const exists = await pool.query('SELECT 1 FROM contract_templates WHERE id = $1', [id])
    if (exists.rows.length === 0) throw this.notFound(id)

    try {
      await this.storage.putObject(storageKey, content, effectiveContentType, {
        fileName: this.asciiMetadataValue(name),
        templateId: id,
      })
    } catch (err) {
      this.logger.error(`Contract template file upload failed:`, err)
      if (err instanceof StorageProviderError) {
        throw new HttpException(
          { statusCode: 503, error: TEMPLATE_STORAGE_DISABLED, message: 'Object storage write failed' },
          503,
        )
      }
      throw err
    }

    const fileSize = Buffer.byteLength(content, 'utf8')
    try {
      return await this.withTransaction(async (q) => {
        const current = await this.findById(q, id)
        if (!current) throw this.notFound(id)

        // Serialize the version-number sequence per template: lock the
        // template row FOR UPDATE before reading MAX(version_number), so
        // two concurrent uploads on the same template cannot compute the
        // same next number at READ COMMITTED. The
        // uq_contract_template_versions_template_ver index remains the
        // hard backstop (mapped to a retryable 409 in translatePgErrors).
        await q.query('SELECT 1 FROM contract_templates WHERE id = $1 FOR UPDATE', [id])

        const maxSeq = await q.query<{ n: number }>(
          'SELECT COALESCE(MAX(version_number), 0)::int AS n FROM contract_template_versions WHERE template_id = $1',
          [id],
        )
        const versionNumber = (maxSeq.rows[0]?.n ?? 0) + 1
        const versionId = uuidv7()
        const inserted = await q.query<{ created_at: string | Date }>(
          `INSERT INTO contract_template_versions
            (id, template_id, version_number, storage_key, file_name, content_type,
             file_size, placeholders, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING created_at`,
          [
            versionId, id, versionNumber, storageKey, name,
            effectiveContentType, fileSize, placeholders, input.actorUserId, new Date(),
          ],
        )
        // Ensure the template is active once it has its first version (a
        // newly-uploaded file makes the template usable).
        if (current.status === 'inactive' && versionNumber === 1) {
          await q.query("UPDATE contract_templates SET status = 'active' WHERE id = $1", [id])
        }
        await this.recordChange(q, {
          actorUserId: input.actorUserId,
          ip: input.ip,
          entity: 'contract_template',
          action: 'version_uploaded',
          meta: {
            templateId: id,
            versionNumber,
            storageKey,
            fileName: name,
            fileSize,
            placeholders,
          },
        })
        this.logger.log(
          `Contract template v${versionNumber} uploaded: template=${id}, file=${name}, placeholders=${placeholders.length}`,
        )
        return {
          versionNumber,
          storageKey,
          fileName: name,
          contentType: effectiveContentType,
          fileSize,
          placeholders,
          createdBy: input.actorUserId,
          createdAt: inserted.rows[0]?.created_at
            ? new Date(inserted.rows[0].created_at).toISOString()
            : new Date().toISOString(),
        }
      })
    } catch (err) {
      // Roll the orphaned object back out of storage if the DB insert
      // failed and we know the key (best-effort; the object alone is
      // harmless garbage, but shouldn't linger).
      this.storage.deleteObject(storageKey).catch(() => {})
      throw err
    }
  }

  /**
   * Delete a template. Only succeeds for a template with NO versions and
   * NO contract-type link rows. Versioned templates must be archived
   * (status = inactive) — their files are the audit archive. Template
   * referenced by a contract type is rejected with 409 (the DB RESTRICT
   * FK is the hard guarantee). Soft-path: the service prefers to
   * deactivate rather than throw where context allows.
   */
  async delete(id: string, actorUserId: string, ip: string): Promise<{ deleted: boolean }> {
    return this.withTransaction(async (q) => {
      const current = await this.findById(q, id)
      if (!current) throw this.notFound(id)

      const versions = await q.query('SELECT 1 FROM contract_template_versions WHERE template_id = $1 LIMIT 1', [id])
      if (versions.rows.length > 0) {
        throw new HttpException(
          {
            statusCode: 409,
            error: TEMPLATE_VERSIONED,
            message:
              'Contract template has version history and cannot be deleted; deactivate it instead (status=inactive)',
          },
          409,
        )
      }
      const refs = await q.query('SELECT 1 FROM contract_type_templates WHERE template_id = $1 LIMIT 1', [id])
      if (refs.rows.length > 0) {
        throw this.referenced(id)
      }

      await q.query('DELETE FROM contract_templates WHERE id = $1', [id])
      await this.recordChange(q, {
        actorUserId,
        ip,
        entity: 'contract_template',
        action: 'deleted',
        meta: { templateId: id, name: current.name },
      })
      this.logger.log(`Contract template deleted: id=${id}, name=${current.name}, actor=${actorUserId}`)
      return { deleted: true }
    })
  }

  // ─── DTO mapping ───────────────────────────────────────────────────────

  private toDto(
    row: TemplateRow,
    versionCount: number,
    latest: ContractTemplateVersionDto | null,
  ): ContractTemplateDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      versionCount,
      latestVersion: latest,
    }
  }

  private toVersionDto(row: VersionRow): ContractTemplateVersionDto {
    return {
      versionNumber: row.version_number,
      storageKey: row.storage_key,
      fileName: row.file_name,
      contentType: row.content_type,
      fileSize: row.file_size,
      placeholders: row.placeholders,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }
  }

  private async latestVersions(
    q: DbExecutor,
    templateIds: string[],
  ): Promise<Map<string, ContractTemplateVersionDto>> {
    const out = new Map<string, ContractTemplateVersionDto>()
    if (templateIds.length === 0) return out
    const rows = await q.query<VersionRow>(
      `SELECT DISTINCT ON (template_id) id, template_id, version_number, storage_key,
              file_name, content_type, file_size, placeholders, created_by, created_at
         FROM contract_template_versions
        WHERE template_id = ANY($1::uuid[])
        ORDER BY template_id, version_number DESC`,
      [templateIds],
    )
    for (const row of rows.rows) out.set(row.template_id, this.toVersionDto(row))
    return out
  }

  private async versionsFor(q: DbExecutor, templateId: string): Promise<ContractTemplateVersionDto[]> {
    const rows = await q.query<VersionRow>(
      `SELECT id, template_id, version_number, storage_key, file_name, content_type,
              file_size, placeholders, created_by, created_at
         FROM contract_template_versions
        WHERE template_id = $1
        ORDER BY version_number ASC`,
      [templateId],
    )
    return rows.rows.map((r) => this.toVersionDto(r))
  }

  private async findById(q: DbExecutor, id: string): Promise<TemplateRow | null> {
    const result = await q.query<TemplateRow>(
      `SELECT id, name, description, status, created_by, created_at, updated_at
         FROM contract_templates
        WHERE id = $1`,
      [id],
    )
    return result.rows[0] ?? null
  }

  private async readDto(q: DbExecutor, id: string): Promise<ContractTemplateDto> {
    const row = await this.findById(q, id)
    if (!row) throw this.notFound(id)
    const count = await q.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM contract_template_versions WHERE template_id = $1',
      [id],
    )
    const versions = await this.versionsFor(q, id)
    const latest = versions.length > 0 ? versions[versions.length - 1]! : null
    return this.toDto(row, count.rows[0]?.n ?? 0, latest)
  }

  // ─── Validation ────────────────────────────────────────────────────────

  private assertName(raw: string): string {
    if (typeof raw !== 'string') throw this.invalidName()
    const name = raw.trim()
    if (name.length === 0) throw this.invalidName()
    if (name.length > 200) throw this.invalidName()
    return name
  }

  private assertFileName(raw: string): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new HttpException(
        { statusCode: 400, error: 'CONTRACT_TEMPLATE_INVALID_FILE', message: 'fileName is required' },
        400,
      )
    }
    // Prevent path traversal in the storage suffix and trim surrounding
    // whitespace (r2 minor: a ' power.docx ' name persisted verbatim).
    return (raw.split(/[\\/]/).pop() ?? raw).trim()
  }

  /**
   * S3 user metadata must be US-ASCII; strip non-ASCII characters while
   * keeping the DB column's original sanitized name.
   */
  private asciiMetadataValue(value: string): string {
    return value.replace(/[^\x20-\x7E]/g, '_')
  }

  private assertContent(raw: string): string {
    if (typeof raw !== 'string') {
      throw new HttpException(
        { statusCode: 400, error: 'CONTRACT_TEMPLATE_INVALID_FILE', message: 'content must be a string' },
        400,
      )
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_TEMPLATE_FILE_SIZE) {
      throw new HttpException(
        {
          statusCode: 413,
          error: 'CONTRACT_TEMPLATE_FILE_TOO_LARGE',
          message: `Template file exceeds ${MAX_TEMPLATE_FILE_SIZE / (1024 * 1024)} MB`,
        },
        413,
      )
    }
    return raw
  }

  private buildStorageKey(fileName: string): string {
    // Extension derived only from a whitelist-safe suffix (letters/digits,
    // 1-10 chars) so a hostile name can never inject path separators or
    // '..' into the key. `fileName` here is already the sanitized basename.
    const m = /\.([A-Za-z0-9]{1,10})$/.exec(fileName)
    const ext = m ? `.${m[1]!.toLowerCase()}` : ''
    return `${TEMPLATE_STORAGE_PREFIX}${uuidv7()}${ext}`
  }

  private invalidName(): HttpException {
    return new HttpException(
      {
        statusCode: 400,
        error: TEMPLATE_INVALID_NAME,
        message: 'name is required and must be 1-200 characters',
      },
      400,
    )
  }

  private notFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: TEMPLATE_NOT_FOUND, message: `Contract template ${id} not found` },
      404,
    )
  }

  private alreadyExists(name: string): HttpException {
    return new HttpException(
      {
        statusCode: 409,
        error: TEMPLATE_ALREADY_EXISTS,
        message: `A contract template named "${name}" already exists (names are case-insensitive)`,
      },
      409,
    )
  }

  private referenced(id: string): HttpException {
    return new HttpException(
      {
        statusCode: 409,
        error: TEMPLATE_REFERENCED,
        message: `Contract template ${id} is referenced by one or more contract types and cannot be deleted`,
      },
      409,
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

  /** Run `fn` inside a single DB transaction; any error rolls back. */
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
      this.translatePgErrors(error)
      throw error
    } finally {
      client.release()
    }
  }

  private translatePgErrors(error: unknown): void {
    if (this.isPgError(error, PG_UNIQUE_VIOLATION)) {
      const constraint = (error as { constraint?: string }).constraint
      if (constraint === 'uq_contract_templates_name_lower') {
        throw new HttpException(
          {
            statusCode: 409,
            error: TEMPLATE_ALREADY_EXISTS,
            message: 'A contract template with this name already exists (names are case-insensitive)',
          },
          409,
        )
      }
      if (constraint === 'uq_contract_template_versions_storage_key') {
        throw new HttpException(
          { statusCode: 409, error: 'CONTRACT_TEMPLATE_VERSION_CONFLICT', message: 'Template file already stored' },
          409,
        )
      }
      if (constraint === 'uq_contract_template_versions_template_ver') {
        // A concurrent upload won the version-number race despite the row
        // lock (e.g. held by another transaction); retryable.
        throw new HttpException(
          {
            statusCode: 409,
            error: 'CONTRACT_TEMPLATE_VERSION_RACE',
            message: 'Template version race — retry the upload',
          },
          409,
        )
      }
      throw new HttpException(
        { statusCode: 409, error: 'CONTRACT_TEMPLATE_CONFLICT', message: 'Contract template conflict' },
        409,
      )
    }
    if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
      // INSERT of a version onto a deleted template, or a template row
      // whose created_by no longer exists.
      throw new HttpException(
        { statusCode: 409, error: TEMPLATE_REFERENCED, message: 'Contract template reference is invalid' },
        409,
      )
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

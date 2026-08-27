import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { NotificationsService } from './notifications.service.js'

export type TemplateChannel = 'email' | 'sms' | 'in_app'
export type TemplateLocale = 'fa' | 'en'
export type TemplateStatus = 'draft' | 'active' | 'archived'

/**
 * A single allow-listed template variable.
 *
 * `name` is the `{{name}}` placeholder used in the template body; `description`
 * is human-readable guidance for admin preview/authoring (T-05.04.01). For
 * backward compatibility, legacy storage as a plain string array is normalized
 * to this shape (description = null).
 */
export interface TemplateVariable {
  name: string
  description: string | null
}

/** Accepts either {@link TemplateVariable} objects or legacy plain string names. */
export type TemplateVariableInput =
  | string
  | TemplateVariable
  | { name: string; description?: string | null | undefined }

export interface NotificationTemplateResult {
  id: string
  eventKey: string
  channel: TemplateChannel
  locale: TemplateLocale
  subject: string | null
  bodyTemplate: string
  variables: TemplateVariable[]
  status: TemplateStatus
  isActive: boolean
  version: number
  publishedAt: Date | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateNotificationTemplateInput {
  eventKey: string
  channel: TemplateChannel
  locale: TemplateLocale
  subject?: string | null
  bodyTemplate: string
  variables: TemplateVariableInput[]
}

export interface UpdateNotificationTemplateInput {
  subject?: string | null
  bodyTemplate?: string
  variables?: TemplateVariableInput[]
}

export interface PageTemplatesOptions {
  locale?: TemplateLocale
  channel?: TemplateChannel
  status?: TemplateStatus
}

export interface RenderedTemplate {
  subject: string | null
  body: string
  variables: TemplateVariable[]
}

/**
 * Notification template service (T-09.04.01).
 *
 * Manages the CRUD, validation, rendering, preview, test-send, and publish
 * lifecycle for notification templates.
 *
 * Security: template variables are allow-listed and all variable values are
 * HTML-escaped on render to prevent injection into delivered messages.
 *
 * Permission model: all methods require admin context (enforced in controller).
 */
@Injectable()
export class NotificationTemplateService {
  private readonly logger = new Logger(NotificationTemplateService.name)

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Normalize a list of variable inputs (either `{name, description}` objects or
   * legacy plain `string` names) into canonical {@link TemplateVariable} shape.
   * Backward compatible: existing rows stored as `string[]` map to
   * `{ name, description: null }`. Empty/whitespace names are dropped.
   */
  static normalizeVariables(
    input: TemplateVariableInput[] | null | undefined,
  ): TemplateVariable[] {
    const out: TemplateVariable[] = []
    const seen = new Set<string>()
    for (const raw of input ?? []) {
      const obj = typeof raw === 'string' ? null : raw
      const name = (obj ? obj.name : (raw as string)).trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push({
        name,
        description: !obj ? null : obj.description?.trim() || null,
      })
    }
    return out
  }

  /**
   * Row mapper: converts raw DB row to camelCase NotificationTemplateResult.
   */
  private mapRow(row: Record<string, unknown>): NotificationTemplateResult {
    return {
      id: row.id as string,
      eventKey: row.event_key as string,
      channel: row.channel as TemplateChannel,
      locale: row.locale as TemplateLocale,
      subject: (row.subject as string) ?? null,
      bodyTemplate: row.body_template as string,
      variables: NotificationTemplateService.normalizeVariables(
        row.variables as TemplateVariableInput[],
      ),
      status: row.status as TemplateStatus,
      isActive: row.is_active as boolean,
      version: (row.version as number) ?? 1,
      publishedAt: (row.published_at as Date) ?? null,
      createdBy: (row.created_by as string) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    }
  }

  private readonly SELECT_COLUMNS = `id, event_key, channel, locale, subject,
      body_template, variables, status, is_active, version, published_at,
      created_by, created_at, updated_at`

  /**
   * Escape a string for safe HTML/text output, preventing injection of
   * arbitrary markup/script via template variable values.
   */
  escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /**
   * Validate that every `{{placeholder}}` in the body is (a) well-formed and
   * (b) present in the template's allow-listed `variables`. Rejects unknown
   * variables and unclosed placeholders with a 400.
   */
  validateVariables(
    bodyTemplate: string,
    variables: TemplateVariableInput[],
  ): void {
    const allowed = new Set<string>(
      NotificationTemplateService.normalizeVariables(variables).map((v) => v.name),
    )

    const opens = (bodyTemplate.match(/{{/g) ?? []).length
    const closes = (bodyTemplate.match(/}}/g) ?? []).length
    if (opens !== closes) {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'NOTIFICATION_TEMPLATE_INVALID_VARIABLES',
          message: 'Template contains an unclosed {{...}} placeholder',
        },
        400,
      )
    }

    const re = /{{([^{}]+)}}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(bodyTemplate)) !== null) {
      const name = m[1]!.trim()
      if (!/^[A-Za-z0-9_.]+$/.test(name)) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'NOTIFICATION_TEMPLATE_INVALID_VARIABLES',
            message: `Invalid variable name "${name}" in template`,
          },
          400,
        )
      }
      if (!allowed.has(name)) {
        throw new HttpException(
          {
            statusCode: 400,
            error: 'NOTIFICATION_TEMPLATE_UNKNOWN_VARIABLE',
            message: `Variable "${name}" is not in the allow-list`,
          },
          400,
        )
      }
    }
  }

  /**
   * Render a template body/subject, substituting allow-listed variables with
   * escaped values. Unknown placeholders render as their escaped literal.
   */
  render(
    template: string,
    variables: TemplateVariableInput[],
    data?: Record<string, unknown>,
  ): string {
    const allowed = new Set<string>(
      NotificationTemplateService.normalizeVariables(variables).map((v) => v.name),
    )
    const ctx = data ?? {}
    return template.replace(/{{([^{}]+)}}/g, (match, raw) => {
      const name = raw.trim()
      if (!allowed.has(name)) return this.escapeHtml(match)
      const value = ctx[name]
      if (value === undefined || value === null) return ''
      return this.escapeHtml(String(value))
    })
  }

  /**
   * Build neutral sample values for every allow-listed variable, used by
   * preview and test-send.
   */
  buildSampleData(variables: TemplateVariableInput[]): Record<string, string> {
    const data: Record<string, string> = {}
    for (const v of NotificationTemplateService.normalizeVariables(variables)) {
      const key = v.name.trim()
      if (key) data[key] = key.replace(/([A-Z])/g, ' $1').trim().toLowerCase()
    }
    return data
  }

  /**
   * List notification templates with optional filtering. Archived (historical)
   * versions are excluded by default so the admin list shows current work.
   */
  async list(
    options?: PageTemplatesOptions,
  ): Promise<NotificationTemplateResult[]> {
    const pool = getDbPool()

    let sql = `SELECT ${this.SELECT_COLUMNS}
               FROM notification_templates
               WHERE 1=1`
    const params: unknown[] = []
    let paramIndex = 1

    if (!options?.status) {
      sql += ` AND status != 'archived'`
    }
    if (options?.locale) {
      sql += ` AND locale = $${paramIndex++}`
      params.push(options.locale)
    }
    if (options?.channel) {
      sql += ` AND channel = $${paramIndex++}`
      params.push(options.channel)
    }
    if (options?.status) {
      sql += ` AND status = $${paramIndex++}`
      params.push(options.status)
    }

    sql += ' ORDER BY event_key ASC, channel ASC, locale ASC, version DESC'

    const result = await pool.query(sql, params)
    return result.rows.map((row: Record<string, unknown>) => this.mapRow(row))
  }

  /**
   * Get a single notification template by id.
   */
  async getById(id: string): Promise<NotificationTemplateResult> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT ${this.SELECT_COLUMNS}
       FROM notification_templates
       WHERE id = $1`,
      [id],
    )

    if (result.rows.length === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'NOTIFICATION_TEMPLATE_NOT_FOUND',
          message: 'Notification template not found',
        },
        404,
      )
    }

    return this.mapRow(result.rows[0]!)
  }

  /**
   * Create a new notification template as a draft (version 1).
   *
   * Rejects creation when an active or draft template already exists for the
   * same event_key+channel+locale (archived history does not block a new draft).
   */
  async create(
    input: CreateNotificationTemplateInput,
    actorUserId: string,
  ): Promise<NotificationTemplateResult> {
    const pool = getDbPool()

    // Validate template variables against the allow-list before persisting.
    this.validateVariables(input.bodyTemplate, input.variables ?? [])

    // Canonicalize variable names + optional descriptions (accepts legacy strings).
    const normalizedVariables =
      NotificationTemplateService.normalizeVariables(input.variables)

    // Enforce at most one draft/active template per event+channel+locale.
    // The DB partial unique index (uq_notification_templates_active) only
    // covers active rows (is_active=true), so duplicate-draft prevention must
    // be app-level. Archived history does not block a new draft.
    const existing = await pool.query(
      `SELECT 1 FROM notification_templates
       WHERE event_key = $1 AND channel = $2 AND locale = $3
         AND status IN ('draft', 'active')
       LIMIT 1`,
      [input.eventKey, input.channel, input.locale],
    )
    if (existing.rows.length > 0) {
      throw new HttpException(
        {
          statusCode: 409,
          error: 'NOTIFICATION_TEMPLATE_EXISTS',
          message: `A template already exists for event "${input.eventKey}" (${input.channel}/${input.locale})`,
        },
        409,
      )
    }

    const id = uuidv7()
    const now = new Date()

    const result = await pool.query<Record<string, unknown>>(
      `INSERT INTO notification_templates
       (id, event_key, channel, locale, subject, body_template, variables,
        status, is_active, version, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'draft', false, 1, $8, $9, $9)
       RETURNING ${this.SELECT_COLUMNS}`,
      [
        id,
        input.eventKey,
        input.channel,
        input.locale,
        input.subject ?? null,
        input.bodyTemplate,
        JSON.stringify(normalizedVariables),
        actorUserId,
        now,
      ],
    )

    this.logger.log(
      `Notification template created: id=${id} event=${input.eventKey} ` +
        `channel=${input.channel} locale=${input.locale} by ${actorUserId}`,
    )

    return this.mapRow(result.rows[0]!)
  }

  /**
   * Update a draft notification template.
   * Only draft templates can be edited.
   */
  async update(
    id: string,
    input: UpdateNotificationTemplateInput,
    actorUserId: string,
  ): Promise<NotificationTemplateResult> {
    const pool = getDbPool()

    // Verify the template exists and is a draft
    const template = await pool.query(
      `SELECT id, status, body_template, variables FROM notification_templates WHERE id = $1`,
      [id],
    )

    if (template.rows.length === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'NOTIFICATION_TEMPLATE_NOT_FOUND',
          message: 'Notification template not found',
        },
        404,
      )
    }

    if (template.rows[0]!.status !== 'draft') {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'NOTIFICATION_TEMPLATE_NOT_DRAFT',
          message: 'Only draft templates can be edited',
        },
        400,
      )
    }

    // Validate the resulting body against the (possibly updated) allow-list.
    const nextBody =
      input.bodyTemplate !== undefined
        ? input.bodyTemplate
        : (template.rows[0]!.body_template as string)
    const nextVariablesRaw =
      input.variables !== undefined
        ? input.variables
        : ((template.rows[0]!.variables as TemplateVariableInput[]) ?? [])
    this.validateVariables(nextBody, nextVariablesRaw)
    const normalizedVariables =
      NotificationTemplateService.normalizeVariables(nextVariablesRaw)

    // Build dynamic SET clause
    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (input.subject !== undefined) {
      setClauses.push(`subject = $${paramIndex++}`)
      params.push(input.subject)
    }
    if (input.bodyTemplate !== undefined) {
      setClauses.push(`body_template = $${paramIndex++}`)
      params.push(input.bodyTemplate)
    }
    if (input.variables !== undefined) {
      setClauses.push(`variables = $${paramIndex++}::jsonb`)
      params.push(JSON.stringify(normalizedVariables))
    }

    if (setClauses.length === 0) {
      // Nothing to update — return current state
      return this.getById(id)
    }

    setClauses.push(`updated_at = $${paramIndex++}`)
    const now = new Date()
    params.push(now)

    params.push(id)

    const result = await pool.query<Record<string, unknown>>(
      `UPDATE notification_templates
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING ${this.SELECT_COLUMNS}`,
      params,
    )

    this.logger.log(
      `Notification template updated: id=${id} by ${actorUserId}`,
    )

    return this.mapRow(result.rows[0]!)
  }

  /**
   * Render a preview of a template using sample (or caller-provided) data.
   */
  async preview(
    id: string,
    sampleData?: Record<string, string>,
  ): Promise<RenderedTemplate> {
    const tpl = await this.getById(id)
    const data = sampleData ?? this.buildSampleData(tpl.variables)
    return {
      subject: tpl.subject !== null ? this.render(tpl.subject, tpl.variables, data) : null,
      body: this.render(tpl.bodyTemplate, tpl.variables, data),
      variables: tpl.variables,
    }
  }

  /**
   * Render a template body with arbitrary allow-listed sample data (used by
   * the frontend preview pane before a draft is saved).
   */
  async previewFromBody(
    bodyTemplate: string,
    variables: TemplateVariableInput[],
    sampleData?: Record<string, string>,
  ): Promise<RenderedTemplate> {
    const normalized = NotificationTemplateService.normalizeVariables(variables)
    this.validateVariables(bodyTemplate, normalized)
    const data = sampleData ?? this.buildSampleData(normalized)
    return {
      subject: null,
      body: this.render(bodyTemplate, normalized, data),
      variables: normalized,
    }
  }

  /**
   * Test-send: render the template and deliver it to the admin's own verified
   * destination. Out-of-app transport (email/SMS) belongs to E-05, so the
   * available verified destination today is an in-app notification to the
   * acting admin's account.
   */
  async testSend(
    id: string,
    actorUserId: string,
  ): Promise<{ ok: boolean; destination: 'in_app' }> {
    const tpl = await this.getById(id)
    const data = this.buildSampleData(tpl.variables)
    const renderedBody = this.render(tpl.bodyTemplate, tpl.variables, data)
    const renderedSubject =
      tpl.subject !== null ? this.render(tpl.subject, tpl.variables, data) : null

    await this.notificationsService.create({
      userId: actorUserId,
      type: 'general',
      title: renderedSubject ?? `Test: ${tpl.eventKey}`,
      body: renderedBody,
    })

    this.logger.log(
      `Notification template test-sent: id=${id} event=${tpl.eventKey} by ${actorUserId}`,
    )

    return { ok: true, destination: 'in_app' }
  }

  /**
   * Publish a draft template: promote it to active.
   *
   * Versioning: the previously-active template for the same
   * event+channel+locale is archived (is_active=false, status='archived') and
   * this template becomes the new active version with a bumped `version`.
   */
  async publish(
    id: string,
    actorUserId: string,
  ): Promise<NotificationTemplateResult> {
    const pool = getDbPool()

    // Verify the template exists and is a draft
    const template = await pool.query(
      `SELECT id, status, event_key, channel, locale FROM notification_templates WHERE id = $1`,
      [id],
    )

    if (template.rows.length === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'NOTIFICATION_TEMPLATE_NOT_FOUND',
          message: 'Notification template not found',
        },
        404,
      )
    }

    if (template.rows[0]!.status !== 'draft') {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'NOTIFICATION_TEMPLATE_NOT_DRAFT',
          message: 'Only draft templates can be published',
        },
        400,
      )
    }

    const tpl = template.rows[0]!
    const now = new Date()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // Archive any currently active template for this event+channel+locale.
      await client.query(
        `UPDATE notification_templates
         SET is_active = false, status = 'archived', updated_at = $1
         WHERE event_key = $2 AND channel = $3 AND locale = $4 AND is_active = true`,
        [now, tpl.event_key, tpl.channel, tpl.locale],
      )

      // Next version = max(version) + 1 for this combo.
      const maxVer = await client.query(
        `SELECT COALESCE(MAX(version), 0) AS v
         FROM notification_templates
         WHERE event_key = $1 AND channel = $2 AND locale = $3`,
        [tpl.event_key, tpl.channel, tpl.locale],
      )
      const nextVersion = Number(maxVer.rows[0]!.v) + 1

      // Publish this template as the new active version.
      const result = await client.query<Record<string, unknown>>(
        `UPDATE notification_templates
         SET status = 'active',
             is_active = true,
             version = $1,
             published_at = $2,
             updated_at = $2
         WHERE id = $3
         RETURNING ${this.SELECT_COLUMNS}`,
        [nextVersion, now, id],
      )

      // Record audit event
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          uuidv7(),
          actorUserId,
          'notification_template_published',
          JSON.stringify({
            templateId: id,
            eventKey: tpl.event_key,
            channel: tpl.channel,
            locale: tpl.locale,
            version: nextVersion,
          }),
          uuidv7(),
          'admin',
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Notification template published: id=${id} event=${tpl.event_key} ` +
        `channel=${tpl.channel} locale=${tpl.locale} v${nextVersion} by ${actorUserId}`,
      )

      return this.mapRow(result.rows[0]!)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (err instanceof HttpException) throw err
      this.logger.error(`Failed to publish notification template ${id}: ${String(err)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code },
        500,
      )
    } finally {
      client.release()
    }
  }

  /**
   * Unpublish an active template: revert it to draft.
   */
  async unpublish(
    id: string,
    actorUserId: string,
  ): Promise<NotificationTemplateResult> {
    const pool = getDbPool()

    const template = await pool.query(
      `SELECT id, status FROM notification_templates WHERE id = $1`,
      [id],
    )

    if (template.rows.length === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'NOTIFICATION_TEMPLATE_NOT_FOUND',
          message: 'Notification template not found',
        },
        404,
      )
    }

    if (template.rows[0]!.status !== 'active') {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'NOTIFICATION_TEMPLATE_NOT_ACTIVE',
          message: 'Only active templates can be unpublished',
        },
        400,
      )
    }

    const now = new Date()

    const result = await pool.query<Record<string, unknown>>(
      `UPDATE notification_templates
       SET status = 'draft',
           is_active = false,
           updated_at = $1
       WHERE id = $2
       RETURNING ${this.SELECT_COLUMNS}`,
      [now, id],
    )

    this.logger.log(
      `Notification template unpublished: id=${id} by ${actorUserId}`,
    )

    return this.mapRow(result.rows[0]!)
  }

  /**
   * Delete a draft notification template.
   */
  async delete(id: string, actorUserId: string): Promise<void> {
    const pool = getDbPool()

    const template = await pool.query(
      `SELECT id, status FROM notification_templates WHERE id = $1`,
      [id],
    )

    if (template.rows.length === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'NOTIFICATION_TEMPLATE_NOT_FOUND',
          message: 'Notification template not found',
        },
        404,
      )
    }

    if (template.rows[0]!.status !== 'draft') {
      throw new HttpException(
        {
          statusCode: 400,
          error: 'NOTIFICATION_TEMPLATE_ACTIVE',
          message: 'Active templates cannot be deleted. Unpublish first.',
        },
        400,
      )
    }

    await pool.query(`DELETE FROM notification_templates WHERE id = $1`, [id])

    this.logger.log(
      `Notification template deleted: id=${id} by ${actorUserId}`,
    )
  }
}

import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'

export type TemplateChannel = 'email' | 'sms' | 'in_app'
export type TemplateLocale = 'fa' | 'en'
export type TemplateStatus = 'draft' | 'active'

export interface NotificationTemplateResult {
  id: string
  eventKey: string
  channel: TemplateChannel
  locale: TemplateLocale
  subject: string | null
  bodyTemplate: string
  variables: string[]
  status: TemplateStatus
  isActive: boolean
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
  variables: string[]
}

export interface UpdateNotificationTemplateInput {
  subject?: string | null
  bodyTemplate?: string
  variables?: string[]
}

export interface PageTemplatesOptions {
  locale?: TemplateLocale
  channel?: TemplateChannel
  status?: TemplateStatus
}

/**
 * Notification template service (T-09.04.01).
 *
 * Manages the CRUD and publish lifecycle for notification templates.
 * Templates define the content of notifications sent through various
 * channels (email, SMS, in-app) for different events.
 *
 * Permission model: all methods require admin context (enforced in controller).
 */
@Injectable()
export class NotificationTemplateService {
  private readonly logger = new Logger(NotificationTemplateService.name)

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
      variables: (row.variables as string[]) ?? [],
      status: row.status as TemplateStatus,
      isActive: row.is_active as boolean,
      publishedAt: (row.published_at as Date) ?? null,
      createdBy: (row.created_by as string) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    }
  }

  /**
   * List notification templates with optional filtering.
   */
  async list(
    options?: PageTemplatesOptions,
  ): Promise<NotificationTemplateResult[]> {
    const pool = getDbPool()

    let sql = `SELECT id, event_key, channel, locale, subject, body_template,
                      variables, status, is_active, published_at, created_by,
                      created_at, updated_at
               FROM notification_templates
               WHERE 1=1`
    const params: unknown[] = []
    let paramIndex = 1

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

    sql += ' ORDER BY event_key ASC, channel ASC, locale ASC'

    const result = await pool.query(sql, params)
    return result.rows.map((row: Record<string, unknown>) => this.mapRow(row))
  }

  /**
   * Get a single notification template by id.
   */
  async getById(id: string): Promise<NotificationTemplateResult> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, event_key, channel, locale, subject, body_template,
              variables, status, is_active, published_at, created_by,
              created_at, updated_at
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
   * Create a new notification template as a draft.
   *
   * Validates that no template exists for the same event_key+channel+locale
   * combination — each combination may have only one template row.
   */
  async create(
    input: CreateNotificationTemplateInput,
    actorUserId: string,
  ): Promise<NotificationTemplateResult> {
    const pool = getDbPool()

    // Check uniqueness of event_key+channel+locale
    const existing = await pool.query(
      `SELECT id FROM notification_templates
       WHERE event_key = $1 AND channel = $2 AND locale = $3`,
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
        status, is_active, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'draft', false, $8, $9, $9)
       RETURNING id, event_key, channel, locale, subject, body_template,
                 variables, status, is_active, published_at, created_by,
                 created_at, updated_at`,
      [
        id,
        input.eventKey,
        input.channel,
        input.locale,
        input.subject ?? null,
        input.bodyTemplate,
        JSON.stringify(input.variables),
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
          error: 'NOTIFICATION_TEMPLATE_NOT_DRAFT',
          message: 'Only draft templates can be edited',
        },
        400,
      )
    }

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
      params.push(JSON.stringify(input.variables))
    }

    if (setClauses.length === 0) {
      // Nothing to update — return current state
      return this.getById(id)
    }

    setClauses.push(`created_by = $${paramIndex++}`)
    params.push(actorUserId)

    setClauses.push(`updated_at = $${paramIndex++}`)
    const now = new Date()
    params.push(now)

    params.push(id)

    const result = await pool.query<Record<string, unknown>>(
      `UPDATE notification_templates
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, event_key, channel, locale, subject, body_template,
                 variables, status, is_active, published_at, created_by,
                 created_at, updated_at`,
      params,
    )

    this.logger.log(
      `Notification template updated: id=${id} by ${actorUserId}`,
    )

    return this.mapRow(result.rows[0]!)
  }

  /**
   * Publish a notification template: promote it from draft to active.
   *
   * Sets status to 'active', is_active to true, records published_at.
   * If another template was active for the same event+channel+locale,
   * deactivates it first (this template replaces it).
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
          error: 'NOTIFICATION_TEMPLATE_ALREADY_ACTIVE',
          message: 'This template is already active',
        },
        400,
      )
    }

    const tpl = template.rows[0]!
    const now = new Date()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // Deactivate any currently active template for this event+channel+locale
      await client.query(
        `UPDATE notification_templates
         SET is_active = false, status = 'draft', updated_at = $1
         WHERE event_key = $2 AND channel = $3 AND locale = $4 AND is_active = true`,
        [now, tpl.event_key, tpl.channel, tpl.locale],
      )

      // Publish this template
      const result = await client.query<Record<string, unknown>>(
        `UPDATE notification_templates
         SET status = 'active',
             is_active = true,
             published_at = $1,
             created_by = $2,
             updated_at = $1
         WHERE id = $3
         RETURNING id, event_key, channel, locale, subject, body_template,
                   variables, status, is_active, published_at, created_by,
                   created_at, updated_at`,
        [now, actorUserId, id],
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
          }),
          uuidv7(),
          'admin',
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Notification template published: id=${id} event=${tpl.event_key} ` +
        `channel=${tpl.channel} locale=${tpl.locale} by ${actorUserId}`,
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
           created_by = $1,
           updated_at = $2
       WHERE id = $3
       RETURNING id, event_key, channel, locale, subject, body_template,
                 variables, status, is_active, published_at, created_by,
                 created_at, updated_at`,
      [actorUserId, now, id],
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
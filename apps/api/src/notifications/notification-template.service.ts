import {
  createEmailSender,
  createSmsSender,
  prepareSmsMessage,
} from '@barghsa/shared/notification-delivery';
import { Injectable, Logger, HttpException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { NotificationsService } from './notifications.service.js';
import { escapeHtml, renderTemplate, validateTemplate } from './template-engine.js';

export type TemplateChannel = 'email' | 'sms' | 'in_app';
export type TemplateLocale = 'fa' | 'en';
export type TemplateStatus = 'draft' | 'active' | 'archived';

/**
 * A single allow-listed template variable.
 *
 * `name` is the `{{name}}` placeholder used in the template body; `description`
 * is human-readable guidance for admin preview/authoring (T-05.04.01). For
 * backward compatibility, legacy storage as a plain string array is normalized
 * to this shape (description = null).
 */
export interface TemplateVariable {
  name: string;
  description: string | null;
}

/** Accepts either {@link TemplateVariable} objects or legacy plain string names. */
export type TemplateVariableInput =
  string | TemplateVariable | { name: string; description?: string | null | undefined };

export interface NotificationTemplateResult {
  id: string;
  eventKey: string;
  channel: TemplateChannel;
  locale: TemplateLocale;
  subject: string | null;
  bodyTemplate: string;
  variables: TemplateVariable[];
  status: TemplateStatus;
  isActive: boolean;
  version: number;
  publishedAt: Date | null;
  lastTestSentAt: Date | null;
  lastTestStatus: 'delivered' | 'failed' | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotificationTemplateInput {
  eventKey: string;
  channel: TemplateChannel;
  locale: TemplateLocale;
  subject?: string | null;
  bodyTemplate: string;
  variables: TemplateVariableInput[];
}

export interface UpdateNotificationTemplateInput {
  subject?: string | null;
  bodyTemplate?: string;
  variables?: TemplateVariableInput[];
}

export interface PageTemplatesOptions {
  locale?: TemplateLocale;
  channel?: TemplateChannel;
  status?: TemplateStatus;
}

export interface RenderedTemplate {
  subject: string | null;
  body: string;
  variables: TemplateVariable[];
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
 * Permission model: controllers enforce access; mutations hold current grants through commit.
 */
@Injectable()
export class NotificationTemplateService {
  private readonly logger = new Logger(NotificationTemplateService.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  private async mutate<T>(
    actorUserId: string,
    work: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actorUserId, 'admin:notifications:edit');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockFamily(client: PoolClient, eventKey: string, channel: string, locale: string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      JSON.stringify(['notification-template', eventKey, channel, locale]),
    ]);
  }

  private async lockTemplate(client: PoolClient, id: string): Promise<Record<string, unknown>> {
    const identity = await client.query<{ event_key: string; channel: string; locale: string }>(
      'SELECT event_key,channel,locale FROM notification_templates WHERE id=$1',
      [id]
    );
    const group = identity.rows[0];
    if (!group) throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_NOT_FOUND' }, 404);
    await this.lockFamily(client, group.event_key, group.channel, group.locale);
    const current = await client.query<Record<string, unknown>>(
      `SELECT ${this.SELECT_COLUMNS} FROM notification_templates WHERE id=$1 FOR UPDATE`,
      [id]
    );
    const row = current.rows[0];
    if (!row) throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_NOT_FOUND' }, 404);
    return row;
  }

  private async auditMutation(
    client: PoolClient,
    actorUserId: string,
    event: string,
    row: Record<string, unknown>
  ) {
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
       VALUES($1,$2,$3,$4::jsonb,$5,NOW())`,
      [
        uuidv7(),
        actorUserId,
        event,
        JSON.stringify({
          templateId: row.id,
          eventKey: row.event_key,
          channel: row.channel,
          locale: row.locale,
          version: row.version,
          status: row.status,
        }),
        uuidv7(),
      ]
    );
  }

  /**
   * Normalize a list of variable inputs (either `{name, description}` objects or
   * legacy plain `string` names) into canonical {@link TemplateVariable} shape.
   * Backward compatible: existing rows stored as `string[]` map to
   * `{ name, description: null }`. Empty/whitespace names are dropped.
   */
  static normalizeVariables(input: TemplateVariableInput[] | null | undefined): TemplateVariable[] {
    const out: TemplateVariable[] = [];
    const seen = new Set<string>();
    for (const raw of input ?? []) {
      const obj = typeof raw === 'string' ? null : raw;
      const name = (obj ? obj.name : (raw as string)).trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        description: !obj ? null : obj.description?.trim() || null,
      });
    }
    return out;
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
        row.variables as TemplateVariableInput[]
      ),
      status: row.status as TemplateStatus,
      isActive: row.is_active as boolean,
      version: (row.version as number) ?? 1,
      publishedAt: (row.published_at as Date) ?? null,
      lastTestSentAt: (row.last_test_sent_at as Date) ?? null,
      lastTestStatus: (row.last_test_status as 'delivered' | 'failed') ?? null,
      createdBy: (row.created_by as string) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  private readonly SELECT_COLUMNS = `id, event_key, channel, locale, subject,
      body_template, variables, status, is_active, version, published_at,
      last_test_sent_at, last_test_status, created_by, created_at, updated_at`;

  /**
   * Escape a string for safe HTML/text output, preventing injection of
   * arbitrary markup/script via template variable values.
   * Delegates to the shared template engine (T-05.04.02).
   */
  escapeHtml(value: string): string {
    return escapeHtml(value);
  }

  /**
   * Validate that every `{{placeholder}}` in the body is (a) well-formed and
   * (b) present in the template's allow-listed `variables`. Rejects unknown
   * variables and unclosed placeholders with a 400. Delegates to the shared
   * template engine (T-05.04.02).
   */
  validateVariables(bodyTemplate: string, variables: TemplateVariableInput[]): void {
    const allowed = NotificationTemplateService.normalizeVariables(variables).map((v) => v.name);
    const problems = validateTemplate(bodyTemplate, allowed);

    // A well-formed, allow-listed body yields no problems.
    for (const p of problems) {
      const err = p.variable ? `Variable "${p.variable}" in template: ${p.message}` : p.message;
      throw new HttpException(
        {
          statusCode: 400,
          error: 'NOTIFICATION_TEMPLATE_INVALID_VARIABLES',
          message: err,
        },
        400
      );
    }
  }

  /**
   * Render a template body/subject, substituting allow-listed variables with
   * escaped values. Unknown placeholders render as their escaped literal.
   *
   * Delegates to the shared template engine (T-05.04.02), which enforces the
   * allow-list via safe, own-enumerable path resolution — so template
   * variables can never expose internal JS object state or secrets
   * (e.g. `__proto__`/`constructor`/`prototype`).
   */
  render(
    template: string,
    variables: TemplateVariableInput[],
    data?: Record<string, unknown>,
    escapeValues = true
  ): string {
    const allowed = NotificationTemplateService.normalizeVariables(variables).map((v) => v.name);
    return renderTemplate(template, allowed, { data, escapeValues }).output;
  }

  /**
   * Build neutral sample values for every allow-listed variable, used by
   * preview and test-send.
   */
  buildSampleData(variables: TemplateVariableInput[]): Record<string, string> {
    const data: Record<string, string> = {};
    for (const v of NotificationTemplateService.normalizeVariables(variables)) {
      const key = v.name.trim();
      if (key)
        data[key] = key
          .replace(/([A-Z])/g, ' $1')
          .trim()
          .toLowerCase();
    }
    return data;
  }

  /**
   * List notification templates with optional filtering. Archived (historical)
   * versions are excluded by default so the admin list shows current work.
   */
  async list(options?: PageTemplatesOptions): Promise<NotificationTemplateResult[]> {
    const pool = getDbPool();

    let sql = `SELECT ${this.SELECT_COLUMNS}
               FROM notification_templates
               WHERE 1=1`;
    const params: unknown[] = [];
    let paramIndex = 1;

    if (!options?.status) {
      sql += ` AND status != 'archived'`;
    }
    if (options?.locale) {
      sql += ` AND locale = $${paramIndex++}`;
      params.push(options.locale);
    }
    if (options?.channel) {
      sql += ` AND channel = $${paramIndex++}`;
      params.push(options.channel);
    }
    if (options?.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(options.status);
    }

    sql += ' ORDER BY event_key ASC, channel ASC, locale ASC, version DESC';

    const result = await pool.query(sql, params);
    return result.rows.map((row: Record<string, unknown>) => this.mapRow(row));
  }

  /**
   * Get a single notification template by id.
   */
  async getById(id: string): Promise<NotificationTemplateResult> {
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT ${this.SELECT_COLUMNS}
       FROM notification_templates
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new HttpException(
        {
          statusCode: 404,
          error: 'NOTIFICATION_TEMPLATE_NOT_FOUND',
          message: 'Notification template not found',
        },
        404
      );
    }

    return this.mapRow(result.rows[0]!);
  }

  /**
   * Create a new notification template as a draft (version 1).
   *
   * Rejects creation when an active or draft template already exists for the
   * same event_key+channel+locale (archived history does not block a new draft).
   */
  async create(
    input: CreateNotificationTemplateInput,
    actorUserId: string
  ): Promise<NotificationTemplateResult> {
    return this.mutate(actorUserId, async (client) => {
      this.validateVariables(input.bodyTemplate, input.variables ?? []);
      const variables = NotificationTemplateService.normalizeVariables(input.variables);
      await this.lockFamily(client, input.eventKey, input.channel, input.locale);
      const existing = await client.query(
        `SELECT 1 FROM notification_templates WHERE event_key=$1 AND channel=$2 AND locale=$3
         AND status='draft' AND published_at IS NULL LIMIT 1`,
        [input.eventKey, input.channel, input.locale]
      );
      if (existing.rows.length)
        throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_EXISTS' }, 409);
      const nextVersion = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(version),0)+1 AS version FROM notification_templates
         WHERE event_key=$1 AND channel=$2 AND locale=$3`,
        [input.eventKey, input.channel, input.locale]
      );
      const result = await client.query<Record<string, unknown>>(
        `INSERT INTO notification_templates(id,event_key,channel,locale,subject,body_template,variables,
         status,is_active,version,created_by,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'draft',false,$9,$8,NOW(),NOW())
         RETURNING ${this.SELECT_COLUMNS}`,
        [
          uuidv7(),
          input.eventKey,
          input.channel,
          input.locale,
          input.subject ?? null,
          input.bodyTemplate,
          JSON.stringify(variables),
          actorUserId,
          nextVersion.rows[0]!.version,
        ]
      );
      const row = result.rows[0]!;
      await this.auditMutation(client, actorUserId, 'notification_template_created', row);
      return this.mapRow(row);
    });
  }

  /**
   * Update a draft notification template.
   * Only draft templates can be edited.
   */
  async update(
    id: string,
    input: UpdateNotificationTemplateInput,
    actorUserId: string
  ): Promise<NotificationTemplateResult> {
    return this.mutate(actorUserId, async (client) => {
      const template = await this.lockTemplate(client, id);
      if (template.status !== 'draft' || template.published_at !== null)
        throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_NOT_DRAFT' }, 400);
      const nextBody = input.bodyTemplate ?? (template.body_template as string);
      const variables = input.variables ?? (template.variables as TemplateVariableInput[]);
      this.validateVariables(nextBody, variables);
      const normalized = NotificationTemplateService.normalizeVariables(variables);
      const fields: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown, cast = '') => {
        params.push(value);
        fields.push(`${column}=$${params.length}${cast}`);
      };
      if (input.subject !== undefined) set('subject', input.subject);
      if (input.bodyTemplate !== undefined) set('body_template', input.bodyTemplate);
      if (input.variables !== undefined) set('variables', JSON.stringify(normalized), '::jsonb');
      if (!fields.length) return this.mapRow(template);
      params.push(id);
      const result = await client.query<Record<string, unknown>>(
        `UPDATE notification_templates SET ${fields.join(',')},updated_at=NOW()
         WHERE id=$${params.length} RETURNING ${this.SELECT_COLUMNS}`,
        params
      );
      const row = result.rows[0]!;
      await this.auditMutation(client, actorUserId, 'notification_template_updated', row);
      return this.mapRow(row);
    });
  }

  /**
   * Render a preview of a template using sample (or caller-provided) data.
   */
  async preview(id: string, sampleData?: Record<string, string>): Promise<RenderedTemplate> {
    const tpl = await this.getById(id);
    const data = sampleData ?? this.buildSampleData(tpl.variables);
    return {
      subject: tpl.subject !== null ? this.render(tpl.subject, tpl.variables, data, false) : null,
      body: this.render(tpl.bodyTemplate, tpl.variables, data, tpl.channel === 'email'),
      variables: tpl.variables,
    };
  }

  /**
   * Render a template body with arbitrary allow-listed sample data (used by
   * the frontend preview pane before a draft is saved).
   */
  async previewFromBody(
    bodyTemplate: string,
    variables: TemplateVariableInput[],
    sampleData?: Record<string, string>
  ): Promise<RenderedTemplate> {
    const normalized = NotificationTemplateService.normalizeVariables(variables);
    this.validateVariables(bodyTemplate, normalized);
    const data = sampleData ?? this.buildSampleData(normalized);
    return {
      subject: null,
      body: this.render(bodyTemplate, normalized, data),
      variables: normalized,
    };
  }

  /** Test the selected channel; never substitute inbox delivery for email/SMS. */
  async testSend(
    id: string,
    actorUserId: string,
    options?: { destination?: string }
  ): Promise<{
    ok: boolean;
    destination: TemplateChannel;
    lastTestStatus: 'delivered' | 'failed';
  }> {
    const outcome = await this.mutate(actorUserId, async (client) => {
      const tpl = this.mapRow(await this.lockTemplate(client, id));
      const data = this.buildSampleData(tpl.variables);
      const renderedBody = this.render(
        tpl.bodyTemplate,
        tpl.variables,
        data,
        tpl.channel === 'email'
      );
      const renderedSubject =
        tpl.subject !== null ? this.render(tpl.subject, tpl.variables, data, false) : null;
      const destination = options?.destination?.trim() || null;
      await this.assertAllowedTestDestination(client, actorUserId, destination);
      let providerRef: string | undefined;
      let deliveryError: { cause: unknown } | undefined;
      try {
        const pool = client;
        if (tpl.channel === 'email') {
          if (!destination)
            throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_DESTINATION_REQUIRED' }, 400);
          try {
            providerRef = await createEmailSender(pool)({
              destination,
              subject: renderedSubject ?? `Test: ${tpl.eventKey}`,
              html: renderedBody,
              idempotencyKey: `template-test:${id}:${uuidv7()}`,
            });
          } catch {
            throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_DELIVERY_FAILED' }, 503);
          }
        } else if (tpl.channel === 'sms') {
          if (!destination)
            throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_DESTINATION_REQUIRED' }, 400);
          try {
            const message = await prepareSmsMessage(
              pool,
              destination,
              tpl.eventKey,
              tpl.variables.map((item) => item.name),
              data
            );
            providerRef = await createSmsSender(pool)(message);
          } catch {
            throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_DELIVERY_FAILED' }, 503);
          }
        } else {
          if (destination)
            throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_CHANNEL_MISMATCH' }, 400);
          await this.notificationsService.create(
            {
              userId: actorUserId,
              type: 'general',
              title: renderedSubject ?? `Test: ${tpl.eventKey}`,
              body: renderedBody,
            },
            client
          );
        }
      } catch (error) {
        deliveryError = { cause: error };
      }
      const status = deliveryError ? 'failed' : 'delivered';
      await client.query(
        `UPDATE notification_templates SET last_test_sent_at=NOW(),last_test_status=$2,updated_at=NOW() WHERE id=$1`,
        [id, status]
      );
      await this.writeTestAudit(client, tpl, actorUserId, status, providerRef);
      return { deliveryError, channel: tpl.channel };
    });
    if (outcome.deliveryError) throw outcome.deliveryError.cause;
    this.logger.log(`Notification template test-sent: id=${id} by ${actorUserId}`);
    return { ok: true, destination: outcome.channel, lastTestStatus: 'delivered' };
  }

  /**
   * Pure decision rule for whether a test-send destination is permitted
   * (T-05.04.04). Exported for unit testing without a DB.
   *
   * A destination is allowed when it matches one of the acting admin's own
   * verified contacts, or when it is present in the dev/test-only allow-list
   * (`TEST_SEND_ALLOWLIST`) honored only in explicit development or test environments.
   */
  static isDestinationAllowed(
    actorContacts: Array<string | null | undefined>,
    destination: string | null | undefined,
    env?: { NODE_ENV?: string; TEST_SEND_ALLOWLIST?: string }
  ): boolean {
    if (!destination || !destination.trim()) return true; // in-app default
    const target = destination.trim().toLowerCase();

    const own = new Set<string>();
    for (const c of actorContacts) {
      if (c) own.add(c.trim().toLowerCase());
    }
    if (own.has(target)) return true;

    const nodeEnv = env?.NODE_ENV;
    if (nodeEnv === 'test' || nodeEnv === 'development') {
      const allowList = (env?.TEST_SEND_ALLOWLIST ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (allowList.includes(target)) return true;
    }
    return false;
  }

  /**
   * Validate that a test-send destination is permitted: it must be the acting
   * admin's own verified contact, or an allow-listed dev/test address that is
   * only honored outside production. A null/empty destination means the admin
   * accepted the in-app default (their own inbox), which is always allowed.
   */
  private async assertAllowedTestDestination(
    client: PoolClient,
    actorUserId: string,
    destination: string | null
  ): Promise<void> {
    if (!destination) return;

    const user = await client.query<{
      username: string;
      email: string | null;
      mobile: string | null;
    }>(
      `SELECT username, email, mobile FROM users WHERE user_id = $1 AND disabled_at IS NULL AND activation_token IS NULL`,
      [actorUserId]
    );
    const actor = user.rows[0];

    const contacts = actor ? [actor.username, actor.email, actor.mobile] : [];
    const env: { NODE_ENV?: string; TEST_SEND_ALLOWLIST?: string } = {};
    if (process.env['NODE_ENV'] !== undefined) env.NODE_ENV = process.env['NODE_ENV'];
    if (process.env['TEST_SEND_ALLOWLIST'] !== undefined) {
      env.TEST_SEND_ALLOWLIST = process.env['TEST_SEND_ALLOWLIST'];
    }
    if (NotificationTemplateService.isDestinationAllowed(contacts, destination, env)) {
      return;
    }

    throw new HttpException(
      {
        statusCode: 403,
        error: 'NOTIFICATION_TEMPLATE_TEST_DESTINATION_FORBIDDEN',
        message:
          'Test-send destination must be your own verified contact or an allow-listed test address',
      },
      403
    );
  }

  /** Append a test-send audit record (no customer data — template only). */
  private async writeTestAudit(
    client: PoolClient,
    template: NotificationTemplateResult,
    actorUserId: string,
    status: 'delivered' | 'failed',
    providerRef?: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (id,user_id,event,metadata,correlation_id,created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,NOW())`,
      [
        uuidv7(),
        actorUserId,
        'notification_template_test_sent',
        JSON.stringify({
          templateId: template.id,
          eventKey: template.eventKey,
          version: template.version,
          testedUpdatedAt: template.updatedAt,
          destinationKind: template.channel,
          providerRef: providerRef ?? null,
          deliveredTo: status === 'delivered' ? template.channel : null,
          status,
          isTest: true,
        }),
        uuidv7(),
      ]
    );
  }

  /**
   * Publish a draft template: promote it to active.
   *
   * Versioning: the previously-active template for the same
   * event+channel+locale is archived (is_active=false, status='archived') and
   * this template becomes the new active version. Legacy drafts with a reused
   * version number advance beyond existing history before their first publish.
   */
  async publish(id: string, actorUserId: string): Promise<NotificationTemplateResult> {
    return this.mutate(actorUserId, async (client) => {
      const template = await this.lockTemplate(client, id);
      if (template.status !== 'draft' || template.published_at !== null)
        throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_NOT_DRAFT' }, 400);
      await client.query(
        `UPDATE notification_templates SET is_active=false,status='archived',updated_at=NOW()
         WHERE event_key=$1 AND channel=$2 AND locale=$3 AND is_active=true`,
        [template.event_key, template.channel, template.locale]
      );
      const version = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(version),0)+1 AS version FROM notification_templates
         WHERE event_key=$1 AND channel=$2 AND locale=$3 AND id<>$4`,
        [template.event_key, template.channel, template.locale, id]
      );
      const result = await client.query<Record<string, unknown>>(
        `UPDATE notification_templates SET status='active',is_active=true,version=$1,
         published_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING ${this.SELECT_COLUMNS}`,
        [Math.max(Number(template.version), version.rows[0]!.version), id]
      );
      const row = result.rows[0]!;
      await this.auditMutation(client, actorUserId, 'notification_template_published', row);
      return this.mapRow(row);
    });
  }

  /**
   * Unpublish an active template while retaining its immutable published content.
   */
  async unpublish(id: string, actorUserId: string): Promise<NotificationTemplateResult> {
    return this.mutate(actorUserId, async (client) => {
      const template = await this.lockTemplate(client, id);
      if (template.status !== 'active')
        throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_NOT_ACTIVE' }, 400);
      const result = await client.query<Record<string, unknown>>(
        `UPDATE notification_templates SET status='archived',is_active=false,updated_at=NOW()
         WHERE id=$1 RETURNING ${this.SELECT_COLUMNS}`,
        [id]
      );
      const row = result.rows[0]!;
      await this.auditMutation(client, actorUserId, 'notification_template_unpublished', row);
      return this.mapRow(row);
    });
  }

  /**
   * Delete a draft notification template.
   */
  async delete(id: string, actorUserId: string): Promise<void> {
    return this.mutate(actorUserId, async (client) => {
      const template = await this.lockTemplate(client, id);
      if (template.status !== 'draft' || template.published_at !== null)
        throw new HttpException({ error: 'NOTIFICATION_TEMPLATE_ACTIVE' }, 400);
      await client.query('DELETE FROM notification_templates WHERE id=$1', [id]);
      await this.auditMutation(client, actorUserId, 'notification_template_deleted', template);
    });
  }
}

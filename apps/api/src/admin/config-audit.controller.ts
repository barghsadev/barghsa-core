import { Controller, Get, Header, HttpException, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import { createHash } from 'node:crypto';
import {
  AUTHORIZATION_AUDIT_ACTION,
  AUTHORIZATION_AUDIT_ACTOR,
  CONFIG_AUDIT_FIELDS,
  CONFIG_AUDIT_ID,
  isConfigAuditTimestamp,
  isConfigAuditScope,
  isConfigAuditValue,
  isAuthorizationAuditDay,
  type ConfigAuditScope,
  type ConfigAuditEntry,
  type ConfigAuditSnapshot,
} from '@barghsa/shared/admin';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';

const permissions = {
  branding: 'admin:branding:read',
  otp: 'admin:config:read',
  'service-response-targets': 'admin:service-targets:edit',
  authorization: '*',
} as const;
const scopes = Object.keys(CONFIG_AUDIT_FIELDS);
const snapshotSchema = {
  type: 'object' as const,
  required: ['recorded', 'value'],
  properties: {
    recorded: { type: 'boolean' as const },
    value: {
      anyOf: [
        { type: 'string' as const, nullable: true, maxLength: 2048 },
        { type: 'number' as const },
        { type: 'boolean' as const },
      ],
    },
  },
};
export function parseAuditCursor(raw: unknown, scope: ConfigAuditScope, criteria?: string) {
  if (raw === undefined) return null;
  try {
    if (typeof raw !== 'string' || !/^[\w-]{1,512}$/.test(raw)) throw new Error('Invalid cursor');
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      !decoded ||
      decoded.scope !== scope ||
      decoded.criteria !== criteria ||
      !isConfigAuditTimestamp(decoded.at) ||
      typeof decoded.id !== 'string' ||
      !CONFIG_AUDIT_ID.test(decoded.id)
    )
      throw new Error('Invalid cursor');
    return { at: decoded.at as string, id: decoded.id as string };
  } catch {
    throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
  }
}

function authorizationFilters(query: Record<string, unknown>) {
  const { actor, action, from, through, eventId } = query;
  if (
    (actor !== undefined &&
      (typeof actor !== 'string' || !AUTHORIZATION_AUDIT_ACTOR.test(actor))) ||
    (action !== undefined &&
      (typeof action !== 'string' || !AUTHORIZATION_AUDIT_ACTION.test(action))) ||
    (from !== undefined && !isAuthorizationAuditDay(from)) ||
    (through !== undefined && !isAuthorizationAuditDay(through)) ||
    (typeof from === 'string' && typeof through === 'string' && from > through) ||
    (eventId !== undefined &&
      (typeof eventId !== 'string' ||
        !CONFIG_AUDIT_ID.test(eventId) ||
        [actor, action, from, through, query.cursor].some((field) => field !== undefined)))
  )
    throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
  const filters = [actor ?? null, action ?? null, from ?? null, through ?? null];
  return {
    parameters: [...filters, eventId ?? null],
    criteria: filters.some((filter) => filter !== null)
      ? createHash('sha256').update(JSON.stringify(filters)).digest('base64url')
      : undefined,
  };
}
function record(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return record(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}
function value(source: Record<string, unknown>, field: string): ConfigAuditSnapshot {
  const raw = Object.hasOwn(source, field) ? source[field] : undefined;
  return isConfigAuditValue(raw)
    ? { recorded: true, value: raw }
    : { recorded: false, value: null };
}
export function auditChanges(scope: ConfigAuditScope, previous: unknown, current: unknown) {
  const old = record(previous),
    next = record(current);
  const changes = CONFIG_AUDIT_FIELDS[scope].flatMap((field) => {
    const before = value(old, field),
      after = value(next, field);
    return before.recorded === after.recorded && before.value === after.value
      ? []
      : [{ field, previous: before, current: after }];
  });
  return {
    changes,
    detailsAvailable: CONFIG_AUDIT_FIELDS[scope].some((field) => value(next, field).recorded),
  };
}

@ApiTags('Admin · Settings')
@UseGuards(SessionAuthGuard)
@Controller('api/admin/config/audit')
export class ConfigAuditController {
  @Get()
  @ApiOperation({ summary: 'Read safe settings or authorization audit records for one scope' })
  @ApiQuery({ name: 'scope', enum: scopes })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({
    name: 'actor',
    required: false,
    description: 'Authorization denials only. Exact actor ID.',
  })
  @ApiQuery({
    name: 'action',
    required: false,
    description: 'Authorization denials only. Exact action.',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Authorization denials only. First UTC date (YYYY-MM-DD).',
  })
  @ApiQuery({
    name: 'through',
    required: false,
    description: 'Authorization denials only. Last UTC date (YYYY-MM-DD).',
  })
  @ApiQuery({
    name: 'eventId',
    required: false,
    description: 'Authorization denials only. Read one event without filters or pagination.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['scope', 'items', 'nextCursor'],
      properties: {
        scope: { type: 'string', enum: scopes },
        nextCursor: { type: 'string', nullable: true, maxLength: 512 },
        items: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            required: [
              'id',
              'actorId',
              'createdAt',
              'event',
              'version',
              'detailsAvailable',
              'changes',
            ],
            properties: {
              id: { type: 'string', format: 'uuid' },
              actorId: { type: 'string', nullable: true, maxLength: 128 },
              createdAt: { type: 'string', format: 'date-time' },
              event: {
                type: 'string',
                enum: ['updated', 'draft_created', 'activated', 'authorization_denied'],
              },
              version: { type: 'integer', nullable: true, minimum: 1, maximum: 2147483647 },
              detailsAvailable: { type: 'boolean' },
              changes: {
                type: 'array',
                maxItems: 18,
                items: {
                  type: 'object',
                  required: ['field', 'previous', 'current'],
                  properties: {
                    field: {
                      type: 'string',
                      enum: [...new Set(Object.values(CONFIG_AUDIT_FIELDS).flat())],
                    },
                    previous: snapshotSchema,
                    current: snapshotSchema,
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  @Header('Cache-Control', 'private, no-store')
  async list(@Query() query: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const { scope, cursor: rawCursor } = query;
    if (!isConfigAuditScope(scope))
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    const acceptedKeys =
      scope === 'authorization'
        ? ['scope', 'cursor', 'actor', 'action', 'from', 'through', 'eventId']
        : ['scope', 'cursor'];
    if (Object.keys(query).some((key) => !acceptedKeys.includes(key)))
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    if (!hasStaffPermission(req, permissions[scope]))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    const authorization = scope === 'authorization' ? authorizationFilters(query) : null;
    const cursor = parseAuditCursor(rawCursor, scope, authorization?.criteria);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, req.session.userId, permissions[scope]);
      await requireCurrentSession(client, req.session);
      const result = await client.query<{
        id: string;
        user_id: string | null;
        event: string;
        at: string;
        metadata: unknown;
        config: unknown;
      }>(
        authorization
          ? `SELECT id,actor_id AS user_id,'authorization_denied' AS event,NULL AS config,
          jsonb_build_object('current',jsonb_build_object('resource',resource,'action',action,
            'reason',reason,'correlationId',correlation_id)) AS metadata,
          to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
         FROM authorization_denials
         WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::uuid))
           AND ($3::text IS NULL OR actor_id=$3)
           AND ($4::text IS NULL OR action=$4)
           AND ($5::date IS NULL OR created_at>=($5::date::timestamp AT TIME ZONE 'UTC'))
           AND ($6::date IS NULL OR created_at<(($6::date+1)::timestamp AT TIME ZONE 'UTC'))
           AND ($7::uuid IS NULL OR id=$7)
         ORDER BY created_at DESC,id DESC LIMIT 51`
          : `SELECT a.id,a.user_id,a.event,safe.data AS metadata,b.config,
          to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
         FROM audit_log a CROSS JOIN LATERAL
           (SELECT CASE WHEN a.metadata IS JSON OBJECT THEN a.metadata::jsonb ELSE '{}'::jsonb END AS data) safe
         LEFT JOIN brand_config b ON $1='branding' AND b.id::text=safe.data->>'configId'
         WHERE (($1='branding' AND a.event IN ('branding.draft_created','branding.activated'))
           OR ($1='otp' AND a.event='change_recorded' AND safe.data->>'entity'='auth_otp')
           OR ($1='service-response-targets' AND a.event='config_change' AND safe.data->>'key'='admin.service_response_targets'))
           AND ($2::timestamptz IS NULL OR (a.created_at,a.id)<($2::timestamptz,$3::text))
         ORDER BY a.created_at DESC,a.id DESC LIMIT 51`,
        authorization
          ? [cursor?.at ?? null, cursor?.id ?? null, ...authorization.parameters]
          : [scope, cursor?.at ?? null, cursor?.id ?? null]
      );
      const rows = result.rows.slice(0, 50);
      const items: ConfigAuditEntry[] = rows.map((row) => {
        const meta = record(row.metadata);
        const current =
          scope === 'service-response-targets' ? meta.newValue : (meta.current ?? row.config);
        const previous = scope === 'service-response-targets' ? meta.previousValue : meta.previous;
        const version = scope === 'otp' ? record(meta.current).version : meta.version;
        return {
          id: row.id,
          actorId: row.user_id && row.user_id.length <= 128 ? row.user_id : null,
          createdAt: row.at,
          event:
            scope === 'authorization'
              ? 'authorization_denied'
              : row.event === 'branding.activated'
                ? 'activated'
                : row.event === 'branding.draft_created'
                  ? 'draft_created'
                  : 'updated',
          version:
            typeof version === 'number' &&
            Number.isSafeInteger(version) &&
            version > 0 &&
            version <= 2147483647
              ? version
              : null,
          ...auditChanges(scope, previous, current),
        };
      });
      await requireCurrentSession(client, req.session);
      await client.query('COMMIT');
      const last = rows.at(-1);
      return {
        scope,
        items,
        nextCursor:
          result.rows.length > 50 && last
            ? Buffer.from(
                JSON.stringify({
                  scope,
                  at: last.at,
                  id: last.id,
                  ...(authorization?.criteria ? { criteria: authorization.criteria } : {}),
                })
              ).toString('base64url')
            : null,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

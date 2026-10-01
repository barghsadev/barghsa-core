import { Controller, Get, Header, HttpException, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import {
  CONFIG_AUDIT_FIELDS,
  CONFIG_AUDIT_ID,
  isConfigAuditTimestamp,
  isConfigAuditScope,
  isConfigAuditValue,
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
} as const;
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
export function parseAuditCursor(raw: unknown, scope: ConfigAuditScope) {
  if (raw === undefined) return null;
  try {
    if (typeof raw !== 'string' || !/^[\w-]{1,512}$/.test(raw)) throw new Error('Invalid cursor');
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      !decoded ||
      decoded.scope !== scope ||
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
  @ApiOperation({ summary: 'Read safe field changes for one authorized settings scope' })
  @ApiQuery({ name: 'scope', enum: ['branding', 'otp', 'service-response-targets'] })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['scope', 'items', 'nextCursor'],
      properties: {
        scope: { type: 'string', enum: ['branding', 'otp', 'service-response-targets'] },
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
              event: { type: 'string', enum: ['updated', 'draft_created', 'activated'] },
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
    if (Object.keys(query).some((key) => key !== 'scope' && key !== 'cursor'))
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    if (!isConfigAuditScope(scope))
      throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    if (!hasStaffPermission(req, permissions[scope]))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    const cursor = parseAuditCursor(rawCursor, scope);
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
        `SELECT a.id,a.user_id,a.event,safe.data AS metadata,b.config,
          to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
         FROM audit_log a CROSS JOIN LATERAL
           (SELECT CASE WHEN a.metadata IS JSON OBJECT THEN a.metadata::jsonb ELSE '{}'::jsonb END AS data) safe
         LEFT JOIN brand_config b ON $1='branding' AND b.id::text=safe.data->>'configId'
         WHERE (($1='branding' AND a.event IN ('branding.draft_created','branding.activated'))
           OR ($1='otp' AND a.event='change_recorded' AND safe.data->>'entity'='auth_otp')
           OR ($1='service-response-targets' AND a.event='config_change' AND safe.data->>'key'='admin.service_response_targets'))
           AND ($2::timestamptz IS NULL OR (a.created_at,a.id)<($2::timestamptz,$3::text))
         ORDER BY a.created_at DESC,a.id DESC LIMIT 51`,
        [scope, cursor?.at ?? null, cursor?.id ?? null]
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
            row.event === 'branding.activated'
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
            ? Buffer.from(JSON.stringify({ scope, at: last.at, id: last.id })).toString('base64url')
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

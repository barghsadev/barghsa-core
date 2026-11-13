import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Put,
  Req,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import {
  defaultOperationalRetention,
  isOperationalRetention,
  operationalRetentionFields,
  type OperationalRetentionView,
} from '@barghsa/shared/admin';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { withStaffReadAuthority } from './staff-read-authority.js';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';

const key = 'observability.operational_retention';
const writePermission = 'admin:config:write';
const policyFields = Object.fromEntries(
  operationalRetentionFields.map(({ key: field, min, max }) => [
    field,
    z.number().int().min(min).max(max),
  ])
) as Record<(typeof operationalRetentionFields)[number]['key'], z.ZodNumber>;
const proposal = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2147483646),
  policy: z.strictObject(policyFields),
});
const viewSchema: SchemaObject = {
  type: 'object',
  required: ['version', 'policy', 'canEdit'],
  properties: {
    version: { type: 'integer', minimum: 0 },
    canEdit: { type: 'boolean' },
    policy: {
      type: 'object',
      additionalProperties: false,
      required: operationalRetentionFields.map(({ key: field }) => field),
      properties: Object.fromEntries(
        operationalRetentionFields.map(({ key: field, min, max }) => [
          field,
          { type: 'integer', minimum: min, maximum: max },
        ])
      ),
    },
  },
};

async function readPolicy(client: PoolClient): Promise<Omit<OperationalRetentionView, 'canEdit'>> {
  const {
    rows: [saved],
  } = await client.query<{ version: number; value: unknown }>(
    'SELECT version,value FROM app_config WHERE key=$1',
    [key]
  );
  if (!saved) return { version: 0, policy: defaultOperationalRetention };
  if (!isOperationalRetention(saved.value))
    throw new ServiceUnavailableException('Stored operational retention policy is invalid');
  return { version: saved.version, policy: saved.value };
}

@ApiTags('Admin operational retention')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/config/operational-retention')
export class OperationalRetentionController {
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Get the saved operational retention policy' })
  @ApiOkResponse({ schema: viewSchema })
  get(@Req() req: AuthenticatedRequest): Promise<OperationalRetentionView> {
    const canEdit = hasStaffPermission(req, writePermission);
    return withStaffReadAuthority(
      req.session,
      canEdit ? writePermission : 'admin:config:read',
      async (client) => ({ ...(await readPolicy(client)), canEdit })
    );
  }

  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Download the saved monitoring policy for infrastructure application' })
  @ApiOkResponse({ schema: viewSchema })
  async export(@Req() req: AuthenticatedRequest) {
    const policy = await this.get(req);
    return new StreamableFile(Buffer.from(JSON.stringify(policy, null, 2) + '\n'), {
      type: 'application/json',
      disposition: 'attachment; filename="operational-retention.json"',
    });
  }

  @Put()
  @Header('Cache-Control', 'private, no-store')
  @RequiresStepUp()
  @UseGuards(StepUpGuard)
  @ApiOperation({ summary: 'Save an audited, versioned operational retention policy' })
  @ApiOkResponse({ schema: viewSchema })
  @ApiZodBody(proposal)
  async save(
    @Req() req: AuthenticatedRequest,
    @Body() raw: unknown
  ): Promise<OperationalRetentionView> {
    if (!hasStaffPermission(req, writePermission)) throw new ForbiddenException();
    const parsed = proposal.safeParse(raw);
    if (!parsed.success) {
      throw new InputFieldException(
        parsed.error.issues.map((issue) =>
          issue.path[0] === 'policy' && typeof issue.path[1] === 'string' ? issue.path[1] : 'policy'
        )
      );
    }
    const { expectedVersion, policy } = parsed.data;
    if (!isOperationalRetention(policy)) throw new InputFieldException(['priorityTracesDays']);

    const client = await getDbPool().connect();
    const actor = req.session;
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, writePermission);
      await requireSessionStepUp(client, actor);
      const context = await client.query(
        "SELECT current_setting('barghsa.actor_context',true) AS context"
      );
      if (context.rows[0]?.context !== 'staff') throw new ForbiddenException();
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const previous = await readPolicy(client);
      if (previous.version !== expectedVersion)
        throw new ConflictException('Operational retention changed');
      const next = { version: expectedVersion + 1, policy };
      await client.query(
        `INSERT INTO app_config(key,value,version,updated_at) VALUES($1,$2::jsonb,$3,clock_timestamp())
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at`,
        [key, JSON.stringify(policy), next.version]
      );
      await client.query(
        "UPDATE config_version SET version=version+1,updated_at=NOW() WHERE id='global'"
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
         VALUES($1,$2,'config_change',$3::jsonb,$4,$5,clock_timestamp())`,
        [
          randomUUID(),
          actor.userId,
          JSON.stringify({ key, previous, next, sessionId: actor.sessionId }),
          correlationIdStorage.getStore() ?? randomUUID(),
          req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        ]
      );
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return { ...next, canEdit: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

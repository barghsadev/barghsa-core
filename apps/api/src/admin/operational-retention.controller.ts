import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import {
  defaultOperationalRetention,
  isOperationalRetention,
  operationalRetentionFields,
  type OperationalRetention,
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
import {
  activateRecoveryDraft,
  activationHistoryQuery,
  configActivations,
  stageRecoveryDraft,
} from './config-activation-history.js';

const key = 'observability.operational_retention';
const writePermission = 'admin:config:write';
const draftEvent = 'operational_retention.rollback_draft';
const draftMetadata = z.object({
  sourceId: z.string().uuid(),
  sourceVersion: z.number().int().positive(),
  config: z.custom<OperationalRetention>(isOperationalRetention),
});
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
const revisionSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'version', 'config'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    version: { type: 'integer', minimum: 1 },
    config: viewSchema.properties!.policy!,
  },
};
const draftSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'baseVersion', 'sourceId', 'sourceVersion', 'config'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    baseVersion: { type: 'integer', minimum: 1 },
    sourceId: { type: 'string', format: 'uuid' },
    sourceVersion: { type: 'integer', minimum: 1 },
    config: viewSchema.properties!.policy!,
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

async function readDraft(client: PoolClient, baseVersion: number) {
  const {
    rows: [row],
  } = await client.query<{ id: string; data: unknown }>(
    `SELECT id,data FROM audit_log CROSS JOIN LATERAL (
       SELECT CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS data
     ) safe
     WHERE event=$1 AND data->>'key'=$2 AND data->>'baseVersion'=$3::text
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [draftEvent, key, baseVersion]
  );
  if (!row) return null;
  const parsed = draftMetadata.safeParse(row.data);
  if (!parsed.success || parsed.data.sourceVersion >= baseVersion) return null;
  return { id: row.id, baseVersion, ...parsed.data };
}

async function recordAudit(
  req: AuthenticatedRequest,
  client: PoolClient,
  event: string,
  data: object,
  id = randomUUID()
) {
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,clock_timestamp())`,
    [
      id,
      req.session.userId,
      event,
      JSON.stringify({ key, ...data, sessionId: req.session.sessionId }),
      correlationIdStorage.getStore() ?? randomUUID(),
      req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    ]
  );
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

  @Get('rollback-history')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Review superseded monitoring retention revisions and the current recovery draft',
  })
  @ApiQuery({ name: 'beforeVersion', required: false, schema: { type: 'integer', minimum: 1 } })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['baseVersion', 'items', 'nextBeforeVersion', 'draft'],
      properties: {
        baseVersion: { type: 'integer', minimum: 0 },
        items: { type: 'array', items: revisionSchema },
        nextBeforeVersion: { type: 'integer', minimum: 1, nullable: true },
        draft: { ...draftSchema, nullable: true },
      },
    },
  })
  history(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = activationHistoryQuery.safeParse(query);
    if (!parsed.success) throw new InputFieldException(['beforeVersion']);
    return withStaffReadAuthority(req.session, writePermission, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [key]);
      const { version: baseVersion } = await readPolicy(client);
      const { items, nextBeforeVersion } = await configActivations(
        client,
        key,
        'policy',
        isOperationalRetention,
        {
          beforeVersion: Math.min(baseVersion, parsed.data.beforeVersion ?? baseVersion),
        }
      );
      return {
        baseVersion,
        items: items.map(({ id, version, value }) => ({ id, version, config: value })),
        nextBeforeVersion,
        draft: await readDraft(client, baseVersion),
      };
    });
  }

  @Post('rollback-draft')
  @Header('Cache-Control', 'private, no-store')
  @RequiresStepUp()
  @UseGuards(StepUpGuard)
  @ApiOperation({
    summary: 'Prepare a recovery draft from a superseded monitoring retention revision',
  })
  @ApiZodBody(stageRecoveryDraft)
  @ApiCreatedResponse({ schema: draftSchema })
  stage(@Req() req: AuthenticatedRequest, @Body() raw: unknown) {
    const parsed = stageRecoveryDraft.safeParse(raw);
    if (!parsed.success) throw new InputFieldException(['sourceId', 'expectedVersion']);
    return this.write(req, parsed.data.expectedVersion, async (client, previous) => {
      const {
        items: [source],
      } = await configActivations(client, key, 'policy', isOperationalRetention, {
        beforeVersion: previous.version,
        sourceId: parsed.data.sourceId,
      });
      if (!source) throw new NotFoundException('Operational retention revision not found');
      const current = await readDraft(client, previous.version);
      if (current?.sourceId === source.id) return current;
      const draft = {
        id: randomUUID(),
        baseVersion: previous.version,
        sourceId: source.id,
        sourceVersion: source.version,
        config: source.value,
      };
      await recordAudit(req, client, draftEvent, draft, draft.id);
      return draft;
    });
  }

  @Post('rollback-activate')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @RequiresStepUp()
  @UseGuards(StepUpGuard)
  @ApiOperation({
    summary: 'Activate the reviewed monitoring retention recovery draft as a new revision',
  })
  @ApiZodBody(activateRecoveryDraft)
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['version', 'config', 'draftId'],
      properties: {
        version: { type: 'integer', minimum: 1 },
        config: viewSchema.properties!.policy!,
        draftId: { type: 'string', format: 'uuid' },
      },
    },
  })
  activate(@Req() req: AuthenticatedRequest, @Body() raw: unknown) {
    const parsed = activateRecoveryDraft.safeParse(raw);
    if (!parsed.success) throw new InputFieldException(['draftId', 'expectedVersion']);
    return this.write(req, parsed.data.expectedVersion, async (client, previous) => {
      const draft = await readDraft(client, previous.version);
      if (!draft || draft.id !== parsed.data.draftId)
        throw new ConflictException('Operational retention recovery draft changed');
      const next = await this.persist(req, client, previous, draft.config, draft);
      return { version: next.version, config: next.policy, draftId: draft.id };
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
    return this.write(req, expectedVersion, async (client, previous) => ({
      ...(await this.persist(req, client, previous, policy)),
      canEdit: true,
    }));
  }

  private async write<T>(
    req: AuthenticatedRequest,
    expectedVersion: number,
    operation: (
      client: PoolClient,
      previous: Omit<OperationalRetentionView, 'canEdit'>
    ) => Promise<T>
  ): Promise<T> {
    if (!hasStaffPermission(req, writePermission)) throw new ForbiddenException();
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
      if (previous.version !== expectedVersion || previous.version >= 2_147_483_647)
        throw new ConflictException('Operational retention changed');
      const result = await operation(client, previous);
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async persist(
    req: AuthenticatedRequest,
    client: PoolClient,
    previous: Omit<OperationalRetentionView, 'canEdit'>,
    policy: OperationalRetention,
    restored?: { id: string; sourceId: string; sourceVersion: number }
  ) {
    const next = { version: previous.version + 1, policy };
    await client.query(
      `INSERT INTO app_config(key,value,version,updated_at) VALUES($1,$2::jsonb,$3,clock_timestamp())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at`,
      [key, JSON.stringify(policy), next.version]
    );
    await client.query(
      "UPDATE config_version SET version=version+1,updated_at=NOW() WHERE id='global'"
    );
    await recordAudit(req, client, 'config_change', {
      action: 'activate',
      previous,
      next,
      ...(restored && {
        restoredFrom: { id: restored.sourceId, version: restored.sourceVersion },
        draftId: restored.id,
      }),
    });
    return next;
  }
}

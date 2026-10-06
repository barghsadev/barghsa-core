import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool, SOLAR_CONSTRUCTION_MILESTONES } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import type { FinancialReviewSnapshot } from '@barghsa/shared/finance';
import { literalSearchPattern } from '@barghsa/shared/validation';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { readSolarProgress } from './solar-progress-projection.js';
import type { SolarProgressCommand } from './solar-progress.validation.js';

type Actor = AuthenticatedRequest['session'];
type SavedReview = FinancialReviewSnapshot<{
  command: SolarProgressCommand;
  [key: string]: unknown;
}>;
@Injectable()
export class SolarProgressService {
  private readonly reviews = new ReviewSnapshotService();

  private async transaction<T>(
    actor: Actor,
    permission: string,
    work: (client: PoolClient) => Promise<T>,
    stepUp = false
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, permission);
      await requireCurrentSession(client, actor);
      const session = (
        await client.query('SELECT operating_context FROM sessions WHERE session_id=$1', [
          actor.sessionId,
        ])
      ).rows[0];
      if (session?.operating_context !== 'staff')
        throw new ForbiddenException('Use the staff context');
      if (stepUp) await requireSessionStepUp(client, actor);
      const value = await work(client);
      if (stepUp) await requireSessionStepUp(client, actor);
      else await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      const failure =
        error && typeof error === 'object'
          ? (error as { code?: string; constraint?: string })
          : null;
      if (['55P03', '40P01', '40001'].includes(failure?.code ?? ''))
        throw new ConflictException('Construction facts are busy; refresh and retry');
      if (failure?.code === '23505' && failure.constraint === 'solar_progress_operation_key')
        throw new ConflictException('Operation was already used');
      throw error;
    } finally {
      client.release();
    }
  }

  private async canWrite(client: PoolClient, actor: Actor) {
    const admin = (
      await client.query('SELECT is_admin FROM users WHERE user_id=$1', [actor.userId])
    ).rows[0]?.is_admin;
    const roles = (
      await client.query(
        'SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id WHERE ur.user_id=$1 FOR SHARE OF ur,r',
        [actor.userId]
      )
    ).rows;
    const grants = resolveStaffPermissions(roles.map((row) => row.permissions));
    return admin === true || grants.includes('*') || grants.includes('orders:write');
  }

  async list(actor: Actor, before: string | undefined, q: string) {
    return this.transaction(actor, 'orders:read', async (client) => {
      const pattern = literalSearchPattern(q);
      const cursor = before
        ? (
            await client.query(
              `SELECT r.submitted_at FROM solar_construction_requests r JOIN contracts c ON c.id=r.contract_id AND c.profile_id=r.profile_id AND c.service_type='solar' WHERE r.id=$1 AND r.status='contract_created' AND ($2::text IS NULL OR r.id::text ILIKE $2 OR c.contract_number::text ILIKE $2)`,
              [before, pattern]
            )
          ).rows[0]
        : null;
      if (before && !cursor) throw new NotFoundException('Construction cursor not found');
      const result = await client.query(
        `SELECT r.id AS "requestId",r.contract_id AS "contractId",c.contract_number::text AS "contractNumber",r.submitted_at AS "submittedAt",c.state AS "contractState",e.stage,COALESCE(e.revision,0) AS revision
        FROM solar_construction_requests r JOIN contracts c ON c.id=r.contract_id AND c.profile_id=r.profile_id AND c.service_type='solar'
        LEFT JOIN LATERAL (SELECT stage,revision FROM solar_construction_progress_events WHERE request_id=r.id ORDER BY revision DESC LIMIT 1) e ON true
        WHERE r.status='contract_created' AND ($1::timestamptz IS NULL OR (r.submitted_at,r.id)<($1::timestamptz,$2::uuid))
          AND ($3::text IS NULL OR r.id::text ILIKE $3 OR c.contract_number::text ILIKE $3)
        ORDER BY r.submitted_at DESC,r.id DESC LIMIT 51`,
        [cursor?.submitted_at ?? null, before ?? null, pattern]
      );
      const items = result.rows
        .slice(0, 50)
        .map((row) => ({ ...row, submittedAt: (row.submittedAt as Date).toISOString() }));
      return {
        items,
        nextBefore: result.rows.length > 50 ? String(items.at(-1)!.requestId) : null,
      };
    });
  }

  async detail(actor: Actor, id: string) {
    return this.transaction(actor, 'orders:read', async (client) => {
      if (
        !(await client.query('SELECT 1 FROM solar_construction_requests WHERE id=$1', [id])).rows
          .length
      )
        throw new NotFoundException('Solar request not found');
      const progress = await readSolarProgress(client, id);
      return { ...progress, canRecord: progress.eligible && (await this.canWrite(client, actor)) };
    });
  }

  private async snapshot(
    client: PoolClient,
    actor: Actor,
    id: string,
    command: SolarProgressCommand
  ) {
    const initial = (
      await client.query<{ contract_id: string | null; profile_id: string }>(
        'SELECT profile_id,contract_id FROM solar_construction_requests WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!initial) throw new NotFoundException('Solar request not found');
    // Financial lifecycle commands lock the profile before the contract. Fail on contention instead of creating a reverse lock wait.
    await client.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE NOWAIT', [
      initial.profile_id,
    ]);
    const contract = initial.contract_id
      ? (
          await client.query(
            'SELECT id,profile_id,state,current_version_id,service_type FROM contracts WHERE id=$1 FOR SHARE NOWAIT',
            [initial.contract_id]
          )
        ).rows[0]
      : null;
    const request = (
      await client.query<{
        profile_id: string;
        contract_id: string | null;
        status: string;
        user_id: string;
        archived: boolean;
        profile_status: string;
      }>(
        `SELECT r.profile_id,r.contract_id,r.status,p.user_id,p.archived,p.status AS profile_status FROM solar_construction_requests r JOIN profiles p ON p.id=r.profile_id WHERE r.id=$1 FOR UPDATE OF r NOWAIT`,
        [id]
      )
    ).rows[0]!;
    if (request.contract_id !== initial.contract_id || request.profile_id !== initial.profile_id)
      throw new ConflictException('The linked contract changed');
    const existing = (
      await client.query<{ request_id: string; actor_user_id: string | null; review: SavedReview }>(
        'SELECT request_id,actor_user_id,review FROM solar_construction_progress_events WHERE operation_id=$1',
        [command.operationId]
      )
    ).rows[0];
    const scope = {
      action: 'solar.construction.record',
      profileId: request.profile_id,
      resourceId: id,
    };
    if (existing) {
      if (
        existing.request_id !== id ||
        existing.actor_user_id !== actor.userId ||
        this.reviews.create(existing.review.scope, { ...existing.review.data, command }).hash !==
          existing.review.hash
      )
        throw new ConflictException('Operation was already used');
      this.reviews.assertConfirmed(existing.review, existing.review.hash);
      if (
        existing.review.scope.action !== scope.action ||
        existing.review.scope.profileId !== scope.profileId ||
        existing.review.scope.resourceId !== scope.resourceId
      )
        throw new ConflictException('Operation scope changed');
      return { request, review: existing.review, replayed: true };
    }
    const progress = await readSolarProgress(client, id);
    if (
      !progress.eligible ||
      !contract ||
      contract.profile_id !== request.profile_id ||
      contract.service_type !== 'solar'
    )
      throw new ConflictException(
        'An active signed solar contract and confirmed postal originals are required'
      );
    if (
      command.expectedRevision !== progress.revision ||
      command.stage !== SOLAR_CONSTRUCTION_MILESTONES[progress.revision]
    )
      throw new ConflictException('Construction progress changed; review the next milestone');
    const review = this.reviews.create(scope, {
      command,
      contractId: request.contract_id,
      contractState: contract.state,
      versionId: contract.current_version_id,
      revision: progress.revision,
      previousStage: progress.events.at(-1)?.stage ?? null,
      customerVisible: true,
      collectsPayment: false,
      changesContract: false,
    });
    return { request, review, replayed: false };
  }

  async review(actor: Actor, id: string, command: SolarProgressCommand) {
    return this.transaction(
      actor,
      'orders:write',
      async (client) => (await this.snapshot(client, actor, id, command)).review
    );
  }

  async record(
    actor: Actor,
    id: string,
    command: SolarProgressCommand,
    expectedHash: string,
    ip: string
  ) {
    return this.transaction(
      actor,
      'orders:write',
      async (client) => {
        const { request, review, replayed } = await this.snapshot(client, actor, id, command);
        this.reviews.assertConfirmed(review, expectedHash);
        if (!replayed) {
          await client.query(
            `INSERT INTO solar_construction_progress_events(id,request_id,contract_id,stage,revision,operation_id,actor_user_id,note,review) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
            [
              uuidv7(),
              id,
              request.contract_id,
              command.stage,
              command.expectedRevision + 1,
              command.operationId,
              actor.userId,
              command.note,
              JSON.stringify(review),
            ]
          );
          await client.query(
            `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,'solar.construction.recorded',$3::jsonb,$4,$5)`,
            [
              uuidv7(),
              actor.userId,
              JSON.stringify({
                entity: 'solar_construction_progress',
                entityId: id,
                fromState: review.data.previousStage,
                toState: command.stage,
                reason: command.note,
                actor: actor.userId,
                requestId: id,
                profileId: request.profile_id,
                stage: command.stage,
                revision: command.expectedRevision + 1,
                operationId: command.operationId,
                note: command.note,
                review,
              }),
              correlationIdStorage.getStore() ?? uuidv7(),
              ip,
            ]
          );
          const labels = {
            in_progress: { en: 'Work started', fa: 'شروع اجرای نیروگاه' },
            delivered: { en: 'Equipment delivered', fa: 'تحویل تجهیزات' },
            installed: { en: 'Installation recorded', fa: 'ثبت نصب نیروگاه' },
          }[command.stage];
          await new NotificationsService().create(
            {
              userId: request.user_id,
              profileId: request.profile_id,
              operatingContext: 'customer',
              type: 'general',
              title: labels.en,
              body: command.note,
              link: `/solar/requests/${id}`,
              localizedContent: {
                fa: { title: labels.fa, body: command.note },
                en: { title: labels.en, body: command.note },
              },
            },
            client
          );
        }
        const progress = await readSolarProgress(client, id);
        return { ...progress, canRecord: progress.eligible };
      },
      true
    );
  }
}

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { idempotentMutation } from '../database/idempotency.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import type { SolarPostalTrackingCommand } from './solar-postal-tracking.validation.js';

type Actor = AuthenticatedRequest['session'];
interface TrackingRow {
  requestId: string;
  profileId: string;
  userId: string;
  requestStatus: string;
  postalStatus: string;
  courier: string | null;
  trackingNumber: string | null;
  sendDate: string | null;
  receiptImageId: string | null;
  estimatedArrivalDate: string | null;
  trackingUrl: string | null;
  note: string | null;
  revision: number;
  recordedAt: Date | null;
  eligible: boolean;
}
@Injectable()
export class SolarPostalTrackingService {
  private readonly reviews = new ReviewSnapshotService();

  private async authorize(client: PoolClient, actor: Actor, write: boolean, stepUp: boolean) {
    await requireStaffMutationPermission(
      client,
      actor.userId,
      write ? 'orders:write' : 'orders:read'
    );
    if (stepUp) await requireSessionStepUp(client, actor);
    else await requireCurrentSession(client, actor);
    const session = (
      await client.query<{ operating_context: string }>(
        'SELECT operating_context FROM sessions WHERE session_id=$1 AND user_id=$2 FOR SHARE',
        [actor.sessionId, actor.userId]
      )
    ).rows[0];
    if (session?.operating_context !== 'staff')
      throw new ForbiddenException('Staff context required');
  }

  private async current(client: PoolClient, requestId: string, write: boolean) {
    const hint = (
      await client.query<{ profile_id: string }>(
        'SELECT profile_id FROM solar_construction_requests WHERE id=$1',
        [requestId]
      )
    ).rows[0];
    if (!hint) throw new NotFoundException('Solar request not found');
    const profile = (
      await client.query<{ archived: boolean; status: string; user_id: string }>(
        'SELECT archived,status,user_id FROM profiles WHERE id=$1 FOR SHARE NOWAIT',
        [hint.profile_id]
      )
    ).rows[0];
    const request = (
      await client.query<{ profile_id: string; status: string }>(
        `SELECT profile_id,status FROM solar_construction_requests WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'} NOWAIT`,
        [requestId]
      )
    ).rows[0];
    if (!profile || !request || request.profile_id !== hint.profile_id)
      throw new ConflictException('Request changed');
    const postal = (
      await client.query<
        Omit<TrackingRow, 'requestId' | 'profileId' | 'userId' | 'requestStatus' | 'eligible'>
      >(
        `SELECT status AS "postalStatus",courier,tracking_number AS "trackingNumber",
        (send_date AT TIME ZONE 'UTC')::date::text AS "sendDate",receipt_image_id AS "receiptImageId",
        estimated_arrival_date::text AS "estimatedArrivalDate",tracking_url AS "trackingUrl",
        tracking_note AS note,tracking_revision AS revision,tracking_recorded_at AS "recordedAt"
       FROM solar_construction_postal WHERE request_id=$1 FOR ${write ? 'UPDATE' : 'SHARE'} NOWAIT`,
        [requestId]
      )
    ).rows[0];
    if (!postal) throw new NotFoundException('Solar postal record not found');
    return {
      ...postal,
      requestId,
      profileId: hint.profile_id,
      userId: profile.user_id,
      requestStatus: request.status,
      eligible:
        !profile.archived &&
        !['DRAFT', 'SUSPENDED'].includes(profile.status) &&
        request.status === 'waiting_for_postal_submission' &&
        postal.postalStatus === 'shipped',
    } satisfies TrackingRow;
  }

  private present({ userId: _userId, eligible: _eligible, ...row }: TrackingRow) {
    return { ...row, recordedAt: row.recordedAt?.toISOString() ?? null };
  }

  private snapshot(row: TrackingRow, input: SolarPostalTrackingCommand) {
    if (!row.eligible) throw new ConflictException('No eligible shipment is awaiting arrival');
    if (row.revision !== input.expectedRevision)
      throw new ConflictException('Postal tracking changed');
    if (input.estimatedArrivalDate && (!row.sendDate || input.estimatedArrivalDate < row.sendDate))
      throw new ConflictException('Arrival estimate precedes shipment');
    if (
      row.estimatedArrivalDate === input.estimatedArrivalDate &&
      row.trackingUrl === input.trackingUrl &&
      row.note === input.note
    )
      throw new ConflictException('Postal tracking is unchanged');
    return this.reviews.create(
      { action: 'solar.postal.tracking', profileId: row.profileId, resourceId: row.requestId },
      {
        ...this.present(row),
        estimatedArrivalDate: input.estimatedArrivalDate,
        trackingUrl: input.trackingUrl,
        note: input.note,
        previousEstimatedArrivalDate: row.estimatedArrivalDate,
        previousTrackingUrl: row.trackingUrl,
        previousNote: row.note,
        expectedRevision: input.expectedRevision,
        customerVisible: true,
        confirmsReceipt: false,
        createsContract: false,
        collectsPayment: false,
      }
    );
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['55P03', '40P01', '40001'].includes(String(error.code))
      )
        throw new ConflictException('Postal tracking is busy; retry');
      throw error;
    } finally {
      client.release();
    }
  }

  read(actor: Actor, requestId: string) {
    return this.transaction(async (client) => {
      await this.authorize(client, actor, false, false);
      const row = await this.current(client, requestId, false);
      let canEdit = row.eligible;
      if (canEdit) {
        try {
          await requireStaffMutationPermission(client, actor.userId, 'orders:write');
        } catch (error) {
          if (error instanceof HttpException && error.getStatus() === 403) canEdit = false;
          else throw error;
        }
      }
      await this.authorize(client, actor, false, false);
      return { ...this.present(row), canEdit };
    });
  }

  review(actor: Actor, requestId: string, input: SolarPostalTrackingCommand) {
    return this.transaction(async (client) => {
      await this.authorize(client, actor, true, false);
      const review = this.snapshot(await this.current(client, requestId, false), input);
      await this.authorize(client, actor, true, false);
      return review;
    });
  }

  record(
    actor: Actor,
    requestId: string,
    input: SolarPostalTrackingCommand & { expectedReviewHash: string },
    ip: string
  ) {
    return this.transaction(async (client) => {
      await this.authorize(client, actor, true, true);
      const row = await this.current(client, requestId, true);
      const result = await idempotentMutation(
        client,
        'solar_postal_tracking',
        { ...input, requestId },
        actor,
        async () => {
          const review = this.snapshot(row, input);
          this.reviews.assertConfirmed(review, input.expectedReviewHash);
          await client.query("SELECT set_config('barghsa.solar_postal_tracking',$1,true)", [
            requestId,
          ]);
          await client.query(
            'UPDATE solar_construction_postal SET estimated_arrival_date=$2,tracking_url=$3,tracking_note=$4 WHERE request_id=$1',
            [requestId, input.estimatedArrivalDate, input.trackingUrl, input.note]
          );
          await client.query(
            'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
            [
              uuidv7(),
              actor.userId,
              'solar.postal.tracking_updated',
              JSON.stringify({
                entity: 'solar_postal_tracking',
                entityId: requestId,
                fromState: {
                  revision: row.revision,
                  estimatedArrivalDate: row.estimatedArrivalDate,
                  trackingUrl: row.trackingUrl,
                  note: row.note,
                },
                toState: {
                  revision: row.revision + 1,
                  estimatedArrivalDate: input.estimatedArrivalDate,
                  trackingUrl: input.trackingUrl,
                  note: input.note,
                },
                reason: input.note,
                actor: actor.userId,
                profileId: row.profileId,
                postalFromState: row.postalStatus,
                postalToState: row.postalStatus,
                requestId,
                financialReview: review,
              }),
              uuidv7(),
              ip,
            ]
          );
          await new NotificationsService().create(
            {
              userId: row.userId,
              profileId: row.profileId,
              operatingContext: 'customer',
              type: 'general',
              title: 'Solar shipment tracking updated',
              body: input.note,
              link: `/solar/requests/${requestId}`,
              localizedContent: {
                en: { title: 'Solar shipment tracking updated', body: input.note },
                fa: { title: 'اطلاعات پیگیری مدارک پستی به‌روز شد', body: input.note },
              },
            },
            client
          );
          return this.present(await this.current(client, requestId, true));
        }
      );
      await this.authorize(client, actor, true, true);
      return result;
    });
  }
}

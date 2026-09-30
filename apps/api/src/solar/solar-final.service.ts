import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

type Actor = AuthenticatedRequest['session'];
type FinalDecision = 'approve' | 'reject' | 'close-no-contract';
async function audit(
  client: PoolClient,
  actor: Actor,
  event: string,
  requestId: string,
  previousStatus: string,
  status: string,
  reason: string | null,
  ip: string,
  financialReview?: object
) {
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
     VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
    [
      uuidv7(),
      actor.userId,
      event,
      JSON.stringify({ requestId, previousStatus, status, reason, financialReview }),
      uuidv7(),
      ip,
    ]
  );
}

@Injectable()
export class SolarFinalService {
  private readonly reviews = new ReviewSnapshotService();

  private async decisionSnapshot(
    client: PoolClient,
    requestId: string,
    decision: FinalDecision,
    reason: string | undefined,
    lock: 'SHARE' | 'UPDATE'
  ) {
    const decisionReason = reason?.trim();
    if (decision !== 'approve' && !decisionReason)
      throw new BadRequestException('Reason is required');
    const request = (
      await client.query<{
        profile_id: string;
        user_id: string;
        status: string;
        contract_id: string | null;
      }>(
        `SELECT r.profile_id,r.status,r.contract_id,p.user_id
         FROM solar_construction_requests r JOIN profiles p ON p.id=r.profile_id
         WHERE r.id=$1 FOR ${lock} OF r`,
        [requestId]
      )
    ).rows[0];
    if (!request) throw new NotFoundException('Solar request not found');
    if (
      (decision !== 'close-no-contract' && request.status !== 'final_review') ||
      (decision === 'close-no-contract' &&
        !['final_review', 'approved'].includes(request.status)) ||
      request.contract_id
    )
      throw new ConflictException('Request is not ready for final decision');
    const postal = (
      await client.query<{ status: string; tracking_number: string | null }>(
        'SELECT status,tracking_number FROM solar_construction_postal WHERE request_id=$1 FOR SHARE',
        [requestId]
      )
    ).rows[0];
    if (decision !== 'close-no-contract' && postal?.status !== 'received')
      throw new ConflictException('Postal receipt is not confirmed');
    const outcome =
      decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'cancelled';
    const review = this.reviews.create(
      {
        action: `solar.final.${decision}`,
        profileId: request.profile_id,
        resourceId: requestId,
      },
      {
        requestId,
        currentStatus: request.status,
        postalStatus: postal?.status ?? null,
        trackingNumber: postal?.tracking_number ?? null,
        contractId: request.contract_id,
        decision,
        reason: decision === 'approve' ? null : decisionReason,
        outcome,
        createsContract: false,
        createsInvoice: false,
        supportPath: decision === 'approve' ? null : '/tickets',
      }
    );
    return { request, review, outcome, decisionReason };
  }

  async reviewDecision(
    actor: Actor,
    requestId: string,
    decision: FinalDecision,
    reason: string | undefined
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(
        client,
        actor.userId,
        decision === 'close-no-contract' ? 'contracts:write' : 'orders:write'
      );
      const { review } = await this.decisionSnapshot(client, requestId, decision, reason, 'SHARE');
      await client.query('COMMIT');
      return review;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async beginReview(actor: Actor, requestId: string, ip: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'orders:write');
      await requireSessionStepUp(client, actor);
      const request = (
        await client.query<{ profile_id: string; user_id: string; status: string }>(
          `SELECT r.profile_id,r.status,p.user_id FROM solar_construction_requests r
           JOIN profiles p ON p.id=r.profile_id WHERE r.id=$1 FOR UPDATE OF r`,
          [requestId]
        )
      ).rows[0];
      if (!request) throw new NotFoundException('Solar request not found');
      if (request.status !== 'postal_documents_received')
        throw new ConflictException('Postal originals must be received first');
      if (
        !(
          await client.query(
            "SELECT 1 FROM solar_construction_postal WHERE request_id=$1 AND status='received' FOR SHARE",
            [requestId]
          )
        ).rows.length
      )
        throw new ConflictException('Postal receipt is not confirmed');
      await client.query(
        "UPDATE solar_construction_requests SET status='final_review',updated_at=NOW() WHERE id=$1",
        [requestId]
      );
      await new NotificationsService().create(
        {
          userId: request.user_id,
          profileId: request.profile_id,
          operatingContext: 'customer',
          type: 'general',
          title: 'Solar request in final review',
          localizedContent: {
            fa: {
              title: 'بررسی نهایی درخواست نیروگاه خورشیدی',
              body: 'مدارک پستی دریافت شد و درخواست شما در بررسی نهایی کارشناسان است.',
            },
            en: {
              title: 'Solar request in final review',
              body: 'Your postal documents were received. Staff are reviewing your request.',
            },
          },
        },
        client
      );
      await audit(
        client,
        actor,
        'solar.final.review_started',
        requestId,
        request.status,
        'final_review',
        null,
        ip
      );
      await client.query('COMMIT');
      return { status: 'final_review' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async decide(
    actor: Actor,
    requestId: string,
    decision: FinalDecision,
    reason: string | undefined,
    expectedReviewHash: string,
    ip: string
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(
        client,
        actor.userId,
        decision === 'close-no-contract' ? 'contracts:write' : 'orders:write'
      );
      await requireSessionStepUp(client, actor);
      const {
        request,
        review,
        outcome: status,
        decisionReason,
      } = await this.decisionSnapshot(client, requestId, decision, reason, 'UPDATE');
      this.reviews.assertConfirmed(review, expectedReviewHash);
      await client.query(
        `UPDATE solar_construction_requests SET status=$2,status_reason=$3,support_path=$4,
         updated_at=NOW() WHERE id=$1`,
        [
          requestId,
          status,
          decision === 'approve' ? null : decisionReason,
          decision === 'approve' ? null : '/tickets',
        ]
      );
      await new NotificationsService().create(
        {
          userId: request.user_id,
          profileId: request.profile_id,
          operatingContext: 'customer',
          type: 'general',
          title:
            decision === 'approve'
              ? 'Solar request approved'
              : decision === 'reject'
                ? 'Solar request rejected'
                : 'Solar request closed',
          localizedContent: {
            fa: {
              title: 'درخواست نیروگاه خورشیدی',
              body:
                decision === 'approve'
                  ? 'درخواست شما تأیید شد و قرارداد توسط کارشناس آماده می‌شود.'
                  : decision === 'reject'
                    ? `درخواست شما رد شد. دلیل: ${decisionReason}`
                    : `درخواست بدون قرارداد بسته شد: ${decisionReason}`,
            },
            en: {
              title: 'Solar request',
              body:
                decision === 'approve'
                  ? 'Your request was approved. Staff will prepare the contract.'
                  : decision === 'reject'
                    ? `Your request was rejected. Reason: ${decisionReason}`
                    : `The request was closed without a contract: ${decisionReason}`,
            },
          },
        },
        client
      );
      await audit(
        client,
        actor,
        `solar.final.${decision}`,
        requestId,
        request.status,
        status,
        decisionReason ?? null,
        ip,
        review
      );
      await client.query('COMMIT');
      return { status };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

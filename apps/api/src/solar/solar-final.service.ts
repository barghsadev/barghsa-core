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
import type { AuthenticatedRequest } from '../session/session.guard.js';

type Actor = AuthenticatedRequest['session'];
async function audit(
  client: PoolClient,
  actor: Actor,
  event: string,
  requestId: string,
  previousStatus: string,
  status: string,
  reason: string | null,
  ip: string
) {
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
     VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
    [
      uuidv7(),
      actor.userId,
      event,
      JSON.stringify({ requestId, previousStatus, status, reason }),
      uuidv7(),
      ip,
    ]
  );
}

@Injectable()
export class SolarFinalService {
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
    decision: 'approve' | 'reject' | 'close-no-contract',
    reason: string | undefined,
    ip: string
  ) {
    const decisionReason = reason?.trim();
    if (decision !== 'approve' && !decisionReason)
      throw new BadRequestException('Reason is required');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(
        client,
        actor.userId,
        decision === 'close-no-contract' ? 'contracts:write' : 'orders:write'
      );
      await requireSessionStepUp(client, actor);
      const request = (
        await client.query<{
          profile_id: string;
          user_id: string;
          status: string;
        }>(
          `SELECT r.profile_id,r.status,p.user_id FROM solar_construction_requests r
         JOIN profiles p ON p.id=r.profile_id WHERE r.id=$1 FOR UPDATE OF r`,
          [requestId]
        )
      ).rows[0];
      if (!request) throw new NotFoundException('Solar request not found');
      if (decision === 'approve' && request.status !== 'final_review')
        throw new ConflictException('Final review must begin before approval');
      if (decision === 'reject' && request.status !== 'final_review')
        throw new ConflictException('Request is not ready for final rejection');
      if (
        decision !== 'close-no-contract' &&
        !(
          await client.query(
            "SELECT 1 FROM solar_construction_postal WHERE request_id=$1 AND status='received' FOR SHARE",
            [requestId]
          )
        ).rows.length
      )
        throw new ConflictException('Postal receipt is not confirmed');
      if (
        decision === 'close-no-contract' &&
        !['final_review', 'approved'].includes(request.status)
      )
        throw new ConflictException('Request is not ready for final decision');
      const status =
        decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'cancelled';
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
        ip
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

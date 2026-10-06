import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  contractIdempotency,
  staffContractFinancialReview,
  staffContractMutation,
  type ContractActor,
} from '../contract/contract-transactions.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

export type DraftTerminalAction = 'reject' | 'cancel';
const unlinked = `NOT EXISTS(SELECT 1 FROM contracts WHERE order_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM electricity_contracts WHERE order_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM invoices WHERE order_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM gift_code_redemptions WHERE order_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM refund_obligations WHERE order_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM electricity_order_submissions WHERE order_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE type='payment' AND lower(ref_id)=e.id::text)
 AND e.submitted_at IS NULL AND e.submitted_by IS NULL`;
interface RawDraft {
  id: string;
  profile_id: string;
  order_profile_id: string;
  mode: string;
  status: string;
  order_status: string;
  order_type: string;
  has_gift: boolean;
  unlinked: boolean;
  fingerprint_source: string;
  updated_at: Date;
}
@Injectable()
export class ElectricityRawDraftService {
  constructor(private readonly reviews: ReviewSnapshotService) {}
  private async staffContext(client: PoolClient, actor: ContractActor) {
    const row = (
      await client.query<{ operating_context: string }>(
        'SELECT operating_context FROM sessions WHERE session_id=$1 AND user_id=$2',
        [actor.sessionId, actor.userId]
      )
    ).rows[0];
    if (row?.operating_context !== 'staff') throw new ForbiddenException('Staff context required');
  }
  async queue(actor: ContractActor, after?: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      try {
        await requireStaffMutationPermission(client, actor.userId, 'contracts:read');
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() !== 403) throw error;
        await requireStaffMutationPermission(client, actor.userId, 'contracts:write');
      }
      await requireCurrentSession(client, actor);
      await this.staffContext(client, actor);
      const anchor = after
        ? (
            await client.query<{ created_at: Date }>(
              'SELECT created_at FROM electricity_orders WHERE id=$1',
              [after]
            )
          ).rows[0]
        : null;
      if (after && !anchor) throw new NotFoundException('Draft cursor not found');
      const rows = (
        await client.query<{
          id: string;
          profile_id: string;
          mode: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `SELECT e.id,e.profile_id,e.mode,e.created_at,e.updated_at FROM electricity_orders e JOIN orders o ON o.id=e.id JOIN profiles p ON p.id=e.profile_id WHERE e.status='draft' AND o.status='PENDING' AND o.order_type='electricity' AND o.profile_id=e.profile_id AND o.gift_code_id IS NULL AND NOT p.archived AND ${unlinked} AND ($1::timestamptz IS NULL OR (e.created_at,e.id)>($1::timestamptz,$2::uuid)) ORDER BY e.created_at,e.id LIMIT 51`,
          [anchor?.created_at ?? null, after ?? null]
        )
      ).rows;
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return {
        drafts: rows.slice(0, 50).map((r) => ({
          orderId: r.id,
          profileId: r.profile_id,
          mode: r.mode,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        })),
        nextAfter: rows.length > 50 ? rows[49]!.id : null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async owner(id: string) {
    const row = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM electricity_orders WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Draft order not found');
    return row.profile_id;
  }
  private async current(
    client: PoolClient,
    id: string,
    lock: 'SHARE' | 'UPDATE',
    expectedProfileId: string
  ) {
    const row = (
      await client.query<RawDraft>(
        `SELECT e.id,e.profile_id,o.profile_id AS order_profile_id,e.mode,e.status,o.status AS order_status,o.order_type,o.gift_code_id IS NOT NULL AS has_gift,(${unlinked}) AS unlinked,(to_jsonb(e)||jsonb_build_object('order',to_jsonb(o),'lines',COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM electricity_order_lines l WHERE l.order_id=e.id),'[]'::jsonb)))::text AS fingerprint_source,e.updated_at FROM electricity_orders e JOIN orders o ON o.id=e.id WHERE e.id=$1 FOR ${lock} OF e,o`,
        [id]
      )
    ).rows[0];
    if (
      !row ||
      row.profile_id !== expectedProfileId ||
      row.profile_id !== row.order_profile_id ||
      row.order_type !== 'electricity'
    )
      throw new NotFoundException('Draft order not found');
    if (row.status !== 'draft' || row.order_status !== 'PENDING' || row.has_gift || !row.unlinked)
      throw new ConflictException(
        'Draft has business associations; use its reviewed contract workflow'
      );
    return row;
  }
  private snapshot(row: RawDraft, action: DraftTerminalAction, reason: string) {
    return this.reviews.create(
      {
        action: 'electricity.draft-terminal.' + action,
        profileId: row.profile_id,
        resourceId: row.id,
      },
      {
        action,
        reason,
        fromState: 'draft',
        toState: action === 'reject' ? 'rejected' : 'cancelled',
        mode: row.mode,
        stateFingerprint: createHash('sha256').update(row.fingerprint_source).digest('hex'),
        createsContract: false,
        createsInvoice: false,
        collectsPayment: false,
        refundAmount: '0',
        changesSavedWizardProgress: false,
      }
    );
  }
  async review(id: string, action: DraftTerminalAction, reason: string, actor: ContractActor) {
    const profileId = await this.owner(id);
    return staffContractFinancialReview(profileId, actor, async (client, archived) => {
      if (archived) throw new ConflictException('Profile is archived');
      await this.staffContext(client, actor);
      return this.snapshot(await this.current(client, id, 'SHARE', profileId), action, reason);
    });
  }
  async terminate(
    id: string,
    input: {
      action: DraftTerminalAction;
      reason: string;
      expectedReviewHash: string;
      idempotencyKey: string;
    },
    actor: ContractActor,
    ip: string
  ) {
    const profileId = await this.owner(id);
    try {
      return await staffContractMutation(
        profileId,
        actor,
        async (client, archived) => {
          if (archived) throw new ConflictException('Profile is archived');
          await this.staffContext(client, actor);
          return contractIdempotency(
            client,
            'electricity_raw_draft_terminal',
            { ...input, orderId: id },
            actor,
            async () => {
              const row = await this.current(client, id, 'UPDATE', profileId),
                review = this.snapshot(row, input.action, input.reason);
              this.reviews.assertConfirmed(review, input.expectedReviewHash);
              const status = input.action === 'reject' ? 'rejected' : 'cancelled';
              const order = await client.query(
                "UPDATE orders SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=$1 AND status='PENDING' RETURNING id",
                [id]
              );
              if (order.rowCount !== 1) throw new ConflictException('Draft order changed');
              const draft = await client.query(
                "UPDATE electricity_orders SET status=$2,updated_at=clock_timestamp() WHERE id=$1 AND status='draft' RETURNING id",
                [id, status]
              );
              if (draft.rowCount !== 1) throw new ConflictException('Draft order changed');
              await client.query(
                'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
                [
                  uuidv7(),
                  actor.userId,
                  'electricity.draft.terminated',
                  JSON.stringify({
                    entity: 'electricity_order',
                    entityId: id,
                    orderId: id,
                    profileId: row.profile_id,
                    fromState: 'draft',
                    toState: status,
                    reason: input.reason,
                    actor: actor.userId,
                    rawDraft: true,
                    reviewHash: review.hash,
                    financialReview: review,
                  }),
                  correlationIdStorage.getStore() ?? uuidv7(),
                  ip,
                ]
              );
              return { orderId: id, status, refundId: null };
            }
          );
        },
        { financialReview: true }
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['55P03', '40P01', '40001'].includes(String(error.code))
      )
        throw new ConflictException('Draft order is busy; retry the reviewed decision');
      throw error;
    }
  }
}

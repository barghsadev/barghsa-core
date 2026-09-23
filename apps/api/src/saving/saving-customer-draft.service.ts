import { Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { OrdersService } from '../orders/orders.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
export interface SavingDraftInput {
  profileId: string;
  currentStep: number;
  data: {
    planId: string;
    hardwareId: string;
    billIdentifier: string;
    addressId: string;
    giftCode: string;
  };
}

@Injectable()
export class SavingCustomerDraftService {
  constructor(private readonly orders: OrdersService) {}

  async get(actor: Actor, profileId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, profileId, true)))
        throw new NotFoundException('Profile not found');
      const profile = await client.query<{ profile_type: string }>(
        'SELECT profile_type FROM profiles WHERE id=$1 AND NOT archived',
        [profileId]
      );
      if (profile.rows[0]?.profile_type !== 'INDIVIDUAL')
        throw new NotFoundException('Individual profile not found');
      await client.query(
        "DELETE FROM saving_customer_drafts WHERE user_id=$1 AND profile_id=$2 AND updated_at < NOW() - INTERVAL '7 days'",
        [actor.userId, profileId]
      );
      const draft = await client.query<{
        current_step: number;
        data: SavingDraftInput['data'];
        updated_at: Date;
      }>(
        'SELECT current_step,data,updated_at FROM saving_customer_drafts WHERE user_id=$1 AND profile_id=$2',
        [actor.userId, profileId]
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      const row = draft.rows[0];
      return row
        ? { currentStep: row.current_step, data: row.data, updatedAt: row.updated_at.toISOString() }
        : { currentStep: 1, data: null, updatedAt: null };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async save(actor: Actor, input: SavingDraftInput) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, input.profileId, true)))
        throw new NotFoundException('Profile not found');
      const profile = await client.query<{ profile_type: string }>(
        'SELECT profile_type FROM profiles WHERE id=$1 AND NOT archived',
        [input.profileId]
      );
      if (profile.rows[0]?.profile_type !== 'INDIVIDUAL')
        throw new NotFoundException('Individual profile not found');
      const saved = await client.query<{
        current_step: number;
        data: SavingDraftInput['data'];
        updated_at: Date;
      }>(
        `INSERT INTO saving_customer_drafts(user_id,profile_id,current_step,data)
         VALUES($1,$2,$3,$4::jsonb)
         ON CONFLICT(user_id,profile_id) DO UPDATE
           SET current_step=EXCLUDED.current_step,data=EXCLUDED.data,updated_at=NOW()
         RETURNING current_step,data,updated_at`,
        [actor.userId, input.profileId, input.currentStep, JSON.stringify(input.data)]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
         VALUES(uuid_generate_v7(),$1,'saving_order_draft_saved',jsonb_build_object('profileId',$2::text,'step',$3::integer),uuid_generate_v7())`,
        [actor.userId, input.profileId, input.currentStep]
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      const row = saved.rows[0]!;
      return {
        currentStep: row.current_step,
        data: row.data,
        updatedAt: row.updated_at.toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

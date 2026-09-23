import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { OrdersService } from '../orders/orders.service.js';
import type { SimplePeriod } from './electricity-order.service.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
export interface SimpleDraftData {
  period: SimplePeriod;
  totalKwh?: string | undefined;
  giftCode?: string | undefined;
  giftCodeInput?: string | undefined;
  addressId?: string | undefined;
}
export interface SaveSimpleDraft {
  profileId: string;
  currentStep: 1 | 2 | 3 | 4 | 5;
  data: SimpleDraftData;
}

@Injectable()
export class ElectricityDraftService {
  constructor(private readonly orders: OrdersService) {}

  async get(actor: Actor, profileId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, profileId))) {
        throw new NotFoundException('Profile not found');
      }
      const profile = (
        await client.query<{ profile_type: string }>(
          'SELECT profile_type FROM profiles WHERE id=$1 AND NOT archived',
          [profileId]
        )
      ).rows[0];
      if (profile?.profile_type !== 'LEGAL') throw new NotFoundException('Legal profile not found');
      const configured = (
        await client.query<{ value: unknown }>(
          "SELECT value FROM app_config WHERE key='electricity.order_draft_ttl_days'"
        )
      ).rows[0]?.value;
      if (
        configured !== undefined &&
        (typeof configured !== 'number' ||
          !Number.isInteger(configured) ||
          configured < 1 ||
          configured > 365)
      ) {
        throw new HttpException({ error: 'CONFIG:STORED_VALUE_INVALID' }, 503);
      }
      const ttlDays = configured ?? 7;
      await client.query(
        `DELETE FROM electricity_customer_drafts
          WHERE user_id=$1 AND profile_id=$2 AND mode='simple'
          AND updated_at < NOW() - ($3::integer * INTERVAL '1 day')`,
        [actor.userId, profileId, ttlDays]
      );
      const draft = (
        await client.query<{ current_step: number; data: SimpleDraftData; updated_at: Date }>(
          `SELECT current_step,data,updated_at FROM electricity_customer_drafts
          WHERE user_id=$1 AND profile_id=$2 AND mode='simple'`,
          [actor.userId, profileId]
        )
      ).rows[0];
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return draft
        ? {
            currentStep: draft.current_step,
            data: draft.data,
            updatedAt: draft.updated_at.toISOString(),
          }
        : { currentStep: 1, data: null, updatedAt: null };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async save(actor: Actor, input: SaveSimpleDraft) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.orders.lockOrderActor(client, actor);
      if (!(await this.orders.mayManageOrders(client, actor.userId, input.profileId))) {
        throw new NotFoundException('Profile not found');
      }
      const profile = (
        await client.query<{ profile_type: string }>(
          'SELECT profile_type FROM profiles WHERE id=$1 AND NOT archived',
          [input.profileId]
        )
      ).rows[0];
      if (profile?.profile_type !== 'LEGAL') throw new NotFoundException('Legal profile not found');
      const row = (
        await client.query<{ current_step: number; data: SimpleDraftData; updated_at: Date }>(
          `INSERT INTO electricity_customer_drafts(user_id,profile_id,mode,current_step,data)
         VALUES($1,$2,'simple',$3,$4::jsonb)
         ON CONFLICT(user_id,profile_id,mode) DO UPDATE
           SET current_step=EXCLUDED.current_step,data=EXCLUDED.data,updated_at=NOW()
         RETURNING current_step,data,updated_at`,
          [actor.userId, input.profileId, input.currentStep, JSON.stringify(input.data)]
        )
      ).rows[0]!;
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
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

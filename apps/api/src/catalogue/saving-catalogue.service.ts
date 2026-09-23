import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
interface PlanRow {
  id: string;
  title: { fa: string; en: string };
  description: { fa: string; en: string } | null;
  price: string | null;
  status: string;
}
interface HardwareRow extends PlanRow {
  plan_id: string;
}
export interface AgreementRow {
  id: string;
  plan_id: string;
  title: string;
  body: string;
  status: 'draft' | 'active' | 'superseded';
  effective_from: Date | null;
  created_at: Date;
  created_by: string;
}

@Injectable()
export class SavingCatalogueService {
  private async plan(client: PoolClient, id: string, lock = false) {
    const result = await client.query<PlanRow>(
      `SELECT id,title,description,effective_product_price(id)::text AS price,status
       FROM products WHERE id=$1 AND type='saving_plan' ${lock ? 'FOR UPDATE NOWAIT' : ''}`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundException('Saving plan not found');
    return result.rows[0];
  }

  private async agreements(client: PoolClient, planId: string) {
    return (
      await client.query<AgreementRow>(
        `SELECT id,plan_id,title,body,status,effective_from,created_at,created_by
         FROM saving_plan_agreement_versions WHERE plan_id=$1 ORDER BY created_at DESC,id DESC`,
        [planId]
      )
    ).rows;
  }

  async browse() {
    const client = await getDbPool().connect();
    try {
      const plans = (
        await client.query<PlanRow>(
          `SELECT id,title,description,effective_product_price(id)::text AS price,status
           FROM products WHERE type='saving_plan' AND status<>'archived'
           ORDER BY title->>'fa',id`
        )
      ).rows;
      if (!plans.length) return { plans: [] };
      const ids = plans.map((plan) => plan.id);
      const hardware = (
        await client.query<HardwareRow>(
          `SELECT h.plan_id,p.id,p.title,p.description,effective_product_price(p.id)::text AS price,p.status
           FROM saving_plan_hardware h JOIN products p ON p.id=h.hardware_id
           WHERE h.plan_id=ANY($1::uuid[]) AND p.status<>'archived'
           ORDER BY p.title->>'fa',p.id`,
          [ids]
        )
      ).rows;
      const agreements = (
        await client.query<AgreementRow>(
          `SELECT id,plan_id,title,body,status,effective_from,created_at,created_by
           FROM saving_plan_agreement_versions WHERE plan_id=ANY($1::uuid[]) AND status='active'`,
          [ids]
        )
      ).rows;
      return {
        plans: plans.map((plan) => {
          const options = hardware
            .filter((row) => row.plan_id === plan.id)
            .map(({ plan_id: _planId, ...option }) => option);
          const agreement = agreements.find((row) => row.plan_id === plan.id);
          return {
            ...plan,
            hardware: options,
            agreement: agreement
              ? {
                  versionId: agreement.id,
                  title: agreement.title,
                  body: agreement.body,
                  effectiveFrom: agreement.effective_from,
                }
              : null,
            available:
              plan.status === 'active' &&
              plan.price !== null &&
              BigInt(plan.price) > 0n &&
              !!agreement &&
              options.some(
                (option) => option.status === 'active' && option.price && BigInt(option.price) > 0n
              ),
          };
        }),
      };
    } finally {
      client.release();
    }
  }

  async admin(planId: string) {
    const client = await getDbPool().connect();
    try {
      await this.plan(client, planId);
      const hardware = (
        await client.query<{ hardware_id: string }>(
          'SELECT hardware_id FROM saving_plan_hardware WHERE plan_id=$1 ORDER BY hardware_id',
          [planId]
        )
      ).rows.map((row) => row.hardware_id);
      return { hardwareIds: hardware, agreements: await this.agreements(client, planId) };
    } finally {
      client.release();
    }
  }

  private async mutate<T>(actor: Actor, fn: (client: PoolClient) => Promise<T>) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:catalogue:edit');
      await requireSessionStepUp(client, actor);
      const result = await fn(client);
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

  private async audit(client: PoolClient, actor: Actor, ip: string, event: string, planId: string) {
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
       VALUES($1,$2,$3,$4::jsonb,$5,$6,NOW())`,
      [uuidv7(), actor.userId, event, JSON.stringify({ planId }), uuidv7(), ip]
    );
  }

  saveDraft(planId: string, input: { title: string; body: string }, actor: Actor, ip: string) {
    return this.mutate(actor, async (client) => {
      await this.plan(client, planId, true);
      await client.query(
        "DELETE FROM saving_plan_agreement_versions WHERE plan_id=$1 AND status='draft'",
        [planId]
      );
      const id = uuidv7();
      await client.query(
        `INSERT INTO saving_plan_agreement_versions(id,plan_id,title,body,created_by)
         VALUES($1,$2,$3,$4,$5)`,
        [id, planId, input.title, input.body, actor.userId]
      );
      await this.audit(client, actor, ip, 'saving_plan_agreement_drafted', planId);
      return { id, status: 'draft' as const };
    });
  }

  activate(planId: string, versionId: string, actor: Actor, ip: string) {
    return this.mutate(actor, async (client) => {
      await this.plan(client, planId, true);
      const draft = (
        await client.query<AgreementRow>(
          `SELECT * FROM saving_plan_agreement_versions WHERE id=$1 AND plan_id=$2 FOR UPDATE NOWAIT`,
          [versionId, planId]
        )
      ).rows[0];
      if (!draft || draft.status !== 'draft')
        throw new ConflictException('Agreement draft changed; refresh and retry');
      await client.query(
        `UPDATE saving_plan_agreement_versions SET status='superseded',updated_at=NOW()
         WHERE plan_id=$1 AND status='active'`,
        [planId]
      );
      await client.query(
        `UPDATE saving_plan_agreement_versions SET status='active',effective_from=NOW(),updated_at=NOW()
         WHERE id=$1`,
        [versionId]
      );
      await this.audit(client, actor, ip, 'saving_plan_agreement_activated', planId);
      return { id: versionId, status: 'active' as const };
    });
  }
}

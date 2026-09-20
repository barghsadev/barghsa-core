import { HttpException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  DEFAULT_SERVICE_DUE_DAYS,
  SERVICE_DUE_PERIOD_TYPES,
  type ServiceDuePeriodSetting,
} from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';

export const SERVICE_DUE_PERIOD_PERMISSION = 'admin:finance:edit';
type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
const settingBody = z
  .object({
    serviceType: z.enum(SERVICE_DUE_PERIOD_TYPES),
    defaultDays: z.number().int().min(1).max(365),
    expectedPeriodId: z.string().uuid().nullable(),
  })
  .strict();

@Injectable()
export class ServiceDuePeriodService {
  private async readCurrent(client: PoolClient): Promise<ServiceDuePeriodSetting[]> {
    const result = await client.query<
      Omit<ServiceDuePeriodSetting, 'effectiveFrom' | 'effectiveUntil'> & {
        effectiveFrom: Date | null;
        effectiveUntil: Date | null;
      }
    >(
      `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS at)
       SELECT types.service_type AS "serviceType", COALESCE(p.default_days,$2) AS "defaultDays",
         p.id AS "periodId", p.effective_from AS "effectiveFrom", p.effective_until AS "effectiveUntil"
       FROM unnest($1::text[]) AS types(service_type) CROSS JOIN instant
       LEFT JOIN LATERAL (
         SELECT id, default_days, effective_from, effective_until FROM service_due_periods
         WHERE service_due_periods.service_type=types.service_type
           AND effective_from<=instant.at AND (effective_until IS NULL OR effective_until>instant.at)
         ORDER BY effective_from DESC LIMIT 1
       ) p ON true`,
      [SERVICE_DUE_PERIOD_TYPES, DEFAULT_SERVICE_DUE_DAYS]
    );
    return result.rows.map((row) => ({
      ...row,
      effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
      effectiveUntil: row.effectiveUntil?.toISOString() ?? null,
    }));
  }

  async list(actor: Actor): Promise<ServiceDuePeriodSetting[]> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, SERVICE_DUE_PERIOD_PERMISSION);
      await requireCurrentSession(client, actor);
      const settings = await this.readCurrent(client);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return settings;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Changes start now. Close the active version without changing issued invoices or future versions. */
  async set(
    raw: unknown,
    actor: Actor,
    ip: string,
    correlationId: string
  ): Promise<ServiceDuePeriodSetting[]> {
    const parsed = settingBody.safeParse(raw);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    const input = parsed.data;
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, SERVICE_DUE_PERIOD_PERMISSION);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
        'barghsa.service_due_periods',
        input.serviceType,
      ]);
      await requireSessionStepUp(client, actor);
      // Preserve database timestamp precision when closing one period and opening the next.
      const at = (await client.query<{ at: string }>('SELECT clock_timestamp()::text AS at'))
        .rows[0]!.at;
      const periods = await client.query<{
        id: string;
        default_days: number;
        effective_from: string;
        effective_until: string | null;
        is_current: boolean;
      }>(
        `SELECT id,default_days,effective_from::text,effective_until::text,effective_from<=$2 AS is_current
         FROM service_due_periods WHERE service_type=$1 AND (effective_until IS NULL OR effective_until>$2)
         ORDER BY effective_from FOR UPDATE`,
        [input.serviceType, at]
      );
      const current = periods.rows.find((row) => row.is_current);
      if (!current || current.default_days !== input.defaultDays) {
        if ((current?.id ?? null) !== input.expectedPeriodId)
          throw new HttpException({ error: ErrorCodes.CONFLICT_STATE.code }, 409);
        const until =
          current?.effective_until ??
          periods.rows.find((row) => !row.is_current)?.effective_from ??
          null;
        if (current)
          await client.query('UPDATE service_due_periods SET effective_until=$2 WHERE id=$1', [
            current.id,
            at,
          ]);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO service_due_periods(service_type,default_days,effective_from,effective_until,created_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [input.serviceType, input.defaultDays, at, until, actor.userId]
        );
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
           VALUES (uuid_generate_v7(),$1,'invoice.due_period.changed',$2::jsonb,$3,$4,clock_timestamp())`,
          [
            actor.userId,
            JSON.stringify({
              serviceType: input.serviceType,
              previousPeriodId: current?.id ?? null,
              previousDays: current?.default_days ?? DEFAULT_SERVICE_DUE_DAYS,
              periodId: inserted.rows[0]!.id,
              defaultDays: input.defaultDays,
              effectiveFrom: at,
              effectiveUntil: until,
            }),
            correlationId,
            ip,
          ]
        );
      }
      const settings = await this.readCurrent(client);
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return settings;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

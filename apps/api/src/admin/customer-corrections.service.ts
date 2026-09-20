import { Injectable, HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { v7 as uuidv7 } from 'uuid';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { requireStaffMutationPermission } from './staff-mutation-permission.js';
import type { FailedNotificationActor } from './failed-notifications.service.js';

const columns = `id,address,profile_id AS "profileId",created_at AS "createdAt",resolved_at AS "resolvedAt",resolution_note AS "resolutionNote"`;

@Injectable()
export class CustomerCorrectionsService {
  async list(actor: FailedNotificationActor, completed: boolean, offset: number) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:jobs:view');
      await requireCurrentSession(client, actor);
      const result = await client.query(
        `SELECT ${columns} FROM email_customer_corrections
        WHERE (resolved_at IS NOT NULL)=$1 ORDER BY created_at DESC,id DESC LIMIT 26 OFFSET $2`,
        [completed, offset]
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result.rows;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async resolve(id: string, note: string, actor: FailedNotificationActor, ip: string | null) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:jobs:retry');
      await requireSessionStepUp(client, actor);
      const existing = (
        await client.query(
          `SELECT ${columns} FROM email_customer_corrections WHERE id=$1 FOR UPDATE`,
          [id]
        )
      ).rows[0];
      if (!existing) throw new HttpException({ statusCode: 404, error: 'NOT_FOUND' }, 404);
      if (existing.resolvedAt && existing.resolutionNote !== note)
        throw new HttpException({ statusCode: 409, error: 'CONFLICT_STATE' }, 409);
      let result = existing;
      if (!existing.resolvedAt) {
        result = (
          await client.query(
            `UPDATE email_customer_corrections SET resolved_at=NOW(),resolved_by=$2,resolution_note=$3
          WHERE id=$1 RETURNING ${columns}`,
            [id, actor.userId, note]
          )
        ).rows[0];
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
          VALUES ($1,$2,'email_customer_correction_resolved',$3,$4,$5)`,
          [
            uuidv7(),
            actor.userId,
            { correctionId: id, profileId: existing.profileId, sessionId: actor.sessionId },
            correlationIdStorage.getStore() ?? uuidv7(),
            ip,
          ]
        );
      }
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
}

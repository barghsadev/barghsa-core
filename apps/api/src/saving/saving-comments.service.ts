import { Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { idempotentMutation } from '../database/idempotency.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
interface OrderRow {
  id: string;
  profile_id: string;
  customer_id: string;
}
interface CommentRow {
  id: string;
  order_id: string;
  author_user_id: string;
  author_name: string;
  author_is_staff: boolean;
  body: string;
  created_at: Date;
}
const commentQuery = `SELECT c.id,c.order_id,c.author_user_id,u.username AS author_name,
  u.is_staff AS author_is_staff,c.body,c.created_at
  FROM saving_order_comments c JOIN users u ON u.user_id=c.author_user_id`;

@Injectable()
export class SavingCommentsService {
  constructor(private readonly orders: OrdersService) {}

  private async access<T>(
    id: string,
    actor: Actor,
    staff: boolean,
    write: boolean,
    work: (client: PoolClient, order: OrderRow) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      if (staff) {
        await requireStaffMutationPermission(
          client,
          actor.userId,
          write ? 'contracts:write' : 'contracts:read'
        );
        if (write) await requireSessionStepUp(client, actor);
        else await requireCurrentSession(client, actor);
      } else if (write) await this.orders.lockOrderActor(client, actor);
      else await requireCurrentSession(client, actor);
      const order = (
        await client.query<OrderRow>(
          `SELECT s.id,s.profile_id,p.user_id AS customer_id FROM saving_orders s
         JOIN profiles p ON p.id=s.profile_id WHERE s.id=$1`,
          [id]
        )
      ).rows[0];
      if (
        !order ||
        (!staff && !(await this.orders.mayManageOrders(client, actor.userId, order.profile_id)))
      )
        throw new NotFoundException('Saving order not found');
      const result = await work(client, order);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private present(row: CommentRow) {
    return {
      id: row.id,
      orderId: row.order_id,
      authorUserId: row.author_user_id,
      authorName: row.author_name,
      authorRole: row.author_is_staff ? 'staff' : 'customer',
      body: row.body,
      createdAt: row.created_at.toISOString(),
    };
  }

  async list(id: string, actor: Actor, staff: boolean, before?: string) {
    return this.access(id, actor, staff, false, async (client) => {
      const cursor = before
        ? (
            await client.query<{ created_at: Date }>(
              'SELECT created_at FROM saving_order_comments WHERE id=$1 AND order_id=$2',
              [before, id]
            )
          ).rows[0]
        : null;
      if (before && !cursor) throw new NotFoundException('Comment cursor not found');
      const rows = (
        await client.query<CommentRow>(
          `${commentQuery} WHERE c.order_id=$1 AND ($2::timestamptz IS NULL OR
          (c.created_at,c.id)<($2::timestamptz,$3::uuid))
         ORDER BY c.created_at DESC,c.id DESC LIMIT 51`,
          [id, cursor?.created_at ?? null, before ?? null]
        )
      ).rows;
      return {
        comments: rows
          .slice(0, 50)
          .reverse()
          .map((row) => this.present(row)),
        nextBefore: rows.length > 50 ? rows[49]!.id : null,
      };
    });
  }

  async add(
    id: string,
    actor: Actor,
    staff: boolean,
    input: { idempotencyKey: string; body: string },
    ip: string
  ) {
    return this.access(id, actor, staff, true, (client, order) =>
      idempotentMutation(client, 'saving_order_comment', { ...input, id }, actor, async () => {
        const row = (
          await client.query<CommentRow>(
            `WITH inserted AS (
            INSERT INTO saving_order_comments(id,order_id,author_user_id,body)
            VALUES($1,$2,$3,$4) RETURNING *
          ) SELECT c.id,c.order_id,c.author_user_id,u.username AS author_name,
            u.is_staff AS author_is_staff,c.body,c.created_at
            FROM inserted c JOIN users u ON u.user_id=c.author_user_id`,
            [uuidv7(), id, actor.userId, input.body.trim()]
          )
        ).rows[0]!;
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata)
           VALUES($1,$2,'saving.order_comment_added',$3::jsonb)`,
          [
            uuidv7(),
            actor.userId,
            JSON.stringify({ savingOrderId: id, commentId: row.id, staff, ip }),
          ]
        );
        if (staff && order.customer_id !== actor.userId)
          await new NotificationsService().create(
            {
              userId: order.customer_id,
              profileId: order.profile_id,
              type: 'general',
              title: 'Saving order reply',
              link: `/savings/orders/${id}`,
              localizedContent: {
                fa: {
                  title: 'پاسخ به سفارش صرفه‌جویی',
                  body: 'کارشناس به سفارش صرفه‌جویی شما پاسخ داد.',
                },
                en: {
                  title: 'Saving order reply',
                  body: 'A staff member replied to your power-saving order.',
                },
              },
            },
            client
          );
        return this.present(row);
      })
    );
  }
}

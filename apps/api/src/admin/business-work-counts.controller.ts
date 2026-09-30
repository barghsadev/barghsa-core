import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseEnumPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { requireCurrentSession } from '../session/session-step-up.js';

const widgetKeys = ['queue', 'work', 'failures'] as const;
type WidgetKey = (typeof widgetKeys)[number];
const widgetFields = {
  queue: ['pendingTickets', 'electricityOrders', 'savingOrders', 'unassignedConsultations'],
  work: ['consultations', 'solarRequests', 'documentReviews', 'refundObligations'],
  failures: ['failedJobs', 'deadLetterNotifications', 'failedRefundObligations'],
} as const;

// Only static, permission-gated expressions for the requested widget enter its SQL.
const countColumns = [
  {
    key: 'consultations',
    alias: 'consultations',
    sql: `CASE WHEN $1::boolean THEN (SELECT count(*)::int FROM consultation_requests
             WHERE status NOT IN ('offer_declined','completed','rejected','cancelled')) END`,
  },
  {
    key: 'unassignedConsultations',
    alias: 'unassigned_consultations',
    sql: `CASE WHEN $1::boolean THEN (SELECT count(*)::int FROM consultation_requests
             WHERE status NOT IN ('offer_declined','completed','rejected','cancelled')
               AND staff_owner_id IS NULL AND staff_team IS NULL) END`,
  },
  {
    key: 'electricityOrders',
    alias: 'electricity_orders',
    sql: `CASE WHEN $2::boolean THEN (SELECT count(*)::int FROM electricity_orders
             WHERE status='awaiting_staff_review') END`,
  },
  {
    key: 'savingOrders',
    alias: 'saving_orders',
    sql: `CASE WHEN $2::boolean THEN (SELECT count(*)::int FROM saving_orders
             WHERE status='awaiting_staff_review') END`,
  },
  {
    key: 'pendingTickets',
    alias: 'pending_tickets',
    sql: `CASE WHEN ($7::boolean OR $8::boolean) THEN (SELECT count(*)::int FROM tickets
             WHERE status IN ('open','in_progress','waiting_customer','waiting_staff')
               AND ($7::boolean OR assigned_to=$9::text)) END`,
  },
  {
    key: 'solarRequests',
    alias: 'solar_requests',
    sql: `CASE WHEN $1::boolean THEN (SELECT count(*)::int FROM solar_construction_requests
             WHERE status NOT IN ('approved','rejected','cancelled','contract_created','draft')) END`,
  },
  {
    key: 'documentReviews',
    alias: 'document_reviews',
    sql: `CASE WHEN ($1::boolean OR $2::boolean OR $3::boolean OR $4::boolean)
             THEN (SELECT count(*)::int FROM documents WHERE state='SubmittedForReview'
               AND (($1 AND business_record_type IN ('order','solar_request'))
                 OR ($2 AND business_record_type='contract')
                 OR ($3 AND business_record_type='invoice')
                 OR ($4 AND business_record_type='standalone'))) END`,
  },
  {
    key: 'refundObligations',
    alias: 'refund_obligations',
    sql: `CASE WHEN $5::boolean THEN (SELECT count(*)::int FROM refunds r
             WHERE r.state<>'Completed' AND (
               EXISTS(SELECT 1 FROM contract_refund_obligations co WHERE co.refund_id=r.id)
               OR EXISTS(SELECT 1 FROM refund_obligations eo WHERE eo.refund_id=r.id))) END`,
  },
  {
    key: 'failedRefundObligations',
    alias: 'failed_refund_obligations',
    sql: `CASE WHEN $5::boolean THEN (SELECT count(*)::int FROM refunds r
             LEFT JOIN refund_retry_jobs j ON j.refund_id=r.id
             WHERE r.state<>'Completed' AND (r.state='Failed' OR j.exhausted_at IS NOT NULL)
               AND (EXISTS(SELECT 1 FROM contract_refund_obligations co WHERE co.refund_id=r.id)
                 OR EXISTS(SELECT 1 FROM refund_obligations eo WHERE eo.refund_id=r.id))) END`,
  },
  {
    key: 'failedJobs',
    alias: 'failed_jobs',
    sql: `CASE WHEN $6::boolean THEN (SELECT count(*)::int FROM background_jobs
             WHERE status IN ('failed','dead_letter')) END`,
  },
  {
    key: 'deadLetterNotifications',
    alias: 'dead_letter_notifications',
    sql: `CASE WHEN $6::boolean THEN (SELECT count(*)::int FROM notification_dead_letter
             WHERE status='open') END`,
  },
] as const;

@ApiTags('Admin · Dashboard')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/dashboard')
export class BusinessWorkCountsController {
  @Get('business-work-counts')
  @ApiOperation({ summary: 'Count open business work visible to the current staff permissions' })
  @Header('Cache-Control', 'private, no-store')
  async counts(@Req() req: AuthenticatedRequest) {
    return this.readCounts(req);
  }

  @Get('widgets/:widget')
  @ApiOperation({ summary: 'Read one independently loaded staff dashboard widget' })
  @ApiParam({ name: 'widget', enum: [...widgetKeys] })
  @Header('Cache-Control', 'private, no-store')
  async widgetCounts(
    @Req() req: AuthenticatedRequest,
    @Param('widget', new ParseEnumPipe({ queue: 'queue', work: 'work', failures: 'failures' }))
    widget: WidgetKey
  ) {
    return this.readCounts(req, widget);
  }

  private async readCounts(req: AuthenticatedRequest, widget?: WidgetKey) {
    const orders = hasStaffPermission(req, 'orders:read');
    const contracts =
      hasStaffPermission(req, 'contracts:read') || hasStaffPermission(req, 'contracts:write');
    const invoices = hasStaffPermission(req, 'invoices:read');
    const legal = hasStaffPermission(req, 'legal:read');
    const finance = hasStaffPermission(req, 'admin:financial:edit');
    const jobs = hasStaffPermission(req, 'admin:jobs:view');
    const tickets = hasStaffPermission(req, 'tickets:read') || hasStaffPermission(req, 'tickets:*');
    const assignedTickets = !tickets && hasStaffPermission(req, 'tickets:assigned');
    const allowed =
      widget === 'queue'
        ? orders || contracts || tickets || assignedTickets
        : widget === 'work'
          ? orders || contracts || invoices || legal || finance
          : widget === 'failures'
            ? finance || jobs
            : orders ||
              contracts ||
              invoices ||
              legal ||
              finance ||
              jobs ||
              tickets ||
              assignedTickets;
    if (!allowed) throw new ForbiddenException('Staff dashboard permission required');
    const fields: readonly string[] | undefined = widget ? widgetFields[widget] : undefined;
    const columns = countColumns.filter(({ key }) => !fields || fields.includes(key));
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, req.session);
      const counts = (
        await client.query<Record<string, number | null>>(
          `WITH access AS (SELECT $1::boolean, $2::boolean, $3::boolean, $4::boolean,
            $5::boolean, $6::boolean, $7::boolean, $8::boolean, $9::text)
           SELECT ${columns.map(({ sql, alias }) => `${sql} AS ${alias}`).join(',\n')}`,
          [
            orders,
            contracts,
            invoices,
            legal,
            finance,
            jobs,
            tickets,
            assignedTickets,
            req.session.userId,
          ]
        )
      ).rows[0]!;
      await requireCurrentSession(client, req.session);
      await client.query('COMMIT');
      return Object.fromEntries(columns.map(({ key, alias }) => [key, counts[alias]]));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

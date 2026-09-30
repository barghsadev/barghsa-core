import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { requireCurrentSession } from '../session/session-step-up.js';

@ApiTags('Admin · Dashboard')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/dashboard')
export class BusinessWorkCountsController {
  @Get('business-work-counts')
  @ApiOperation({ summary: 'Count open business work visible to the current staff permissions' })
  async counts(@Req() req: AuthenticatedRequest) {
    const orders = hasStaffPermission(req, 'orders:read');
    const contracts =
      hasStaffPermission(req, 'contracts:read') || hasStaffPermission(req, 'contracts:write');
    const invoices = hasStaffPermission(req, 'invoices:read');
    const legal = hasStaffPermission(req, 'legal:read');
    const finance = hasStaffPermission(req, 'admin:financial:edit');
    const jobs = hasStaffPermission(req, 'admin:jobs:view');
    const tickets = hasStaffPermission(req, 'tickets:read') || hasStaffPermission(req, 'tickets:*');
    const assignedTickets = !tickets && hasStaffPermission(req, 'tickets:assigned');
    if (
      !orders &&
      !contracts &&
      !invoices &&
      !legal &&
      !finance &&
      !jobs &&
      !tickets &&
      !assignedTickets
    )
      throw new ForbiddenException('Staff dashboard permission required');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, req.session);
      const counts = (
        await client.query<{
          consultations: number | null;
          unassigned_consultations: number | null;
          electricity_orders: number | null;
          saving_orders: number | null;
          pending_tickets: number | null;
          solar_requests: number | null;
          document_reviews: number | null;
          refund_obligations: number | null;
          failed_refund_obligations: number | null;
          failed_jobs: number | null;
          dead_letter_notifications: number | null;
        }>(
          `SELECT
           CASE WHEN $1::boolean THEN (SELECT count(*)::int FROM consultation_requests
             WHERE status NOT IN ('offer_declined','completed','rejected','cancelled')) END AS consultations,
           CASE WHEN $1::boolean THEN (SELECT count(*)::int FROM consultation_requests
             WHERE status NOT IN ('offer_declined','completed','rejected','cancelled')
               AND staff_owner_id IS NULL AND staff_team IS NULL) END AS unassigned_consultations,
           CASE WHEN $2::boolean THEN (SELECT count(*)::int FROM electricity_orders
             WHERE status='awaiting_staff_review') END AS electricity_orders,
           CASE WHEN $2::boolean THEN (SELECT count(*)::int FROM saving_orders
             WHERE status='awaiting_staff_review') END AS saving_orders,
           CASE WHEN ($7::boolean OR $8::boolean) THEN (SELECT count(*)::int FROM tickets
             WHERE status IN ('open','in_progress','waiting_customer','waiting_staff')
               AND ($7::boolean OR assigned_to=$9::text)) END AS pending_tickets,
           CASE WHEN $1::boolean THEN (SELECT count(*)::int FROM solar_construction_requests
             WHERE status NOT IN ('approved','rejected','cancelled','contract_created','draft')) END AS solar_requests,
           CASE WHEN ($1::boolean OR $2::boolean OR $3::boolean OR $4::boolean)
             THEN (SELECT count(*)::int FROM documents WHERE state='SubmittedForReview'
               AND (($1 AND business_record_type IN ('order','solar_request'))
                 OR ($2 AND business_record_type='contract')
                 OR ($3 AND business_record_type='invoice')
                 OR ($4 AND business_record_type='standalone'))) END AS document_reviews,
           CASE WHEN $5::boolean THEN (SELECT count(*)::int FROM refunds r
             WHERE r.state<>'Completed' AND (
               EXISTS(SELECT 1 FROM contract_refund_obligations co WHERE co.refund_id=r.id)
               OR EXISTS(SELECT 1 FROM refund_obligations eo WHERE eo.refund_id=r.id))) END AS refund_obligations,
           CASE WHEN $5::boolean THEN (SELECT count(*)::int FROM refunds r
             LEFT JOIN refund_retry_jobs j ON j.refund_id=r.id
             WHERE r.state<>'Completed' AND (r.state='Failed' OR j.exhausted_at IS NOT NULL)
               AND (EXISTS(SELECT 1 FROM contract_refund_obligations co WHERE co.refund_id=r.id)
                 OR EXISTS(SELECT 1 FROM refund_obligations eo WHERE eo.refund_id=r.id))) END AS failed_refund_obligations,
           CASE WHEN $6::boolean THEN (SELECT count(*)::int FROM background_jobs
             WHERE status IN ('failed','dead_letter')) END AS failed_jobs,
           CASE WHEN $6::boolean THEN (SELECT count(*)::int FROM notification_dead_letter
             WHERE status='open') END AS dead_letter_notifications`,
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
      return {
        consultations: counts.consultations,
        unassignedConsultations: counts.unassigned_consultations,
        electricityOrders: counts.electricity_orders,
        savingOrders: counts.saving_orders,
        pendingTickets: counts.pending_tickets,
        solarRequests: counts.solar_requests,
        documentReviews: counts.document_reviews,
        refundObligations: counts.refund_obligations,
        failedRefundObligations: counts.failed_refund_obligations,
        failedJobs: counts.failed_jobs,
        deadLetterNotifications: counts.dead_letter_notifications,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

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
    if (!orders && !contracts && !invoices && !legal)
      throw new ForbiddenException('Staff dashboard permission required');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, req.session);
      const counts = (
        await client.query<{
          consultations: number | null;
          electricity_orders: number | null;
          solar_requests: number | null;
          document_reviews: number | null;
        }>(
          `SELECT
           CASE WHEN $1::boolean THEN (SELECT count(*)::int FROM consultation_requests
             WHERE status NOT IN ('offer_declined','completed','rejected','cancelled')) END AS consultations,
           CASE WHEN $2::boolean THEN (SELECT count(*)::int FROM electricity_orders
             WHERE status='awaiting_staff_review') END AS electricity_orders,
           CASE WHEN $1::boolean THEN (SELECT count(*)::int FROM solar_construction_requests
             WHERE status NOT IN ('approved','rejected','cancelled','contract_created','draft')) END AS solar_requests,
           CASE WHEN ($1::boolean OR $2::boolean OR $3::boolean OR $4::boolean)
             THEN (SELECT count(*)::int FROM documents WHERE state='SubmittedForReview'
               AND (($1 AND business_record_type IN ('order','solar_request'))
                 OR ($2 AND business_record_type='contract')
                 OR ($3 AND business_record_type='invoice')
                 OR ($4 AND business_record_type='standalone'))) END AS document_reviews`,
          [orders, contracts, invoices, legal]
        )
      ).rows[0]!;
      await requireCurrentSession(client, req.session);
      await client.query('COMMIT');
      return {
        consultations: counts.consultations,
        electricityOrders: counts.electricity_orders,
        solarRequests: counts.solar_requests,
        documentReviews: counts.document_reviews,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

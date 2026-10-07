import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { parseWalletHistoryQuery, readWalletHistory } from './wallet-history.js';

@ApiTags('Staff · Reconciliation')
@Controller('api/admin/reconciliation/wallets')
@UseGuards(SessionAuthGuard)
export class StaffWalletLedgerController {
  @Get(':profileId/transactions')
  @Header('Cache-Control', 'private, no-store')
  @RateLimit({ namespace: 'wallet:staff-ledger:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Read profile-scoped wallet history with current reconciliation authority',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['profileId', 'transactions', 'nextCursor'],
      properties: {
        profileId: { type: 'string', format: 'uuid' },
        nextCursor: { type: 'string', nullable: true },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'type', 'amount', 'state', 'refId', 'description', 'createdAt'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              type: { type: 'string' },
              amount: { type: 'string', pattern: '^-?[0-9]+$' },
              state: { type: 'string' },
              refId: { type: 'string', nullable: true },
              description: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  async transactions(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Query() raw: Record<string, unknown>,
    @Req() req: AuthenticatedRequest
  ) {
    if (!hasStaffPermission(req, 'admin:reconciliation:view')) throw new ForbiddenException();
    const query = parseWalletHistoryQuery(raw);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, req.session.userId, 'admin:reconciliation:view');
      await requireCurrentSession(client, req.session);
      const context = (
        await client.query<{ operating_context: string }>(
          'SELECT operating_context FROM sessions WHERE session_id=$1 AND user_id=$2',
          [req.session.sessionId, req.session.userId]
        )
      ).rows[0];
      if (context?.operating_context !== 'staff') throw new ForbiddenException();
      if (!(await client.query('SELECT id FROM profiles WHERE id=$1', [profileId])).rows.length)
        throw new NotFoundException();
      const page = await readWalletHistory(client, profileId, query);
      // Staff investigation exposes the ledger, without customer-only receipt links or metadata.
      const transactions = page.transactions.map(
        ({ id, type, amount, state, refId, description, createdAt }) => ({
          id,
          type,
          amount,
          state,
          refId,
          description,
          createdAt,
        })
      );
      await requireCurrentSession(client, req.session);
      await client.query('COMMIT');
      return { profileId, transactions, nextCursor: page.nextCursor };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
import { WalletService } from './wallet.service.js';

@ApiTags('Staff · Wallet')
@Controller('api/staff/profiles')
@UseGuards(SessionAuthGuard)
export class StaffWalletBalanceController {
  constructor(private readonly wallets: WalletService) {}

  @Get(':profileId/wallet-balance')
  @Header('Cache-Control', 'private, no-store')
  @RateLimit({ namespace: 'wallet:staff-balance:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Read a profile wallet balance with current staff financial authorization',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['profileId', 'currency', 'balance'],
      properties: {
        profileId: { type: 'string', format: 'uuid' },
        currency: { type: 'string', enum: ['IRR'] },
        balance: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
      },
    },
  })
  async balance(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    if (!hasStaffPermission(req, 'admin:financial:edit')) throw new ForbiddenException();
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      // Hold the account stable, then verify current grants after the balance read.
      // A role removal during a blocked read must withdraw the cached request permission.
      await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [
        req.session.userId,
      ]);
      await requireCurrentSession(client, req.session);
      const exists =
        (await client.query('SELECT id FROM profiles WHERE id=$1', [profileId])).rows.length > 0;
      const wallet = exists ? await this.wallets.getWallet(profileId, client) : null;
      await requireStaffMutationPermission(client, req.session.userId, 'admin:financial:edit');
      const context = (
        await client.query<{ operating_context: string }>(
          'SELECT operating_context FROM sessions WHERE session_id=$1 AND user_id=$2',
          [req.session.sessionId, req.session.userId]
        )
      ).rows[0];
      if (context?.operating_context !== 'staff') throw new ForbiddenException();
      if (!exists) throw new NotFoundException();
      await requireCurrentSession(client, req.session);
      await client.query('COMMIT');
      return { profileId, currency: 'IRR', balance: wallet?.availableBalance.toString() ?? '0' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

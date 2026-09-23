import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { getDbPool } from '@barghsa/db';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';

const config = z
  .object({
    stockTracking: z.boolean(),
    stockCount: z.number().int().min(0).max(1_000_000),
    reservationMinutes: z.number().int().min(5).max(10080),
  })
  .strict();
interface HardwareInventory {
  id: string;
  stock_tracking: boolean;
  stock_count: number;
  reserved_count: number;
  reservation_minutes: number;
}
function present(row: HardwareInventory) {
  return {
    stockTracking: row.stock_tracking,
    stockCount: row.stock_count,
    reservedCount: row.reserved_count,
    reservationMinutes: row.reservation_minutes,
  };
}

@ApiTags('Admin · Saving inventory')
@Controller('api/admin/catalogue/hardware/:id/inventory')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class SavingInventoryController {
  @Get()
  @ApiOperation({ summary: 'Read hardware stock and reservation configuration' })
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, req.session.userId, 'admin:catalogue:edit');
      await requireCurrentSession(client, req.session);
      const row = (
        await client.query<HardwareInventory>(
          "SELECT id,stock_tracking,stock_count,reserved_count,reservation_minutes FROM products WHERE id=$1 AND type='hardware'",
          [id]
        )
      ).rows[0];
      if (!row) throw new HttpException('Hardware product not found', 404);
      await client.query('COMMIT');
      return present(row);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  @Put()
  @HttpCode(200)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Set optional stock tracking, on-hand count and reservation period' })
  @ApiZodBody(config)
  async put(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = config.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, req.session.userId, 'admin:catalogue:edit');
      await requireSessionStepUp(client, req.session);
      const before = (
        await client.query<HardwareInventory>(
          "SELECT id,stock_tracking,stock_count,reserved_count,reservation_minutes FROM products WHERE id=$1 AND type='hardware' FOR UPDATE",
          [id]
        )
      ).rows[0];
      if (!before) throw new HttpException('Hardware product not found', 404);
      const next = parsed.data;
      if (next.stockCount < before.reserved_count || (!next.stockTracking && before.reserved_count))
        throw new HttpException('Open reservations exceed the requested stock configuration', 409);
      if (
        before.stock_tracking !== next.stockTracking ||
        before.stock_count !== next.stockCount ||
        before.reservation_minutes !== next.reservationMinutes
      ) {
        const after = (
          await client.query<HardwareInventory>(
            `UPDATE products SET stock_tracking=$2,stock_count=$3,reservation_minutes=$4,updated_at=NOW()
           WHERE id=$1 RETURNING id,stock_tracking,stock_count,reserved_count,reservation_minutes`,
            [id, next.stockTracking, next.stockCount, next.reservationMinutes]
          )
        ).rows[0]!;
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
           VALUES($1,$2,'saving_inventory_configured',$3::jsonb,$4,$5)`,
          [
            uuidv7(),
            req.session.userId,
            JSON.stringify({ hardwareId: id, before: present(before), after: present(after) }),
            uuidv7(),
            req.ip ?? 'unknown',
          ]
        );
        await requireSessionStepUp(client, req.session);
        await client.query('COMMIT');
        return present(after);
      }
      await client.query('COMMIT');
      return present(before);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

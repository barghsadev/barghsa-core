import { Controller, Get, Logger, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { getDbPool } from '@barghsa/db'
import { SessionOptionalGuard } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'

@ApiTags('Products')
@Controller('api/products')
@UseGuards(SessionOptionalGuard)
export class ProductsController {
  private readonly logger = new Logger(ProductsController.name)

  /**
   * GET /api/products
   *
   * Returns all active products, ordered by system key.
   * Public endpoint — no authentication required.
   */
  @Get()
  @RateLimit({ namespace: 'products:list', limit: 120, windowMs: 60_000 })
  @ApiOperation({ summary: 'List all active products' })
  @ApiResponse({
    status: 200,
    description: 'List of active products.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          systemKey: { type: 'string', nullable: true },
          title: { type: 'object' },
          description: { type: 'object', nullable: true },
          price: { type: 'string', nullable: true },
          status: { type: 'string' },
        },
      },
    },
  })
  async getActiveProducts() {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, type, system_key, title, description, price, status
       FROM products WHERE status = 'active'
       ORDER BY system_key NULLS LAST`,
    )
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      type: row.type as string,
      systemKey: row.system_key as string | null,
      title: row.title as Record<string, string>,
      description: row.description as Record<string, string> | null,
      price: row.price ? String(row.price) : null,
      status: row.status as string,
    }))
  }
}

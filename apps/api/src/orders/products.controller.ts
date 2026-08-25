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
   * Returns all active products, ordered by system type.
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
          productType: { type: 'string' },
          systemType: { type: 'string', nullable: true },
          titleFa: { type: 'string' },
          price: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          minKwh: { type: 'string' },
          maxKwh: { type: 'string' },
        },
      },
    },
  })
  async getActiveProducts() {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT * FROM products WHERE is_active = true ORDER BY system_type NULLS LAST`,
    )
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      productType: row.product_type as string,
      systemType: row.system_type as string | null,
      titleFa: row.title_fa as string,
      price: row.price as string | null,
      isActive: row.is_active as boolean,
      minKwh: row.min_kwh as string,
      maxKwh: row.max_kwh as string,
    }))
  }
}
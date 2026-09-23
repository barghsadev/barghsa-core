import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import { SessionOptionalGuard } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { AdminService } from '../admin/admin.service.js';

const ELECTRICITY_KEYS = ['thermal', 'green', 'free_market', 'energy_saving'] as const;

@ApiTags('Products')
@Controller('api/products')
@UseGuards(SessionOptionalGuard)
export class ProductsController {
  constructor(private readonly adminService: AdminService) {}

  /** Customer catalogue. Availability is informational; submission rechecks it. */
  @Get('electricity')
  @RateLimit({ namespace: 'products:electricity', limit: 120, windowMs: 60_000 })
  @ApiOperation({ summary: 'List system electricity products with current prices and limits' })
  @ApiResponse({
    status: 200,
    description:
      'Four system electricity products in stable order; availability is rechecked at submission.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', nullable: true },
          systemKey: { type: 'string' },
          title: { type: 'object', nullable: true },
          description: { type: 'object', nullable: true },
          status: { type: 'string' },
          price: { type: 'string', nullable: true },
          limits: {
            type: 'object',
            properties: { minKwh: { type: 'string' }, maxKwh: { type: 'string' } },
          },
          orderable: { type: 'boolean' },
          simpleOrderable: { type: 'boolean' },
          simpleOrderBlockReasons: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  })
  async getElectricityProducts() {
    const [result, safety] = await Promise.all([
      getDbPool().query<{
        id: string;
        system_key: string;
        title: Record<string, string>;
        description: Record<string, string> | null;
        status: string;
        price: string | null;
        min_kwh: string | null;
        max_kwh: string | null;
      }>(
        `SELECT p.id, p.system_key, p.title, p.description, p.status,
              effective_product_price(p.id) AS price,
              l.min_kwh, l.max_kwh
         FROM products p
         LEFT JOIN electricity_product_limits l ON l.product_id = p.id
        WHERE p.type = 'electricity'
          AND p.system_key = ANY($1::text[])`,
        [ELECTRICITY_KEYS]
      ),
      this.adminService.getGreenElectricitySafetyStatus(),
    ]);
    const byKey = new Map(result.rows.map((row) => [row.system_key, row]));
    return ELECTRICITY_KEYS.map((systemKey) => {
      const row = byKey.get(systemKey);
      const price = row?.price == null ? null : String(row.price);
      const minKwh = row?.min_kwh == null ? '0' : String(row.min_kwh);
      const maxKwh = row?.max_kwh == null ? '0' : String(row.max_kwh);
      const orderable =
        row?.status === 'active' && price !== null && /^\d+$/.test(price) && BigInt(price) > 0n;
      return {
        id: row?.id ?? null,
        systemKey,
        title: row?.title ?? null,
        description: row?.description ?? null,
        status: row?.status ?? 'missing',
        price,
        limits: { minKwh, maxKwh },
        orderable,
        simpleOrderable: systemKey === 'thermal' && orderable && !safety.simpleOrder.blocked,
        simpleOrderBlockReasons: systemKey === 'thermal' ? safety.simpleOrder.reasons : [],
      };
    });
  }

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
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT id, type, system_key, title, description, effective_product_price(id) AS price, status
       FROM products WHERE status = 'active'
       ORDER BY system_key NULLS LAST`
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      type: row.type as string,
      systemKey: row.system_key as string | null,
      title: row.title as Record<string, string>,
      description: row.description as Record<string, string> | null,
      price: row.price ? String(row.price) : null,
      status: row.status as string,
    }));
  }
}

import {
  Body,
  Controller,
  Get,
  Post,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { OrdersService } from './orders.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import { ErrorCodes } from '@barghsa/shared/errors'

@ApiTags('Orders')
@Controller('api/orders')
@UseGuards(SessionAuthGuard)
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name)

  constructor(private readonly ordersService: OrdersService) {}

  /**
   * POST /api/orders
   *
   * Creates a new order with an address snapshot. The address values are
   * copied at order time (not foreign key) so the order remains accurate
   * even if the user updates their saved address later.
   *
   * Requires: authenticated session, valid profile ownership, active product.
   */
  @Post()
  @HttpCode(201)
  @RateLimit({ namespace: 'orders:create:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Create a new order with address snapshot' })
  @ApiResponse({ status: 201, description: 'Order created.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Profile or product not found' })
  async createOrder(
    @Body() body: {
      profileId: string
      productId: string
      orderType: 'electricity' | 'savings' | 'solar'
      address: {
        provinceId: string
        cityId: string
        fullAddress: string
        postalCode: string
      }
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.session.userId

    const order = await this.ordersService.createOrder(userId, {
      profileId: body.profileId,
      productId: body.productId,
      orderType: body.orderType,
      address: body.address,
    })

    this.logger.log(`Order ${order.id} created for user ${userId}`)
    return order
  }

  /**
   * GET /api/orders
   *
   * Lists all orders for the authenticated user, most recent first.
   */
  @Get()
  @HttpCode(200)
  @RateLimit({ namespace: 'orders:list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List orders for the authenticated user' })
  @ApiResponse({ status: 200, description: 'List of orders.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async listOrders(@Req() req: AuthenticatedRequest) {
    const userId = req.session.userId
    const orders = await this.ordersService.listOrders(userId)
    return { orders }
  }

  /**
   * GET /api/orders/:id
   *
   * Returns a single order by id, scoped to the authenticated user.
   */
  @Get(':id')
  @HttpCode(200)
  @RateLimit({ namespace: 'orders:get:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Get order details' })
  @ApiResponse({ status: 200, description: 'Order details.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getOrder(
    @Param('id') orderId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.session.userId
    const order = await this.ordersService.getOrder(userId, orderId)

    if (!order) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code },
        404,
      )
    }

    return order
  }
}
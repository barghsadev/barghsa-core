import { Module } from '@nestjs/common'
import { OrdersController } from './orders.controller.js'
import { ProductsController } from './products.controller.js'
import { OrdersService } from './orders.service.js'
import { SessionModule } from '../session/session.module.js'
import { AdminModule } from '../admin/admin.module.js'

@Module({
  imports: [SessionModule, AdminModule],
  controllers: [OrdersController, ProductsController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}

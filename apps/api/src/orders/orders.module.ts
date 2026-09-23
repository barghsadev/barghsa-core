import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { ProductsController } from './products.controller.js';
import { OrdersService } from './orders.service.js';
import { SessionModule } from '../session/session.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { InvoiceModule } from '../invoice/invoice.module.js';
import { ElectricityCalculationService } from '../electricity/electricity-calculation.service.js';
import { ElectricityOrderService } from '../electricity/electricity-order.service.js';
import { ElectricityOrderController } from '../electricity/electricity-order.controller.js';
import {
  ElectricityBillDataService,
  HttpBillDataProvider,
} from '../electricity/electricity-bill-data.service.js';

@Module({
  imports: [SessionModule, AdminModule, InvoiceModule],
  controllers: [OrdersController, ProductsController, ElectricityOrderController],
  providers: [
    OrdersService,
    ElectricityCalculationService,
    ElectricityOrderService,
    ElectricityBillDataService,
    HttpBillDataProvider,
  ],
  exports: [OrdersService, ElectricityCalculationService],
})
export class OrdersModule {}

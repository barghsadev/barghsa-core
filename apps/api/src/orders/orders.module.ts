import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { ProductsController } from './products.controller.js';
import { OrdersService } from './orders.service.js';
import { SessionModule } from '../session/session.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { InvoiceModule } from '../invoice/invoice.module.js';
import { ContractModule } from '../contract/contract.module.js';
import { ElectricityCalculationService } from '../electricity/electricity-calculation.service.js';
import { ElectricityOrderService } from '../electricity/electricity-order.service.js';
import { ElectricityOrderController } from '../electricity/electricity-order.controller.js';
import {
  ElectricityBillDataService,
  HttpBillDataProvider,
} from '../electricity/electricity-bill-data.service.js';
import { ElectricityDraftService } from '../electricity/electricity-draft.service.js';
import { ElectricityStaffReviewController } from '../electricity/electricity-staff-review.controller.js';
import { ElectricityStaffReviewService } from '../electricity/electricity-staff-review.service.js';
import {
  CustomerElectricityIncreaseController,
  StaffElectricityIncreaseController,
} from '../electricity/electricity-increase.controller.js';
import { ElectricityIncreaseService } from '../electricity/electricity-increase.service.js';
import {
  CustomerElectricityPriceAdjustmentController,
  StaffElectricityPriceAdjustmentController,
} from '../electricity/electricity-price-adjustment.controller.js';
import { ElectricityPriceAdjustmentService } from '../electricity/electricity-price-adjustment.service.js';
import { SavingOrderController } from '../saving/saving-order.controller.js';
import { SavingOrderService } from '../saving/saving-order.service.js';
import { SavingCustomerDraftService } from '../saving/saving-customer-draft.service.js';
import { BillVerificationProvider } from '../saving/bill-verification.provider.js';
import { SavingFulfillmentController } from '../saving/saving-fulfillment.controller.js';
import { SavingFulfillmentService } from '../saving/saving-fulfillment.service.js';
import {
  SavingCommentsController,
  StaffSavingCommentsController,
} from '../saving/saving-comments.controller.js';
import { SavingCommentsService } from '../saving/saving-comments.service.js';
import { SolarRequestController } from '../solar/solar-request.controller.js';
import { SolarRequestService } from '../solar/solar-request.service.js';
import {
  SolarDocumentsController,
  StaffSolarDocumentsController,
} from '../solar/solar-documents.controller.js';
import { SolarDocumentsService } from '../solar/solar-documents.service.js';
import { DocumentModule } from '../documents/document.module.js';
import {
  SolarPostalController,
  StaffSolarPostalController,
} from '../solar/solar-postal.controller.js';
import { SolarPostalService } from '../solar/solar-postal.service.js';
import { StaffSolarFinalController } from '../solar/solar-final.controller.js';
import { SolarFinalService } from '../solar/solar-final.service.js';
import { ConsultationRequestController } from '../consultation/consultation-request.controller.js';
import { ConsultationRequestService } from '../consultation/consultation-request.service.js';
import {
  StaffConsultationWorkflowController,
  CustomerConsultationWorkflowController,
} from '../consultation/consultation-workflow.controller.js';
import { ConsultationWorkflowService } from '../consultation/consultation-workflow.service.js';
import { RefundModule } from '../refund/refund.module.js';

@Module({
  imports: [
    SessionModule,
    AdminModule,
    InvoiceModule,
    DocumentModule,
    ContractModule,
    RefundModule,
  ],
  controllers: [
    OrdersController,
    ProductsController,
    ElectricityOrderController,
    ElectricityStaffReviewController,
    CustomerElectricityIncreaseController,
    StaffElectricityIncreaseController,
    CustomerElectricityPriceAdjustmentController,
    StaffElectricityPriceAdjustmentController,
    SavingOrderController,
    SavingFulfillmentController,
    SavingCommentsController,
    StaffSavingCommentsController,
    SolarRequestController,
    SolarDocumentsController,
    StaffSolarDocumentsController,
    SolarPostalController,
    StaffSolarPostalController,
    StaffSolarFinalController,
    ConsultationRequestController,
    StaffConsultationWorkflowController,
    CustomerConsultationWorkflowController,
  ],
  providers: [
    OrdersService,
    ElectricityCalculationService,
    ElectricityOrderService,
    ElectricityBillDataService,
    HttpBillDataProvider,
    ElectricityDraftService,
    ElectricityStaffReviewService,
    ElectricityIncreaseService,
    ElectricityPriceAdjustmentService,
    SavingOrderService,
    SavingCustomerDraftService,
    BillVerificationProvider,
    SavingFulfillmentService,
    SavingCommentsService,
    SolarRequestService,
    SolarDocumentsService,
    SolarPostalService,
    SolarFinalService,
    ConsultationRequestService,
    ConsultationWorkflowService,
  ],
  exports: [OrdersService, ElectricityCalculationService],
})
export class OrdersModule {}

import { Module } from '@nestjs/common'
import { SessionModule } from '../session/index.js'
import { CatalogueProductsController } from './catalogue-products.controller.js'
import { CatalogueProductsService } from './catalogue-products.service.js'

/**
 * Admin product catalogue module (S-09.12, T-09.12.01) — API slice.
 *
 * Owns the durable admin catalogue API over the products/product price
 * versions/categories/limits tables (schema from S-03.01). The tabbed
 * admin web UI (list/add/edit per type, price history, fa/en dicts,
 * RTL/a11y) is a later slice of the same epic.
 */
@Module({
  imports: [SessionModule],
  controllers: [CatalogueProductsController],
  providers: [CatalogueProductsService],
  exports: [CatalogueProductsService],
})
export class CatalogueModule {}

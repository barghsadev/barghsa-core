/**
 * AutoInvoiceService — system-generated invoices from orders (T-04.1.02.03).
 *
 * Order submission creates a linked invoice ATOMICALLY in the same DB
 * transaction (S-04.1.02 "Auto-generated invoices"). This service is the
 * seam E-03 order/contract creation calls:
 *
 *   1. load the order + its product;
 *   2. snapshot price, VAT rate, product composition and gift-code
 *      discount AT CREATION TIME (S-04.1.02 "Snapshots");
 *   3. compute lineTotal / vatAmount / totalAmount (half-up VAT on the
 *      NET taxable amount after the pre-VAT gift discount);
 *   4. persist the invoice (Draft) + its lines AND its product-composition
 *      items in ONE transaction;
 *   5. issue it (Draft → Unpaid) in the SAME transaction, writing the
 *      canonical `invoice.issue` audit entry (S-04.1.01 audit rule);
 *   6. read the result back INSIDE the transaction before returning.
 *
 * Transaction ownership (mirrors InvoiceStateMachineService.transition):
 *   - when the caller passes `client`, the service JOINS that open
 *     transaction (no BEGIN/COMMIT/ROLLBACK/release — the caller owns the
 *     full lifecycle). This is the order/contract-creation path: the
 *     invoice commits or rolls back with the order itself.
 *   - when `client` is omitted, the service opens its own transaction so
 *     it stays usable standalone (workers, retries, tests).
 *
 * Money rules: all amounts are bigint IRR; floating point is forbidden;
 * VAT is rounded half-up per line; discount is applied before VAT.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { v7 as uuidv7 } from 'uuid'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import type { TransitionResult } from './invoice-state-machine.service.js'
import type { TransactionClient } from './invoice-audit.repository.js'
import type { InvoiceState } from './invoice-state.model.js'
import { VatCalculationService } from './vat-calculation.service.js'
import type { ResolvedVatRate } from './vat-calculation.repository.js'
import {
  calculateAutoInvoice,
  type AutoInvoiceCalculation,
  type AutoInvoiceLineInput,
  type CalculatedAutoLine,
} from './auto-invoice.calculation.js'

/**
 * Default due period for auto-generated invoices (days from issue).
 * Pending T-04.1.03.01/.02 (admin-configured `service_due_periods`), an
 * auto invoice is due 7 days after issue. Callers can override via
 * `dueAt`.
 */
export const DEFAULT_AUTO_DUE_DAYS = 7

/** Command to create + issue one auto invoice from an order. */
export interface CreateAutoInvoiceCommand {
  /** The originating order (FK invoices.order_id). */
  orderId: string
  /** The user/system performing the creation (FK users.userId). */
  actorUserId: string
  /**
   * Resolved VAT rate in basis points (0..10000). When omitted, the
   * service resolves it at creation time (product override → category
   * default → 0%). The formal VAT module lands in T-04.1.02.04; this
   * seam keeps auto-invoices correct until then.
   */
  vatRateBasisPoints?: number
  /** Quantity of the ordered product. Defaults to 1 (single-product orders). */
  quantity?: number
  /** Opaque correlation ID for audit linkage. */
  correlationId?: string
  /** Human-readable reason (audited). */
  reason?: string
  /** Source IP of the requesting user; omit for system-initiated creation. */
  ip?: string
  /** Explicit due date (>= now); defaults to issuedAt + 7 days. */
  dueAt?: Date
  /** Override "now" for tests. */
  now?: Date
  /**
   * Optional caller-owned transaction client. When provided, the service
   * joins the caller's open transaction and does NOT BEGIN/COMMIT/ROLLBACK
   * or release — order/contract creation passes its client so invoice +
   * order commit atomically.
   */
  client?: TransactionClient
}

/** A persisted line as returned to the caller. */
export interface AutoInvoiceLineResult extends CalculatedAutoLine {
  id: string
  position: number
}

/** A persisted product-composition item as returned to the caller. */
export interface AutoInvoiceItemResult {
  id: string
  productId: string
  productTitle: { fa?: string | null; en?: string | null } | null
  quantity: number
  unitPrice: bigint
  vatRate: number
}

/** Result of a successful create-and-issue. */
export interface AutoInvoiceResult {
  invoiceId: string
  orderId: string
  profileId: string
  state: InvoiceState
  totalAmount: bigint
  totalDiscount: bigint
  lines: AutoInvoiceLineResult[]
  items: AutoInvoiceItemResult[]
  issuedAt: Date
  payableFrom: Date
  dueAt: Date | null
  auditId: string
  transition: TransitionResult
}

/** Row shape of the loaded order. */
interface OrderSnapshotRow {
  id: string
  profile_id: string
  product_id: string
  order_type: string
  status: string
  gift_code_id: string | null
  gift_discount_amount: string | null
  created_at: Date
}

/** Row shape of the loaded product. */
interface ProductSnapshotRow {
  id: string
  type: string
  system_key: string | null
  title: { fa?: string | null; en?: string | null } | null
  price: string | null
}

@Injectable()
export class AutoInvoiceService {
  private readonly logger = new Logger(AutoInvoiceService.name)

  constructor(
    private readonly stateMachine: InvoiceStateMachineService,
    private readonly vatCalculation: VatCalculationService,
  ) {}

  /**
   * Create and issue an auto invoice from an order, atomically with the
   * caller's transaction (when `client` is provided).
   *
   * @throws NotFoundException when the order or product does not exist.
   * @throws BadRequestException when the product has no price, the gift
   *   discount exceeds the line subtotal, the due date is in the past,
   *   or the order is cancelled.
   * @throws ConflictException when the order already has an auto invoice
   *   (runtime guard; the durable unique index lands in T-04.1.02.06).
   */
  async createInvoiceForOrder(
    cmd: CreateAutoInvoiceCommand,
  ): Promise<AutoInvoiceResult> {
    const now = cmd.now ?? new Date()
    const dueAt =
      cmd.dueAt ??
      new Date(now.getTime() + DEFAULT_AUTO_DUE_DAYS * 24 * 60 * 60 * 1000)
    if (dueAt.getTime() < now.getTime()) {
      throw new BadRequestException('dueAt cannot be in the past')
    }

    const ownsClient = !cmd.client
    // Resolve the pool only on the standalone path — the caller-client
    // path (order-creation seam) needs no pool at all.
    const pool = ownsClient ? getDbPool() : null
    const client = cmd.client
      ? (cmd.client as unknown as import('pg').PoolClient)
      : await pool!.connect()
    try {
      if (ownsClient) await client.query('BEGIN')

      // --- 1. Load the order (snapshot fields only) ---
      const orderResult = (await client.query(
        `SELECT id, profile_id, product_id, order_type, status,
                gift_code_id, gift_discount_amount, created_at
           FROM orders WHERE id = $1 FOR UPDATE`,
        [cmd.orderId],
      )) as { rows: OrderSnapshotRow[] }
      const order = orderResult.rows[0]
      if (!order) {
        throw new NotFoundException(`Order not found: ${cmd.orderId}`)
      }
      if (order.status === 'CANCELLED') {
        throw new BadRequestException(
          `Cannot auto-generate an invoice for cancelled order ${cmd.orderId}`,
        )
      }

      // --- 2. Idempotency guard: one auto invoice per order. The
      //        durable guarantee (unique order_id + type index) lands in
      //        T-04.1.02.06; this runtime check prevents duplicates today. ---
      const existing = (await client.query(
        `SELECT id FROM invoices
         WHERE order_id = $1
           AND type = 'auto'
         LIMIT 1`,
        [cmd.orderId],
      )) as { rows: Array<{ id: string }> }
      if (existing.rows.length > 0) {
        throw new ConflictException(
          `Order ${cmd.orderId} already has an auto-generated invoice (${existing.rows[0]!.id})`,
        )
      }

      // --- 3. Load the product for the price/title/type snapshot ---
      const productResult = (await client.query(
        `SELECT id, type, system_key, title, price
           FROM products WHERE id = $1`,
        [order.product_id],
      )) as { rows: ProductSnapshotRow[] }
      const product = productResult.rows[0]
      if (!product) {
        throw new NotFoundException(`Product not found: ${order.product_id}`)
      }
      if (product.price === null) {
        throw new BadRequestException(
          `Product ${product.id} has no price — cannot auto-generate an invoice`,
        )
      }

      // --- 4. Resolve the VAT rate (explicit override or in-tx default) ---
      const vatRate: { rateBasisPoints: number; source: ResolvedVatRate['source'] | 'explicit' } =
        cmd.vatRateBasisPoints !== undefined
          ? { rateBasisPoints: cmd.vatRateBasisPoints, source: 'explicit' }
          : await this.vatCalculation.resolveRate(client, {
              productId: product.id,
              category: product.type,
              at: now,
            })

      // --- 5. Pure calculation (RangeError → 400) ---
      const lineInput: AutoInvoiceLineInput = {
        productId: product.id,
        productType: product.type,
        productTitle: product.title,
        quantity: cmd.quantity ?? 1,
        unitPrice: BigInt(product.price),
        vatRate: vatRate.rateBasisPoints,
      }
      const giftDiscount =
        order.gift_discount_amount !== null
          ? BigInt(order.gift_discount_amount)
          : 0n
      let calculation: AutoInvoiceCalculation
      try {
        calculation = calculateAutoInvoice([lineInput], giftDiscount)
      } catch (err: unknown) {
        if (err instanceof RangeError) {
          throw new BadRequestException(err.message)
        }
        throw err
      }

      // --- 6. Persist the invoice + lines + items in ONE transaction ---
      const invoiceId = uuidv7()
      const metadata = JSON.stringify({
        source: 'auto',
        origin: { type: 'order', orderId: order.id },
        generatedBy: cmd.actorUserId,
        snapshot: {
          product: {
            id: product.id,
            type: product.type,
            systemKey: product.system_key,
            title: product.title,
          },
          prices: {
            unitPrice: lineInput.unitPrice.toString(),
            quantity: lineInput.quantity,
          },
          vat: {
            rateBasisPoints: vatRate.rateBasisPoints,
            source: vatRate.source,
          },
          terms: {
            orderType: order.order_type,
            createdAt: order.created_at.toISOString(),
            dueAt: dueAt.toISOString(),
          },
          gift: {
            giftCodeId: order.gift_code_id,
            discountAmount: giftDiscount.toString(),
          },
        },
        calculation: {
          lines: calculation.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice.toString(),
            lineTotal: l.lineTotal.toString(),
            discount: l.discount.toString(),
            vatRate: l.vatRate,
            vatAmount: l.vatAmount.toString(),
          })),
          totalAmount: calculation.totalAmount.toString(),
          totalDiscount: calculation.totalDiscount.toString(),
          rounding: 'half-up-to-nearest-IRR',
        },
      })

      await client.query(
        `INSERT INTO invoices (id, profile_id, order_id, contract_id, type, state,
                               total_amount, issued_at, payable_from, due_at, metadata)
         VALUES ($1, $2, $3, NULL, 'auto', 'Draft', $4, NULL, NULL, $5, $6::jsonb)`,
        [
          invoiceId,
          order.profile_id,
          order.id,
          calculation.totalAmount,
          dueAt,
          metadata,
        ],
      )

      for (const [index, line] of calculation.lines.entries()) {
        await client.query(
          `INSERT INTO invoice_lines
             (id, invoice_id, description, quantity, unit_price, line_total,
              vat_rate, vat_amount, is_taxable, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uuidv7(),
            invoiceId,
            line.description,
            line.quantity,
            line.unitPrice,
            line.lineTotal,
            line.vatRate,
            line.vatAmount,
            line.isTaxable,
            index,
          ],
        )
      }

      for (const line of calculation.lines) {
        await client.query(
          `INSERT INTO invoice_items
             (id, invoice_id, product_id, product_title, quantity, unit_price, vat_rate)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [
            uuidv7(),
            invoiceId,
            line.productId,
            JSON.stringify(line.productTitle),
            line.quantity,
            line.unitPrice,
            line.vatRate,
          ],
        )
      }

      // --- 7. Issue: Draft → Unpaid on the SAME transaction ---
      const transition = await this.stateMachine.transition(
        invoiceId,
        'Draft',
        'Unpaid',
        {
          actorUserId: cmd.actorUserId,
          // exactOptionalPropertyTypes: only spread present fields
          ...(cmd.correlationId !== undefined ? { correlationId: cmd.correlationId } : {}),
          ...(cmd.reason !== undefined ? { reason: cmd.reason } : {}),
          ...(cmd.ip !== undefined ? { ip: cmd.ip } : {}),
          now,
          client,
        },
      )

      // --- 8. Read back INSIDE the transaction (read-your-own-writes) ---
      const excerpt = await this.loadInvoiceExcerpt(client, invoiceId)

      // The lines table does not store product identity (that lives in
      // invoice_items), so overlay the in-memory calculation lines — which
      // carry productId / productType / productTitle — onto the persisted
      // read-back by position. Insertion order == read-back order
      // (ORDER BY position), so the merge is exact; the id/position come
      // from the DB, the composition fields from the calculation.
      const lines = excerpt.lines.map((persisted, index) => {
        const calc = calculation.lines[index]
        if (!calc) return persisted
        return {
          ...calc,
          id: persisted.id,
          position: persisted.position,
        }
      })

      if (ownsClient) await client.query('COMMIT')
      return { ...excerpt, lines, auditId: transition.auditId, transition }
    } catch (error) {
      if (ownsClient) await client.query('ROLLBACK').catch(() => {})
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error
      }
      this.logger.error(`Auto invoice creation failed: ${String(error)}`)
      throw error
    } finally {
      if (ownsClient) client.release()
    }
  }

  /**
   * Load one invoice (state/totals/dates) with its lines and items.
   * Queries run on the provided (transaction-scoped or pool) client.
   */
  private async loadInvoiceExcerpt(
    client: import('pg').PoolClient,
    invoiceId: string,
  ): Promise<Omit<AutoInvoiceResult, 'auditId' | 'transition'>> {
    const invoiceResult = (await client.query(
      `SELECT id, order_id, profile_id, state, total_amount,
              issued_at, payable_from, due_at
       FROM invoices WHERE id = $1`,
      [invoiceId],
    )) as {
      rows: Array<{
        id: string
        order_id: string
        profile_id: string
        state: string
        total_amount: string
        issued_at: Date | null
        payable_from: Date | null
        due_at: Date | null
      }>
    }
    const row = invoiceResult.rows[0]
    if (!row) throw new NotFoundException(`Invoice not found: ${invoiceId}`)

    const linesResult = (await client.query(
      `SELECT id, description, quantity, unit_price, line_total,
              vat_rate, vat_amount, is_taxable, position
       FROM invoice_lines
       WHERE invoice_id = $1
       ORDER BY position ASC, created_at ASC`,
      [invoiceId],
    )) as {
      rows: Array<{
        id: string
        description: string
        quantity: number
        unit_price: string
        line_total: string
        vat_rate: number
        vat_amount: string
        is_taxable: boolean
        position: number
      }>
    }

    const itemsResult = (await client.query(
      `SELECT id, product_id, product_title, quantity, unit_price, vat_rate
       FROM invoice_items
       WHERE invoice_id = $1
       ORDER BY created_at ASC, id ASC`,
      [invoiceId],
    )) as {
      rows: Array<{
        id: string
        product_id: string
        product_title: { fa?: string | null; en?: string | null } | null
        quantity: number
        unit_price: string
        vat_rate: number
      }>
    }

    return {
      invoiceId: row.id,
      orderId: row.order_id,
      profileId: row.profile_id,
      state: row.state as InvoiceState,
      totalAmount: BigInt(row.total_amount),
      totalDiscount: linesResult.rows.reduce(
        (sum, l) => sum + (BigInt(l.unit_price) * BigInt(l.quantity) - BigInt(l.line_total)),
        0n,
      ),
      lines: linesResult.rows.map((l) => ({
        id: l.id,
        description: l.description,
        productId: '',
        productType: '',
        productTitle: null,
        quantity: l.quantity,
        unitPrice: BigInt(l.unit_price),
        lineTotal: BigInt(l.line_total),
        discount: BigInt(l.unit_price) * BigInt(l.quantity) - BigInt(l.line_total),
        vatAmount: BigInt(l.vat_amount),
        vatRate: l.vat_rate,
        isTaxable: l.is_taxable,
        position: l.position,
      })),
      items: itemsResult.rows.map((it) => ({
        id: it.id,
        productId: it.product_id,
        productTitle: it.product_title,
        quantity: it.quantity,
        unitPrice: BigInt(it.unit_price),
        vatRate: it.vat_rate,
      })),
      issuedAt: row.issued_at ?? new Date(),
      payableFrom: row.payable_from ?? new Date(),
      dueAt: row.due_at,
    }
  }
}

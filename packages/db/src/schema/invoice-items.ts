import { sql } from 'drizzle-orm'
import { check, integer, jsonb, pgTable } from 'drizzle-orm/pg-core'
import { uuidv7, irrAmount, timestamptz } from '../types'
import { invoices } from './invoices'
import { products } from './products'

/**
 * Invoice items table (T-04.1.02.01).
 *
 * The product-composition snapshot of an invoice: which products were
 * invoiced, in what quantity, and at what price/VAT rate they were frozen
 * at creation time (S-04.1.02 "Snapshots": invoice stores snapshot of
 * prices, VAT rate, product composition, gift-code discount at creation).
 *
 * This complements `invoice_lines`: lines are the priced display rows
 * (including manual custom lines); items are the product composition an
 * auto-generated invoice was built from. Services like AutoInvoiceService
 * (T-04.1.02.03) write both in the same transaction.
 *
 * Snapshot semantics:
 *   - `productTitle` — localized JSONB (`{"fa": ..., "en": ...}`) frozen
 *     from `products.title` at creation, so the composition stays readable
 *     even if the product title changes later.
 *   - `unitPrice` / `vatRate` — the price and VAT rate applicable at
 *     creation time, independent of later product edits.
 *   - `productId` — FK RESTRICT: products are archive-only (never hard
 *     deleted, `product_status = archived`), so a composition row always
 *     keeps its reference.
 *
 * Deleting an invoice cascades to its items (`ON DELETE CASCADE`); the
 * DB-level constraints are declared in migration 0054.
 */
export const invoiceItems = pgTable(
  'invoice_items',
  {
    /** UUIDv7 opaque item identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Invoice this composition item belongs to; deleting the invoice
     *  deletes its items. */
    invoiceId: uuidv7('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),

    /** Product this item was composed from (archive-only, never deleted). */
    productId: uuidv7('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),

    /** Localized product title snapshot, e.g. {"fa": "برق حرارتی", "en": "Thermal Electricity"}. */
    productTitle: jsonb('product_title'),

    /** Quantity of the product on the invoice. Must be positive. */
    quantity: integer('quantity').notNull(),

    /** Unit price snapshot in IRR (int8). Never negative. */
    unitPrice: irrAmount('unit_price').notNull(),

    /** VAT rate snapshot in basis points (900 = 9.00%), 0..10000. */
    vatRate: integer('vat_rate').notNull().default(0),

    /** When the item record was created. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),

    /** When the item record was last updated. */
    updatedAt: timestamptz('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    /** Quantity must be at least 1. */
    quantityPositive: check('ck_invoice_items_quantity_positive', sql`${table.quantity} > 0`),
    /** Unit price snapshot cannot be negative. */
    unitPriceNonNegative: check(
      'ck_invoice_items_unit_price_non_negative',
      sql`${table.unitPrice} >= 0`,
    ),
    /** VAT rate snapshot must be 0..10000 basis points (0%..100%). */
    vatRateRange: check('ck_invoice_items_vat_rate_range', sql`${table.vatRate} BETWEEN 0 AND 10000`),
  }),
)

/**
 * SQL to create the invoice_items table with CHECK constraints.
 *
 * Migration source of truth (mirrors the Drizzle pgTable above);
 * applied as migration 0054. See `createInvoiceLinesTable` for the
 * rationale behind keeping the DDL in raw SQL.
 */
export const createInvoiceItemsTable = sql`
  CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    product_title JSONB,
    quantity INTEGER NOT NULL,
    unit_price BIGINT NOT NULL,
    vat_rate INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_invoice_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT ck_invoice_items_unit_price_non_negative CHECK (unit_price >= 0),
    CONSTRAINT ck_invoice_items_vat_rate_range CHECK (vat_rate BETWEEN 0 AND 10000)
  );

  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items (invoice_id);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON invoice_items (product_id);
`
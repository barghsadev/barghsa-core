import { sql } from 'drizzle-orm'
import { check, text, integer, boolean, pgTable } from 'drizzle-orm/pg-core'
import { uuidv7, irrAmount, timestamptz } from '../types'
import { invoices } from './invoices'

/**
 * Invoice lines table (T-04.1.02.01).
 *
 * One row per priced display line on an invoice — the exact column set
 * mandated by the S-04.1.02 spec:
 *   `invoiceId`, `description`, `quantity`, `unitPrice`, `lineTotal`,
 *   `vatRate`, `vatAmount`, `isTaxable`.
 *
 * Lines are the human-readable, money-carrying rows shown on the invoice
 * (manual custom lines, or derived rows for auto-generated invoices).
 * They are immutable once the invoice is issued: corrections cancel and
 * replace, they never edit issued lines (S-04.1.05).
 *
 * Money rules:
 *   - All monetary columns are signed 64-bit integers (IRR). Floating
 *     point is strictly forbidden.
 *   - `unitPrice` >= 0 — a line's unit price cannot be negative.
 *   - `lineTotal` >= 0 — the line subtotal after any per-line discount,
 *     before VAT. It is NOT constrained to `quantity * unitPrice`
 *     because discounts and half-up rounding at the line level
 *     (README §Invoices) legitimately make it differ.
 *   - `vatRate` — integer basis points, 0..10000 (0%..100%), exactly
 *     like `vat_configurations.rate` (T-09.12.02).
 *   - `vatAmount` >= 0, and a non-taxable line (`is_taxable = false`)
 *     must carry zero VAT (`vat_amount = 0`): VAT is calculated only on
 *     the net taxable amount (README §Invoices).
 *
 * Deleting an invoice cascades to its lines (`ON DELETE CASCADE`); the
 * DB-level constraints are declared in migration 0054.
 */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    /** UUIDv7 opaque line identifier. */
    id: uuidv7('id').primaryKey().notNull(),

    /** Invoice this line belongs to; deleting the invoice deletes its lines. */
    invoiceId: uuidv7('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),

    /** Human-readable line description (e.g. "برق مصرفی — دوره اردیبهشت"). */
    description: text('description').notNull(),

    /** Quantity of the priced unit. Must be positive. */
    quantity: integer('quantity').notNull(),

    /** Unit price in IRR (int8). Never negative. */
    unitPrice: irrAmount('unit_price').notNull(),

    /** Line subtotal in IRR — quantity × unitPrice after any per-line
     *  discount, before VAT. Never negative. */
    lineTotal: irrAmount('line_total').notNull(),

    /** VAT rate in basis points (900 = 9.00%), 0..10000. */
    vatRate: integer('vat_rate').notNull().default(0),

    /** VAT amount on this line in IRR. Zero when the line is not taxable. */
    vatAmount: irrAmount('vat_amount').notNull().default(sql`0::bigint`),

    /** Whether this line participates in VAT calculation. */
    isTaxable: boolean('is_taxable').notNull().default(true),

    /** When the line record was created. */
    createdAt: timestamptz('created_at').defaultNow().notNull(),

    /** When the line record was last updated. */
    updatedAt: timestamptz('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    /** Quantity must be at least 1. */
    quantityPositive: check('ck_invoice_lines_quantity_positive', sql`${table.quantity} > 0`),
    /** Unit price cannot be negative. */
    unitPriceNonNegative: check(
      'ck_invoice_lines_unit_price_non_negative',
      sql`${table.unitPrice} >= 0`,
    ),
    /** Line total cannot be negative. */
    lineTotalNonNegative: check(
      'ck_invoice_lines_line_total_non_negative',
      sql`${table.lineTotal} >= 0`,
    ),
    /** VAT rate must be 0..10000 basis points (0%..100%). */
    vatRateRange: check('ck_invoice_lines_vat_rate_range', sql`${table.vatRate} BETWEEN 0 AND 10000`),
    /** VAT amount cannot be negative. */
    vatAmountNonNegative: check(
      'ck_invoice_lines_vat_amount_non_negative',
      sql`${table.vatAmount} >= 0`,
    ),
    /** A non-taxable line must carry zero VAT. */
    nonTaxableZeroVat: check(
      'ck_invoice_lines_non_taxable_zero_vat',
      sql`${table.isTaxable} OR ${table.vatAmount} = 0`,
    ),
  }),
)

/**
 * SQL to create the invoice_lines table with CHECK constraints.
 *
 * This is the migration source of truth. The Drizzle pgTable above mirrors
 * the constraints for ORM query type safety; the raw SQL (applied as
 * migration 0054) is what actually runs against PostgreSQL. Drizzle v0.40
 * does not emit table-level CHECKs in generated migrations, so they live
 * here exactly like the invoices amount checks (migration 0052).
 */
export const createInvoiceLinesTable = sql`
  CREATE TABLE IF NOT EXISTS invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price BIGINT NOT NULL,
    line_total BIGINT NOT NULL,
    vat_rate INTEGER NOT NULL DEFAULT 0,
    vat_amount BIGINT NOT NULL DEFAULT 0,
    is_taxable BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_invoice_lines_quantity_positive CHECK (quantity > 0),
    CONSTRAINT ck_invoice_lines_unit_price_non_negative CHECK (unit_price >= 0),
    CONSTRAINT ck_invoice_lines_line_total_non_negative CHECK (line_total >= 0),
    CONSTRAINT ck_invoice_lines_vat_rate_range CHECK (vat_rate BETWEEN 0 AND 10000),
    CONSTRAINT ck_invoice_lines_vat_amount_non_negative CHECK (vat_amount >= 0),
    CONSTRAINT ck_invoice_lines_non_taxable_zero_vat CHECK (is_taxable OR vat_amount = 0)
  );

  CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines (invoice_id);
`
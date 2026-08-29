-- Migration 0054: Invoice lines & items tables (T-04.1.02.01)
--
-- Two children of `invoices` (created by migration 0052), as specified
-- by S-04.1.02 (Invoice generation, manual & automatic):
--
--   1. `invoice_lines` — the priced display lines on an invoice:
--      invoiceId, description, quantity, unitPrice, lineTotal, vatRate,
--      vatAmount, isTaxable (the exact column set from the story spec).
--   2. `invoice_items`  — the product-composition snapshot: which
--      products the invoice was built from, with quantity and frozen
--      price/VAT-rate/title snapshots at creation time.
--
-- Design decisions:
--   * FK `invoices(id)` with ON DELETE CASCADE on both — an invoice's
--     lines/items never outlive the invoice; corrections cancel+replace
--     rather than edit (S-04.1.05).
--   * FK `products(id)` with ON DELETE RESTRICT on items — products are
--     archive-only (`product_status = archived`), never hard-deleted, so
--     a composition row always keeps its reference.
--   * Money columns are BIGINT (IRR); floating point is forbidden.
--   * `vat_rate` is integer basis points, 0..10000 (0%..100%), matching
--     `vat_configurations.rate` (T-09.12.02).
--   * CHECKs on both tables (mirrored by the Drizzle pgTables and by
--     `createInvoiceLinesTable` / `createInvoiceItemsTable`):
--       quantity > 0; unit_price >= 0; vat_rate BETWEEN 0 AND 10000;
--       line_total >= 0 (lines); vat_amount >= 0 (lines);
--       a non-taxable line must carry zero VAT (lines).
--     `line_total` is deliberately NOT constrained to
--     quantity * unit_price, because per-line discounts and half-up
--     rounding at the line level are legitimate (README §Invoices).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded indexes/triggers make
-- re-runs a no-op.
--
-- Rollback:
--   DROP TABLE IF EXISTS invoice_items CASCADE;
--   DROP TABLE IF EXISTS invoice_lines CASCADE;

-- ---------------------------------------------------------------------------
-- 1. invoice_lines
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. invoice_items
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- updated_at triggers (per-table functions, same pattern as 0047)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_invoice_lines_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_lines_updated_at ON invoice_lines;
CREATE TRIGGER trg_invoice_lines_updated_at
  BEFORE UPDATE ON invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_lines_updated_at();

CREATE OR REPLACE FUNCTION update_invoice_items_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_items_updated_at ON invoice_items;
CREATE TRIGGER trg_invoice_items_updated_at
  BEFORE UPDATE ON invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_items_updated_at();
-- Barghsa Restore Verification SQL Template
-- ============================================
--
-- Copy this file to a permanent location and set VERIFY_SQL_FILE
-- to point at it. Customize the queries to reflect your application
-- schema and data integrity rules.
--
-- NOTE: The application schema (users, orders, invoices, etc.) is
-- deployed by later epics. Before those tables exist, only the
-- system-level checks in verify-restore.sh run. Uncomment queries
-- once the corresponding migrations are live.

-- ─── Data Integrity Checks ──────────────────────────────────────────────────

-- Users (Phase 1 — Epic E-02)
-- SELECT 'users' AS entity, count(*) AS row_count FROM users;
-- SELECT 'users_no_null_emails' AS check_name, count(*) AS failures
--   FROM users WHERE email IS NULL OR email = '';

-- Products (Phase 2 — Epic E-04)
-- SELECT 'products' AS entity, count(*) AS row_count FROM products;
-- SELECT 'products_valid_prices' AS check_name, count(*) AS failures
--   FROM products WHERE price IS NULL OR price <= 0;

-- Orders (Phase 2 — Epic E-04)
-- SELECT 'orders' AS entity, count(*) AS row_count FROM orders;
-- SELECT 'orders_no_null_amounts' AS check_name, count(*) AS failures
--   FROM orders WHERE total_amount IS NULL OR total_amount < 0;

-- Invoices (Phase 2 — Epic E-04)
-- SELECT 'invoices' AS entity, count(*) AS row_count FROM invoices;
-- SELECT 'invoices_valid_status' AS check_name, count(*) AS failures
--   FROM invoices WHERE status NOT IN ('draft', 'issued', 'paid', 'cancelled');

-- ─── Referential Integrity ───────────────────────────────────────────────────

-- SELECT 'orders_orphaned' AS check_name, count(*) AS failures
--   FROM orders o LEFT JOIN users u ON o.user_id = u.id
--   WHERE u.id IS NULL;

-- SELECT 'invoices_orphaned' AS check_name, count(*) AS failures
--   FROM invoices i LEFT JOIN orders o ON i.order_id = o.id
--   WHERE o.id IS NULL;

-- ─── Financial Integrity ─────────────────────────────────────────────────────

-- SELECT 'wallet_total_matches' AS check_name,
--   CASE WHEN abs(sum(balance) - (SELECT sum(amount) FROM wallet_transactions)) < 0.01
--     THEN 'ok' ELSE 'mismatch' END AS result
--   FROM wallets;

-- SELECT 'no_negative_balance' AS check_name, count(*) AS failures
--   FROM wallets WHERE balance < 0;

-- ─── Sequential Consistency ──────────────────────────────────────────────────

-- SELECT 'invoice_sequence_gap' AS check_name, count(*) AS gaps
--   FROM (
--     SELECT invoice_number,
--            lag(invoice_number) OVER (ORDER BY invoice_number) AS prev
--     FROM invoices
--   ) sub
--   WHERE prev IS NOT NULL AND invoice_number != prev + 1;

-- ─── Timestamp Sanity ────────────────────────────────────────────────────────

-- SELECT 'users_future_created' AS check_name, count(*) AS failures
--   FROM users WHERE created_at > now();\n

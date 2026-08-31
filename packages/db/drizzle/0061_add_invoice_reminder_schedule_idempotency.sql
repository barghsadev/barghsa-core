-- Migration 0061: invoice_reminder_schedule idempotency unique index
-- (T-04.1.04.04)
--
-- Guarantee: the same reminder is never planned twice. S-04.1.04
-- requires reminders to be idempotent per (invoice, offset, channel),
-- so the database must refuse a second row for that triple.
--
--   * uq_invoice_reminder_schedule_invoice_offset_channel — UNIQUE
--     index on (invoice_id, "offset", channel). `"offset"` is quoted
--     because OFFSET is a reserved word.
--
-- Existing duplicates (possible before this index existed) are collapsed
-- first, keeping the most progressed row: `sent` over `scheduled` over
-- `cancelled`, then earliest `created_at`, then smallest `id`. CREATE
-- UNIQUE INDEX also fails loudly if duplicates remain, which is the
-- desired fail-safe.
--
-- Idempotency: the DELETE is a no-op when every triple already has one
-- row; CREATE UNIQUE INDEX IF NOT EXISTS makes re-runs safe.
--
-- Rollback:
--   DROP INDEX IF EXISTS uq_invoice_reminder_schedule_invoice_offset_channel;

DELETE FROM invoice_reminder_schedule
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY invoice_id, "offset", channel
              ORDER BY
                CASE status
                  WHEN 'sent' THEN 0
                  WHEN 'scheduled' THEN 1
                  ELSE 2
                END,
                created_at ASC,
                id ASC
            ) AS rn
       FROM invoice_reminder_schedule
   ) ranked
   WHERE rn > 1
 );

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_reminder_schedule_invoice_offset_channel
  ON invoice_reminder_schedule (invoice_id, "offset", channel);

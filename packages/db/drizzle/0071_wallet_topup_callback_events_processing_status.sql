-- Migration 0071: processing status on wallet_topup_callback_events
-- (T-04.2.02.02) — expand phase
--
-- The callback handler must claim `event_id` before gateway verify or
-- WalletService.credit(). A durable `processing` row is that claim:
-- INSERT … ON CONFLICT DO NOTHING RETURNING distinguishes first delivery
-- from replay, and a crash can resume the same pending order instead of
-- skipping credit. Terminal outcomes stay credited / unpaid / duplicate.
--
-- Expand: widen chk_wallet_topup_callback_events_status to include
-- `processing`. No contract phase — this only adds an allowed value.
--
-- Guard: no-op when the table is missing (pre-0070 schema).
-- Idempotent: DROP CONSTRAINT IF EXISTS then ADD the widened CHECK.
--
-- Rollback:
--   DELETE FROM wallet_topup_callback_events WHERE status = 'processing';
--   ALTER TABLE wallet_topup_callback_events
--     DROP CONSTRAINT IF EXISTS chk_wallet_topup_callback_events_status;
--   ALTER TABLE wallet_topup_callback_events
--     ADD CONSTRAINT chk_wallet_topup_callback_events_status
--     CHECK (status IN ('credited', 'unpaid', 'duplicate'));

DO $$
BEGIN
  IF to_regclass('wallet_topup_callback_events') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE wallet_topup_callback_events
    DROP CONSTRAINT IF EXISTS chk_wallet_topup_callback_events_status;

  ALTER TABLE wallet_topup_callback_events
    ADD CONSTRAINT chk_wallet_topup_callback_events_status
    CHECK (status IN ('processing', 'credited', 'unpaid', 'duplicate'));
END $$;

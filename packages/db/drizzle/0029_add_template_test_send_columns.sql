-- Migration 0029: Add test-send tracking columns to notification_templates (T-05.04.04)
--
-- Records the outcome of the admin "test-send" action on each template version:
--   - last_test_sent_at  TIMESTAMPTZ nullable — when the admin last test-sent this version
--   - last_test_status   TEXT nullable — 'delivered' | 'failed', outcome of that attempt
--
-- These columns are purely additive/monitoring: they do not affect template
-- selection, rendering, or delivery. NULL until the first test-send.
--
-- Rollback:
--   ALTER TABLE notification_templates DROP COLUMN last_test_status;
--   ALTER TABLE notification_templates DROP COLUMN last_test_sent_at;

ALTER TABLE notification_templates
  ADD COLUMN IF NOT EXISTS last_test_sent_at TIMESTAMPTZ;

ALTER TABLE notification_templates
  ADD COLUMN IF NOT EXISTS last_test_status TEXT
  CHECK (last_test_status IN ('delivered', 'failed'));

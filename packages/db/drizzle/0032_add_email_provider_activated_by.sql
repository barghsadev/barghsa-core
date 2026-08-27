-- Migration 0032: Add activated_by to email_provider_configs (T-05.06.04)
--
-- The admin UI must display the admin who activated an email provider
-- configuration (activated_by metadata). Add a nullable FK column so an
-- active provider can report who promoted it to active, in addition to the
-- existing created_by (who created the row).
--
-- Rollback:
--   ALTER TABLE email_provider_configs DROP COLUMN activated_by;

ALTER TABLE email_provider_configs
  ADD COLUMN IF NOT EXISTS activated_by TEXT REFERENCES users(user_id) ON DELETE RESTRICT;
-- Expand only. Existing branding rows and publication identities are preserved.
-- The application uses this value only after the migration transaction commits.
ALTER TYPE brand_config_status ADD VALUE IF NOT EXISTS 'superseded';

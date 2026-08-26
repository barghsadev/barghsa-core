-- Migration 0013: seed default profile_verification_mode config entry
-- T-07.01.01 Admin profile verification mode setting.
-- Options: DISABLED (no verification), MANUAL (staff verifies), API (auto via official APIs).

INSERT INTO app_config (key, value, version, updated_at)
VALUES ('profile_verification_mode', '"DISABLED"'::jsonb, 1, NOW())
ON CONFLICT (key) DO NOTHING;

-- Bump the global config version so the cache is invalidated
UPDATE config_version SET version = version + 1, updated_at = NOW() WHERE id = 'global';
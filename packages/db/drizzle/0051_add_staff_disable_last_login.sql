-- Migration 0051: Staff account status & last login (T-10.01.01)
--
-- Admin staff management (E-10, T-10.01.01):
--   * disabled_at  TIMESTAMPTZ — nullable; NULL = account active. When set,
--     the account is disabled: login is rejected, password reset is
--     rejected, refresh tokens are unusable (they are consumed at disable
--     time and the refresh path re-checks this column), and all active
--     sessions are revoked.
--   * last_login_at TIMESTAMPTZ — nullable; set on every successful login
--     (password + OTP flows). Used by the admin staff list to show when a
--     staff member last signed in.
--
-- Backward compatible: both columns are nullable additions; no existing
-- row is modified, no constraint is added, and no query that does not
-- reference them is affected.

ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_disabled_at ON users (disabled_at);
CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users (last_login_at);
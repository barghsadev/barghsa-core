-- Migration 0004: Add step_up_verified_at to sessions (T-02.02.04)
--
-- Adds a nullable timestamp column that records when the user last
-- performed step-up authentication (password/OTP re-verification).
-- The StepUpGuard checks this timestamp against a configured window
-- (default 15 min) and rejects requests where it has expired.

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS step_up_verified_at TIMESTAMPTZ;

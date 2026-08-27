-- Migration 0036: Dual-approval request entity (T-09.07.02)
--
-- A financial action (refund, manual adjustment, bank payment confirmation)
-- whose amount exceeds the admin-configured dual-approval threshold
-- (T-09.07.01, app_config key finance.dual_approval_threshold) is recorded
-- here in the `pending` state. A second authorized user — different from the
-- initiator — resolves it by approving or rejecting. Both the initiation and
-- the resolution are also written to audit_log (events:
-- approval_request_created / approval_request_approved /
-- approval_request_rejected) for the durable trail; this table carries the
-- live state, audit_log carries the history.
--
-- Row layout:
--   id                UUID PK (uuidv7)
--   action_type       'refund' | 'manual_adjustment' | 'bank_payment_confirmation'
--   amount_irr        BIGINT IRR amount (> 0)
--   initiator_id      FK users.user_id — the user initiating the financial action
--   reason            human-readable reason for the action
--   details           JSONB optional transaction details
--   status            'pending' | 'approved' | 'rejected', default 'pending'
--   reviewer_id       FK users.user_id (SET NULL on delete — audit survives)
--   review_reason     mandatory on reject, optional on approve
--   reviewed_at       when the request left the pending state
--   created_at / updated_at
--
-- Service-layer invariants (DualApprovalService, T-09.07.02):
--   - a request can never be resolved by its own initiator,
--   - a resolved request can never be re-resolved (409),
--   - a rejection always carries a reason.
--
-- Rollback:
--   DROP TABLE IF EXISTS approval_requests;

CREATE TABLE IF NOT EXISTS approval_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  action_type   TEXT NOT NULL,
  amount_irr    BIGINT NOT NULL,
  initiator_id  TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  reason        TEXT NOT NULL,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending',
  reviewer_id   TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  review_reason TEXT,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Financial actions subject to dual approval (T-09.07.01).
ALTER TABLE approval_requests
  ADD CONSTRAINT chk_ar_action_type
  CHECK (action_type IN ('refund', 'manual_adjustment', 'bank_payment_confirmation'));

-- Amounts are positive IRR integers only.
ALTER TABLE approval_requests
  ADD CONSTRAINT chk_ar_amount_positive
  CHECK (amount_irr > 0);

-- Lifecycle states of the dual-approval workflow.
ALTER TABLE approval_requests
  ADD CONSTRAINT chk_ar_status
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- The pending queue is the hot read path (GET /api/admin/approval-requests).
CREATE INDEX IF NOT EXISTS idx_approval_requests_status
  ON approval_requests (status);
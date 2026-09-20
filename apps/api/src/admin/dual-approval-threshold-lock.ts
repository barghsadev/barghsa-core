import type { DualApprovalQueryClient } from './dual-approval-resolution.js';

/**
 * Serialize absent-row creation too; readers retain one policy until commit.
 * Acquire before staff/session locks, so a waiting config writer cannot block
 * receipt notifications through the recipient user foreign key.
 */
export async function lockDualApprovalThreshold(
  client: DualApprovalQueryClient,
  mode: 'read' | 'write'
) {
  await client.query(
    mode === 'write'
      ? "SELECT pg_advisory_xact_lock(hashtext('finance.dual_approval_threshold'))"
      : "SELECT pg_advisory_xact_lock_shared(hashtext('finance.dual_approval_threshold'))"
  );
}

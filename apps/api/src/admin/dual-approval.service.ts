import { Injectable, Logger, HttpException } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  DEFAULT_DUAL_APPROVAL_CONFIG,
  toDualApprovalConfig,
  shouldRequireDualApproval,
  validateApprovalRequestInput,
  toApprovalRequestInput,
  isApprovalRequestStatus,
  APPROVAL_REVIEW_REASON_MAX_LENGTH,
  APPROVAL_ACTION_TYPES,
  type ApprovalActionType,
  type ApprovalRequestStatus,
} from '@barghsa/shared/finance'
import { ErrorCodes } from '@barghsa/shared/errors'
import { NotificationsService } from '../notifications/notifications.service.js'

/**
 * The financial actions covered by the dual-approval workflow, exposed for
 * the controller's OpenAPI enum documentation.
 */
export const DUAL_APPROVAL_ACTION_TYPES = APPROVAL_ACTION_TYPES

/**
 * A dual-approval request as returned by the admin API (S-09.07, T-09.07.02).
 */
export interface ApprovalRequestDto {
  id: string
  actionType: ApprovalActionType
  amountIrR: number
  initiatorId: string
  initiatorUsername: string | null
  reason: string
  details: Record<string, unknown> | null
  status: ApprovalRequestStatus
  reviewerId: string | null
  reviewerUsername: string | null
  reviewReason: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Options for the pending-approvals queue view. */
export interface ListApprovalRequestsOptions {
  status?: ApprovalRequestStatus
  limit?: number
  offset?: number
}

const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

/**
 * Dual-approval workflow service (S-09.07, T-09.07.02).
 *
 * Owns the approval-request lifecycle:
 *
 * - {@link createApprovalRequest} — initiation. Only financial actions that
 *   actually exceed the configured threshold (T-09.07.01) can enter Pending
 *   Approval; when the threshold is disabled (`0`) or the amount does not
 *   exceed it, creation is rejected so the workflow can never be
 *   circumvented by initiating below-threshold requests.
 * - {@link listApprovalRequests} — the pending-approval queue view.
 * - {@link approveApprovalRequest}/{@link rejectApprovalRequest} — resolution
 *   by a second authorized user. A request can only be resolved by a user
 *   different from its initiator, only while `pending`, and a rejection
 *   always requires a reason.
 *
 * Every transition writes an `audit_log` row (approval_request_created /
 * approval_request_approved / approval_request_rejected) in the same
 * transaction as the state change, so the audit trail can never diverge from
 * the live state.
 *
 * Notifications are delivered in-app (best-effort after commit): eligible
 * staff (today: platform admins, mirroring the S-09.07 permission gate, since
 * granular staff-role permissions are not yet resolved into sessions) are
 * notified on initiation, and the initiator is notified of the decision.
 */
@Injectable()
export class DualApprovalService {
  private readonly logger = new Logger(DualApprovalService.name)

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Initiate a dual-approval request.
   *
   * @throws HttpException 400 when the payload is invalid or the action does
   *   not require dual approval under the current threshold.
   */
  async createApprovalRequest(
    input: unknown,
    initiatorUserId: string,
    ip: string,
  ): Promise<ApprovalRequestDto> {
    const validation = validateApprovalRequestInput(input)
    if (!validation.ok) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: validation.issues.join('; '),
        },
        400,
      )
    }

    const normalized = toApprovalRequestInput(input)
    const threshold = await this.getThresholdConfig()

    if (!shouldRequireDualApproval(threshold, normalized.amountIrR)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message:
            'Dual approval is disabled or the amount does not exceed the configured threshold',
        },
        400,
      )
    }

    const pool = getDbPool()
    const id = uuidv7()
    const now = new Date()
    const correlationId = uuidv7()
    const details = normalized.details ?? {}

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `INSERT INTO approval_requests
           (id, action_type, amount_irr, initiator_id, reason, details, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending', $7, $7)`,
        [
          id,
          normalized.actionType,
          normalized.amountIrR,
          initiatorUserId,
          normalized.reason,
          JSON.stringify(details),
          now,
        ],
      )

      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          uuidv7(),
          initiatorUserId,
          'approval_request_created',
          JSON.stringify({
            requestId: id,
            actionType: normalized.actionType,
            amountIrR: normalized.amountIrR,
            thresholdIrR: threshold.thresholdIrR,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to create approval request: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code, message: 'Failed to create approval request' },
        500,
      )
    } finally {
      client.release()
    }

    this.logger.log(
      `Approval request ${id} created by ${initiatorUserId} (${normalized.actionType}, IRR ${normalized.amountIrR})`,
    )

    // Best-effort in-app notification to approval-eligible staff.
    await this.notifyEligibleStaff(
      id,
      normalized.actionType,
      normalized.amountIrR,
      initiatorUserId,
    )

    return this.getRequestDto(id)
  }

  /**
   * Pending-approval queue view. Optionally filtered by status, ordered most
   * recent first.
   */
  async listApprovalRequests(
    options: ListApprovalRequestsOptions = {},
  ): Promise<ApprovalRequestDto[]> {
    const limit = sanitizeLimit(options.limit)
    const offset = sanitizeOffset(options.offset)
    const status = options.status ?? null

    if (status !== null && !isApprovalRequestStatus(status)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'status must be one of pending, approved, rejected',
        },
        400,
      )
    }

    const pool = getDbPool()
    const result = await pool.query(
      `SELECT ar.*, initiator.username AS initiator_username, reviewer.username AS reviewer_username
       FROM approval_requests ar
       LEFT JOIN users initiator ON initiator.user_id = ar.initiator_id
       LEFT JOIN users reviewer ON reviewer.user_id = ar.reviewer_id
       WHERE ($1::text IS NULL OR ar.status = $1)
       ORDER BY ar.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    )

    return result.rows.map(toApprovalRequestDto)
  }

  /**
   * Approve a pending dual-approval request.
   *
   * @throws 404 when the request does not exist, 409 when it is already
   *   resolved, 403 when the reviewer is the initiator.
   */
  async approveApprovalRequest(
    requestId: string,
    reviewerUserId: string,
    ip: string,
  ): Promise<ApprovalRequestDto> {
    return this.resolveRequest(requestId, reviewerUserId, ip, 'approve', null)
  }

  /**
   * Reject a pending dual-approval request. A reason is mandatory.
   *
   * @throws 400 when the reason is missing/overlong, 404 when the request
   *   does not exist, 409 when it is already resolved, 403 when the reviewer
   *   is the initiator.
   */
  async rejectApprovalRequest(
    requestId: string,
    reviewerUserId: string,
    ip: string,
    reason: unknown,
  ): Promise<ApprovalRequestDto> {
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'reason is required when rejecting an approval request',
        },
        400,
      )
    }
    if (reason.length > APPROVAL_REVIEW_REASON_MAX_LENGTH) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: `reason must not exceed ${APPROVAL_REVIEW_REASON_MAX_LENGTH} characters`,
        },
        400,
      )
    }
    return this.resolveRequest(requestId, reviewerUserId, ip, 'reject', reason)
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /** Read the current dual-approval threshold (disabled default when unset). */
  private async getThresholdConfig(): Promise<{ thresholdIrR: number }> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT value FROM app_config WHERE key = $1`,
      [DUAL_APPROVAL_THRESHOLD_CONFIG_KEY],
    )
    if (result.rows.length === 0) return { ...DEFAULT_DUAL_APPROVAL_CONFIG }
    return toDualApprovalConfig(result.rows[0]!.value)
  }

  /**
   * Shared resolution path for approve/reject. All state transitions and
   * their audit rows commit atomically, so a concurrent race between two
   * reviewers can never produce two audit records for one resolution.
   */
  private async resolveRequest(
    requestId: string,
    reviewerUserId: string,
    ip: string,
    decision: 'approve' | 'reject',
    reviewReason: string | null,
  ): Promise<ApprovalRequestDto> {
    const pool = getDbPool()
    const now = new Date()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const result = await client.query(
        `SELECT ar.*, initiator.username AS initiator_username, reviewer.username AS reviewer_username
         FROM approval_requests ar
         LEFT JOIN users initiator ON initiator.user_id = ar.initiator_id
         LEFT JOIN users reviewer ON reviewer.user_id = ar.reviewer_id
         WHERE ar.id = $1
         FOR UPDATE`,
        [requestId],
      )

      const row = result.rows[0] as
        | (Record<string, unknown> & { initiator_id: string; status: string })
        | undefined

      if (!row) {
        await client.query('ROLLBACK')
        throw new HttpException(
          { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Approval request not found' },
          404,
        )
      }

      if (row.status !== 'pending') {
        await client.query('ROLLBACK')
        throw new HttpException(
          {
            statusCode: 409,
            error: ErrorCodes.CONFLICT_STATE.code,
            message: `Approval request is already ${row.status}`,
          },
          409,
        )
      }

      if (row.initiator_id === reviewerUserId) {
        await client.query('ROLLBACK')
        throw new HttpException(
          {
            statusCode: 403,
            error: ErrorCodes.AUTHZ_FORBIDDEN.code,
            message: 'A user cannot approve or reject their own approval request',
          },
          403,
        )
      }

      const newStatus = decision === 'approve' ? 'approved' : 'rejected'
      await client.query(
        `UPDATE approval_requests
         SET status = $1, reviewer_id = $2, review_reason = $3, reviewed_at = $4, updated_at = $4
         WHERE id = $5`,
        [newStatus, reviewerUserId, reviewReason, now, requestId],
      )

      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          uuidv7(),
          reviewerUserId,
          decision === 'approve' ? 'approval_request_approved' : 'approval_request_rejected',
          JSON.stringify({
            requestId,
            actionType: row.action_type,
            amountIrR: row.amount_irr,
            initiatorUserId: row.initiator_id,
            reviewerUserId,
            ...(reviewReason !== null ? { reviewReason } : {}),
          }),
          uuidv7(),
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.log(
        `Approval request ${requestId} ${decision}d by ${reviewerUserId}`,
      )

      // Best-effort in-app notification to the initiator.
      await this.notifyInitiator(requestId, row.initiator_id, decision, reviewReason)
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to notify initiator of approval decision: ${String(error)}`,
          )
        })

      return toApprovalRequestDto({ ...row, ...this.applyResolution(row, newStatus, reviewerUserId, reviewReason, now) })
    } catch (error) {
      if (error instanceof HttpException) throw error
      await client.query('ROLLBACK').catch(() => {})
      this.logger.error(`Failed to resolve approval request: ${String(error)}`)
      throw new HttpException(
        { statusCode: 500, error: ErrorCodes.INTERNAL_SERVER.code, message: 'Failed to resolve approval request' },
        500,
      )
    } finally {
      client.release()
    }
  }

  /** Merge the resolution columns into the pre-update row for the DTO. */
  private applyResolution(
    row: Record<string, unknown>,
    status: ApprovalRequestStatus,
    reviewerId: string,
    reviewReason: string | null,
    now: Date,
  ): Record<string, unknown> {
    return {
      status,
      reviewer_id: reviewerId,
      review_reason: reviewReason,
      reviewed_at: now,
    }
  }

  /** Fetch a single request by id (post-commit read for the DTO). */
  private async getRequestDto(id: string): Promise<ApprovalRequestDto> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT ar.*, initiator.username AS initiator_username, reviewer.username AS reviewer_username
       FROM approval_requests ar
       LEFT JOIN users initiator ON initiator.user_id = ar.initiator_id
       LEFT JOIN users reviewer ON reviewer.user_id = ar.reviewer_id
       WHERE ar.id = $1`,
      [id],
    )
    if (result.rows.length === 0) {
      throw new HttpException(
        { statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code, message: 'Approval request not found' },
        404,
      )
    }
    return toApprovalRequestDto(result.rows[0]!)
  }

  /**
   * Notify all approval-eligible staff (in-app) about a new request.
   *
   * Eligibility today mirrors the S-09.07 permission gate: platform admins
   * (`is_admin`). When granular staff-role permissions land in the session,
   * this must be extended to users holding `admin:financial:edit` via a
   * role, excluding the initiator either way.
   */
  private async notifyEligibleStaff(
    requestId: string,
    actionType: ApprovalActionType,
    amountIrR: number,
    initiatorUserId: string,
  ): Promise<void> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT user_id FROM users WHERE is_admin = TRUE AND user_id <> $1`,
      [initiatorUserId],
    )

    const title = 'درخواست تأیید دومرحلهای جدید'
    const body =
      `مبلغ ${amountIrR} ریال — ${actionType} نیاز به تأیید دومرحلهای دارد. ` +
      'در صف تأیید بررسی کنید.'
    const link = '/app/admin/approval-requests'

    for (const row of result.rows as { user_id: string }[]) {
      await this.notificationsService
        .create({ userId: row.user_id, type: 'general', title, body, link })
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to notify user ${row.user_id} about approval request ${requestId}: ${String(error)}`,
          )
        })
    }
  }

  /** Notify the initiator (in-app) about a decision on their request. */
  private async notifyInitiator(
    requestId: string,
    initiatorUserId: string,
    decision: 'approve' | 'reject',
    reviewReason: string | null,
  ): Promise<void> {
    await this.notificationsService.create({
      userId: initiatorUserId,
      type: 'general',
      title:
        decision === 'approve' ? 'درخواست تأیید شد' : 'درخواست تأیید رد شد',
      body:
        decision === 'approve'
          ? `درخواست تأیید دومرحلهای شما (${requestId}) تأیید شد.`
          : `درخواست تأیید دومرحلهای شما (${requestId}) رد شد. دلیل: ${reviewReason ?? 'نامشخص'}`,
      link: '/app/admin/approval-requests',
    })
  }
}

// ─── Row mapping helpers ─────────────────────────────────────────────────

/** Map a raw pg row to the API DTO (BIGINT amounts arrive as strings). */
export function toApprovalRequestDto(
  row: Record<string, unknown>,
): ApprovalRequestDto {
  const createdAt =
    row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at))
  const updatedAt =
    row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at))
  const reviewedAt =
    row.reviewed_at === null || row.reviewed_at === undefined
      ? null
      : row.reviewed_at instanceof Date
        ? row.reviewed_at
        : new Date(String(row.reviewed_at))

  return {
    id: String(row.id),
    actionType: row.action_type as ApprovalActionType,
    amountIrR: Number(row.amount_irr),
    initiatorId: String(row.initiator_id),
    initiatorUsername:
      row.initiator_username === null || row.initiator_username === undefined
        ? null
        : String(row.initiator_username),
    reason: String(row.reason),
    details:
      row.details === null || row.details === undefined
        ? null
        : (row.details as Record<string, unknown>),
    status: row.status as ApprovalRequestStatus,
    reviewerId:
      row.reviewer_id === null || row.reviewer_id === undefined
        ? null
        : String(row.reviewer_id),
    reviewerUsername:
      row.reviewer_username === null || row.reviewer_username === undefined
        ? null
        : String(row.reviewer_username),
    reviewReason:
      row.review_reason === null || row.review_reason === undefined
        ? null
        : String(row.review_reason),
    reviewedAt: reviewedAt === null ? null : reviewedAt.toISOString(),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  }
}

/** Clamp a list limit to the documented bounds. */
export function sanitizeLimit(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LIST_LIMIT
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_LIST_LIMIT
  return Math.min(raw, MAX_LIST_LIMIT)
}

/** Clamp a list offset to a non-negative integer. */
export function sanitizeOffset(raw: number | undefined): number {
  if (raw === undefined || !Number.isInteger(raw) || raw < 0) return 0
  return raw
}
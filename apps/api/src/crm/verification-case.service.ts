import { Injectable, Logger } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'

// ── Result types ─────────────────────────────────────────────────────

export type CreateVerificationCaseResult =
  | { success: true; id: string; status: string; createdAt: string }
  | { error: string }
  | null

export type ListVerificationCasesResult =
  | { cases: VerificationCaseListItem[]; total: number }
  | { error: string }

export type GetVerificationCaseResult =
  | VerificationCaseDetail
  | { error: string }
  | null

export type ReviewVerificationCaseResult =
  | { success: true; id: string; status: string; profileId: string }
  | { error: string }
  | null

export interface VerificationCaseListItem {
  id: string
  profileId: string
  fieldName: string
  requestedValue: string
  reason: string
  status: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface VerificationCaseDetail {
  id: string
  profileId: string
  profileType: string
  fieldName: string
  currentValue: string | null
  requestedValue: string
  evidenceUrls: string[]
  reason: string
  status: string
  createdBy: string
  createdAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewerNotes: string | null
  updatedAt: string
}

/** Allowed status transitions for a verification case. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Open: ['Under Review', 'Rejected'],
  'Under Review': ['Approved', 'Rejected'],
  Approved: [],
  Rejected: [],
}

/** Identity fields that require a verification case for correction. */
const IDENTITY_FIELDS_INDIVIDUAL = ['first_name', 'last_name', 'national_id']
const IDENTITY_FIELDS_LEGAL = ['legal_name', 'national_identifier']

/**
 * Maps a DB column name to its human-readable label.
 */
const FIELD_LABELS: Record<string, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  national_id: 'National ID',
  legal_name: 'Legal Name',
  national_identifier: 'National Identifier',
}

@Injectable()
export class VerificationCaseService {
  private readonly logger = new Logger(VerificationCaseService.name)

  /**
   * Creates a verification case for correcting an identity field.
   *
   * Staff cannot directly edit verified identity fields. Instead, they
   * create a case with the new value and evidence, which a reviewer
   * must approve before the change takes effect.
   */
  async createCase(
    profileId: string,
    dto: {
      fieldName: string
      currentValue: string | null
      requestedValue: string
      evidenceUrls?: string[]
      reason: string
    },
    actorUserId: string,
    ip: string,
  ): Promise<CreateVerificationCaseResult> {
    const pool = getDbPool()

    // 1. Fetch the profile to verify existence and get its type
    const profileResult = await pool.query(
      `SELECT id, profile_type, status FROM profiles WHERE id = $1`,
      [profileId],
    )
    if (profileResult.rows.length === 0) return null

    const profileRow = profileResult.rows[0] as Record<string, unknown>
    const profileType = profileRow.profile_type as string

    // 2. Validate the field name is a known identity field for this profile type
    const allowedFields =
      profileType === 'LEGAL' ? IDENTITY_FIELDS_LEGAL : IDENTITY_FIELDS_INDIVIDUAL
    if (!allowedFields.includes(dto.fieldName)) {
      return {
        error: `'${dto.fieldName}' is not a valid identity field for ${profileType} profiles. ` +
          `Allowed: ${allowedFields.join(', ')}`,
      }
    }

    // 3. Validate required fields
    if (!dto.requestedValue || dto.requestedValue.trim() === '') {
      return { error: 'requestedValue is required' }
    }
    if (!dto.reason || dto.reason.trim() === '') {
      return { error: 'reason is required' }
    }

    // 4. Check for existing Open case on same field (prevent duplicates)
    const existingResult = await pool.query(
      `SELECT id FROM verification_cases WHERE profile_id = $1 AND field_name = $2 AND status = 'Open'`,
      [profileId, dto.fieldName],
    )
    if (existingResult.rows.length > 0) {
      return {
        error: `An open verification case already exists for '${FIELD_LABELS[dto.fieldName] ?? dto.fieldName}' on this profile`,
      }
    }

    const now = new Date().toISOString()
    const caseId = uuidv7()
    const correlationId = uuidv7()
    const evidenceJson = JSON.stringify(dto.evidenceUrls ?? [])

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Insert the verification case
      await client.query(
        `INSERT INTO verification_cases (id, profile_id, field_name, current_value, requested_value, evidence_urls, reason, status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Open', $8, $9::timestamptz, $10::timestamptz)`,
        [
          caseId,
          profileId,
          dto.fieldName,
          dto.currentValue,
          dto.requestedValue.trim(),
          evidenceJson,
          dto.reason.trim(),
          actorUserId,
          now,
          now,
        ],
      )

      // Record audit event
      const auditId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz)`,
        [
          auditId,
          actorUserId,
          'verification_case_created',
          JSON.stringify({
            caseId,
            profileId,
            fieldName: dto.fieldName,
            currentValue: dto.currentValue,
            requestedValue: dto.requestedValue.trim(),
            reason: dto.reason.trim(),
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.debug(
        `Verification case ${caseId} created: profileId=${profileId}, field=${dto.fieldName}, actor=${actorUserId}`,
      )

      return { success: true, id: caseId, status: 'Open', createdAt: now }
    } catch (err) {
      await client.query('ROLLBACK')
      this.logger.error(`Failed to create verification case: ${String(err)}`)
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * Lists verification cases. Defaults to all Open cases for the review queue.
   * Staff with crm:edit-identity permission (or admin) see the queue.
   */
  async listCases(params: {
    status?: string | undefined
    profileId?: string | undefined
    createdBy?: string | undefined
    limit: number
    offset: number
  }): Promise<ListVerificationCasesResult> {
    const pool = getDbPool()

    const conditions: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (params.status) {
      conditions.push(`status = $${paramIndex++}`)
      values.push(params.status)
    }
    if (params.profileId) {
      conditions.push(`profile_id = $${paramIndex++}`)
      values.push(params.profileId)
    }
    if (params.createdBy) {
      conditions.push(`created_by = $${paramIndex++}`)
      values.push(params.createdBy)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM verification_cases ${whereClause}`,
      values,
    )
    const total = (countResult.rows[0] as Record<string, unknown>).cnt as number

    const dataResult = await pool.query(
      `SELECT id, profile_id, field_name, requested_value, reason, status, created_by,
              created_at AT TIME ZONE 'UTC' AS created_at,
              updated_at AT TIME ZONE 'UTC' AS updated_at
       FROM verification_cases
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...values, params.limit, params.offset],
    )

    const cases: VerificationCaseListItem[] = dataResult.rows.map(
      (row: Record<string, unknown>) => ({
        id: row.id as string,
        profileId: row.profile_id as string,
        fieldName: row.field_name as string,
        requestedValue: row.requested_value as string,
        reason: row.reason as string,
        status: row.status as string,
        createdBy: row.created_by as string,
        createdAt: (row.created_at as string) ?? '',
        updatedAt: (row.updated_at as string) ?? '',
      }),
    )

    return { cases, total }
  }

  /**
   * Gets a single verification case with full detail (including evidence).
   */
  async getCase(
    caseId: string,
  ): Promise<GetVerificationCaseResult> {
    const pool = getDbPool()

    const result = await pool.query(
      `SELECT v.id, v.profile_id, p.profile_type, v.field_name, v.current_value,
              v.requested_value, v.evidence_urls, v.reason, v.status,
              v.created_by, v.created_at AT TIME ZONE 'UTC' AS created_at,
              v.reviewed_by, v.reviewed_at AT TIME ZONE 'UTC' AS reviewed_at,
              v.reviewer_notes,
              v.updated_at AT TIME ZONE 'UTC' AS updated_at
       FROM verification_cases v
       JOIN profiles p ON p.id = v.profile_id
       WHERE v.id = $1`,
      [caseId],
    )

    if (result.rows.length === 0) return null

    const row = result.rows[0] as Record<string, unknown>

    let evidenceUrls: string[] = []
    try {
      const parsed = JSON.parse((row.evidence_urls as string) ?? '[]')
      evidenceUrls = Array.isArray(parsed) ? parsed : []
    } catch {
      evidenceUrls = []
    }

    return {
      id: row.id as string,
      profileId: row.profile_id as string,
      profileType: row.profile_type as string,
      fieldName: row.field_name as string,
      currentValue: (row.current_value as string) ?? null,
      requestedValue: row.requested_value as string,
      evidenceUrls,
      reason: row.reason as string,
      status: row.status as string,
      createdBy: row.created_by as string,
      createdAt: (row.created_at as string) ?? '',
      reviewedBy: (row.reviewed_by as string | null) ?? null,
      reviewedAt: (row.reviewed_at as string | null) ?? null,
      reviewerNotes: (row.reviewer_notes as string | null) ?? null,
      updatedAt: (row.updated_at as string) ?? '',
    }
  }

  /**
   * Reviews a verification case — approves, rejects, or moves to Under Review.
   *
   * - Approve: applies the identity field correction to the profile and records
   *   before/after in the audit log.
   * - Reject: closes the case with reviewer notes.
   * - Under Review: updates status for review in progress.
   *
   * Once Approved or Rejected, a case is terminal and cannot be re-opened.
   */
  async reviewCase(
    caseId: string,
    dto: {
      decision: 'Under Review' | 'Approved' | 'Rejected'
      reviewerNotes?: string
    },
    reviewerUserId: string,
    ip: string,
  ): Promise<ReviewVerificationCaseResult> {
    const pool = getDbPool()

    // 1. Fetch the case
    const caseResult = await pool.query(
      `SELECT v.id, v.profile_id, v.field_name, v.current_value, v.requested_value,
              v.status, v.evidence_urls
       FROM verification_cases v
       WHERE v.id = $1`,
      [caseId],
    )
    if (caseResult.rows.length === 0) return null

    const caseRow = caseResult.rows[0] as Record<string, unknown>
    const currentStatus = caseRow.status as string

    // 2. Validate state transition
    const allowedNext = ALLOWED_TRANSITIONS[currentStatus]
    if (!allowedNext || !allowedNext.includes(dto.decision)) {
      return {
        error: `Cannot transition from '${currentStatus}' to '${dto.decision}'. ` +
          `Allowed transitions: ${(allowedNext ?? []).join(', ') || '(none — terminal)'}`,
      }
    }

    // 3. Validate notes for rejections
    if (dto.decision === 'Rejected' && (!dto.reviewerNotes || dto.reviewerNotes.trim() === '')) {
      return { error: 'Reviewer notes are required when rejecting a case' }
    }

    const fieldName = caseRow.field_name as string

    // Re-validate fieldName against allowed identity fields — security measure
    // to prevent SQL injection via a malformed field_name stored in the DB.
    // Must happen before pool.connect() for fail-fast behavior.
    if (dto.decision === 'Approved') {
      const isLegalField = IDENTITY_FIELDS_LEGAL.includes(fieldName)
      const isIndividualField = IDENTITY_FIELDS_INDIVIDUAL.includes(fieldName)
      if (!isLegalField && !isIndividualField) {
        return { error: `Invalid identity field '${fieldName}' cannot be updated` }
      }
    }

    const now = new Date().toISOString()
    const correlationId = uuidv7()
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      // Update the verification case
      await client.query(
        `UPDATE verification_cases
         SET status = $1, reviewed_by = $2, reviewed_at = $3::timestamptz,
             reviewer_notes = $4, updated_at = $5::timestamptz
         WHERE id = $6`,
        [dto.decision, reviewerUserId, now, dto.reviewerNotes ?? null, now, caseId],
      )

      // If approved, apply the identity field correction to the profile or legal_profiles
      if (dto.decision === 'Approved') {
        const newValue = caseRow.requested_value as string | null
        const profileId = caseRow.profile_id as string
        const oldValue = caseRow.current_value as string | null

        // fieldName was already validated against the whitelist before pool.connect()

        if (fieldName === 'legal_name' || fieldName === 'national_identifier') {
          // Update in legal_profiles table
          await client.query(
            `UPDATE legal_profiles SET ${fieldName} = $1, updated_at = $2::timestamptz WHERE id = $3`,
            [newValue, now, profileId],
          )
        } else {
          // Map field_name to DB column (first_name, last_name, national_id)
          await client.query(
            `UPDATE profiles SET ${fieldName} = $1, updated_at = $2::timestamptz WHERE id = $3`,
            [newValue, now, profileId],
          )
        }
      }

      // Record audit event
      const auditId = uuidv7()
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz)`,
        [
          auditId,
          reviewerUserId,
          'verification_case_reviewed',
          JSON.stringify({
            caseId,
            profileId: caseRow.profile_id,
            fieldName: caseRow.field_name,
            decision: dto.decision,
            reviewerNotes: dto.reviewerNotes ?? null,
            oldValue: caseRow.current_value,
            newValue: dto.decision === 'Approved' ? caseRow.requested_value : null,
          }),
          correlationId,
          ip,
          now,
        ],
      )

      await client.query('COMMIT')

      this.logger.debug(
        `Verification case ${caseId} reviewed: ${currentStatus} → ${dto.decision}, reviewer=${reviewerUserId}`,
      )

      return {
        success: true,
        id: caseId,
        status: dto.decision,
        profileId: caseRow.profile_id as string,
      }
    } catch (err) {
      await client.query('ROLLBACK')
      this.logger.error(`Failed to review verification case ${caseId}: ${String(err)}`)
      throw err
    } finally {
      client.release()
    }
  }
}
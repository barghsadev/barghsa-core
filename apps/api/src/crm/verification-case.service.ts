import { t } from '@barghsa/i18n'
import { NotificationsService } from '../notifications/notifications.service.js'
import { StaffAssignmentService } from '../staff-assignment/staff-assignment.service.js'
import { VerificationEvidenceService } from './verification-evidence.service.js'
import { validateNationalId, validateLegalNationalIdentifier } from '@barghsa/shared/validation'
import { Injectable, Logger, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
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
  assignedTo?: string | null
  assignedName?: string | null
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
  evidenceDownloadUrls?: string[]
  reason: string
  status: string
  assignedTo?: string | null
  assignedName?: string | null
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
  constructor(private readonly evidence: VerificationEvidenceService = new VerificationEvidenceService(), private readonly assignmentService: StaffAssignmentService = new StaffAssignmentService(), private readonly notifications: NotificationsService = new NotificationsService()) {}
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
    validateIdentityValue(dto.fieldName, dto.requestedValue)
    if (!dto.requestedValue?.trim() || !dto.reason?.trim()) throw new BadRequestException('Requested value and reason are required')
    const client = await getDbPool().connect()
    try {
      await client.query('BEGIN')
      const profile = (await client.query('SELECT * FROM profiles WHERE id=$1 AND archived=false FOR UPDATE', [profileId])).rows[0]
      if (!profile) { await client.query('ROLLBACK'); return null }
      const allowed = profile.profile_type === 'LEGAL' ? IDENTITY_FIELDS_LEGAL : IDENTITY_FIELDS_INDIVIDUAL
      if (!allowed.includes(dto.fieldName)) throw new BadRequestException('Invalid identity field for this profile type')
      const source = profile.profile_type === 'LEGAL'
        ? (await client.query('SELECT * FROM legal_profiles WHERE id=$1 FOR UPDATE', [profileId])).rows[0] : profile
      if (!source) throw new ConflictException('Profile identity record is missing')
      const currentValue = source[dto.fieldName] ?? null
      const pending = await client.query("SELECT id FROM verification_cases WHERE profile_id=$1 AND field_name=$2 AND status IN ('Open','Under Review')", [profileId, dto.fieldName])
      if (pending.rows.length) throw new ConflictException('An unresolved correction already exists for this field')
      const evidenceKeys = await this.evidence.seal(client, dto.evidenceUrls ?? [], actorUserId, profileId)
      const id = uuidv7(), now = new Date().toISOString()
      const assignment = await this.assignmentService.choose(client,'verification_case',id,actorUserId,['identity',profile.profile_type === 'LEGAL' ? 'legal' : 'individual'])
      await client.query(`INSERT INTO verification_cases(id,profile_id,field_name,current_value,requested_value,evidence_urls,reason,status,created_by,created_at,updated_at,assigned_to,assigned_team_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'Open',$8,$9,$9,$10,$11)`, [id,profileId,dto.fieldName,currentValue,dto.requestedValue.trim(),JSON.stringify(evidenceKeys),dto.reason.trim(),actorUserId,now,assignment?.userId ?? null,assignment?.teamId ?? null])
      await client.query(`INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at) VALUES ($1,$2,'verification_case_created',$3::jsonb,$4,$5,$6)`,
        [uuidv7(),actorUserId,JSON.stringify({caseId:id,profileId,fieldName:dto.fieldName,currentValue,requestedValue:dto.requestedValue.trim(),reason:dto.reason.trim()}),uuidv7(),ip,now])
      if (assignment) {
        const localizedContent = {fa:{title:t('crm.corrections.assignedNotice','fa'),body:t('crm.corrections.assignedBody','fa')},en:{title:t('crm.corrections.assignedNotice','en'),body:t('crm.corrections.assignedBody','en')}}
        await this.notifications.create({userId:assignment.userId,type:'general',title:localizedContent.en.title,body:localizedContent.en.body,localizedContent,link:`/admin/crm/corrections?profileId=${profileId}`},client)
      }
      await client.query('COMMIT')
      return { success:true,id,status:'Open',createdAt:now }
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error }
    finally { client.release() }
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
      `SELECT id, profile_id, field_name, requested_value, reason, status, created_by, assigned_to,
              (SELECT username FROM users WHERE user_id=verification_cases.assigned_to) AS assigned_name,
              created_at AT TIME ZONE 'UTC' AS created_at,
              updated_at AT TIME ZONE 'UTC' AS updated_at
       FROM verification_cases
       ${whereClause}
       ORDER BY created_at DESC, id DESC
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
        assignedTo: (row.assigned_to as string) ?? null,
        assignedName: (row.assigned_name as string) ?? null,
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
              v.assigned_to,(SELECT username FROM users WHERE user_id=v.assigned_to) AS assigned_name,
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
      evidenceDownloadUrls: await this.evidence.downloadUrls(evidenceUrls),
      reason: row.reason as string,
      status: row.status as string,
      assignedTo: (row.assigned_to as string) ?? null,
      assignedName: (row.assigned_name as string) ?? null,
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
    if (dto.decision === 'Rejected' && !dto.reviewerNotes?.trim()) throw new BadRequestException('Reviewer notes are required for rejection')
    const client = await getDbPool().connect()
    try {
      await client.query('BEGIN')
      // Use the same profile-before-case lock order as creation and archival.
      const profile = (await client.query(`SELECT p.* FROM profiles p JOIN verification_cases v ON v.profile_id=p.id WHERE v.id=$1 AND p.archived=false FOR UPDATE OF p`,[caseId])).rows[0]
      if (!profile) { await client.query('ROLLBACK'); return null }
      const row = (await client.query('SELECT * FROM verification_cases WHERE id=$1 FOR UPDATE',[caseId])).rows[0]
      if (!row || row.profile_id !== profile.id) throw new ConflictException('Correction target changed')
      if (row.created_by === reviewerUserId) throw new ForbiddenException('A different staff member must review the correction')
      if (!(ALLOWED_TRANSITIONS[row.status] ?? []).includes(dto.decision)) throw new ConflictException('Invalid correction state transition')
      const field = String(row.field_name)
      const allowed = profile.profile_type === 'LEGAL' ? IDENTITY_FIELDS_LEGAL : IDENTITY_FIELDS_INDIVIDUAL
      if (!allowed.includes(field)) throw new BadRequestException('Invalid identity field for this profile type')
      if (dto.decision === 'Approved') {
        const keys = typeof row.evidence_urls === 'string' ? JSON.parse(row.evidence_urls) : row.evidence_urls
        if (!Array.isArray(keys) || !keys.every(key => typeof key === 'string')) throw new ConflictException('Correction evidence is invalid')
        await this.evidence.validate(client, keys, profile.id)
        validateIdentityValue(field, row.requested_value)
        const table = profile.profile_type === 'LEGAL' ? 'legal_profiles' : 'profiles'
        const source = table === 'profiles' ? profile : (await client.query('SELECT * FROM legal_profiles WHERE id=$1 FOR UPDATE',[profile.id])).rows[0]
        if (!source || (source[field] ?? null) !== row.current_value) throw new ConflictException('Identity changed after this correction was requested')
        const updated = await client.query(`UPDATE ${table} SET ${field}=$1,updated_at=NOW() WHERE id=$2 RETURNING id`,[row.requested_value,profile.id])
        if (updated.rows.length !== 1) throw new ConflictException('Identity record is missing')
      }
      await client.query(`UPDATE verification_cases SET status=$1,reviewed_by=$2,reviewed_at=NOW(),reviewer_notes=$3,updated_at=NOW() WHERE id=$4`,[dto.decision,reviewerUserId,dto.reviewerNotes?.trim() ?? null,caseId])
      await client.query(`INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES ($1,$2,'verification_case_reviewed',$3::jsonb,$4,$5)`,
        [uuidv7(),reviewerUserId,JSON.stringify({caseId,profileId:profile.id,fieldName:field,decision:dto.decision,reviewerNotes:dto.reviewerNotes?.trim() ?? null,oldValue:row.current_value,newValue:dto.decision === 'Approved' ? row.requested_value : null}),uuidv7(),ip])
      await client.query('COMMIT')
      return { success:true,id:caseId,status:dto.decision,profileId:profile.id }
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error }
    finally { client.release() }
  }
}

function validateIdentityValue(field: string, value: unknown): void {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 512) throw new BadRequestException('Invalid identity value')
  if (field === 'national_id' && !validateNationalId(value.trim())) throw new BadRequestException('Invalid national ID')
  if (field === 'national_identifier' && !validateLegalNationalIdentifier(value.trim())) throw new BadRequestException('Invalid legal national identifier')
}

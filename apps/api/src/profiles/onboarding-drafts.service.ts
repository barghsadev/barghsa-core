import { HttpException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { z } from 'zod';
import type { ValidatedSession } from '../session/session.service.js';
import type { PoolClient } from 'pg';
import { requireCurrentSession } from '../session/session-step-up.js';
import { readOnboardingDraftState } from './onboarding-draft-state.js';
import { readWizardDraftTtl } from '../common/wizard-draft-retention.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

const legalLimits: Record<string, number> = {
  documentKeys: 4096,
  legalName: 200,
  nationalIdentifier: 11,
  registrationNumber: 50,
  companyTypeId: 100,
  registrationDate: 10,
  economicCode: 50,
  officialPhone: 30,
  officialEmail: 254,
  officialProvinceId: 36,
  officialCityId: 36,
  officialFullAddress: 500,
  officialPostalCode: 10,
  representativeTitle: 100,
  representativeRelationship: 100,
  representativeHonorific: 50,
  representativeFirstName: 100,
  representativeLastName: 100,
  representativeNationalId: 10,
  representativeProvinceId: 36,
  representativeCityId: 36,
  representativeFullAddress: 500,
  representativePostalCode: 10,
};
const individualLimits: Record<string, number> = {
  title: 50,
  firstName: 100,
  lastName: 100,
  nationalId: 10,
  provinceId: 36,
  cityId: 36,
  fullAddress: 500,
  postalCode: 10,
};
const draftFields = (limits: Record<string, number>) =>
  z
    .object(
      Object.fromEntries(
        Object.entries(limits).map(([key, max]) => [key, z.string().max(max).optional()])
      )
    )
    .strict()
    .refine(
      (data) => Buffer.byteLength(JSON.stringify(data), 'utf8') <= 16384,
      'Draft is too large'
    );
const legalFields = draftFields(legalLimits);
const individualFields = draftFields(individualLimits);
const expectedVersion = z.number().int().min(0).max(2147483646);
export const legalDraftInputSchema = z.object({ expectedVersion, data: legalFields }).strict();
export const onboardingDraftInputSchema = z
  .object({
    expectedVersion,
    // Incomplete values are intentional; submission validates the complete profile.
    data: z.union([individualFields, legalFields]),
  })
  .strict();

@Injectable()
export class OnboardingDraftsService {
  private async lockActor(client: PoolClient, actor: Actor, customerOnly = false) {
    // Match session validation's user -> session lock order, including audit foreign keys.
    const account = (
      await client.query(
        `SELECT disabled_at,is_staff,is_admin,
        EXISTS(SELECT 1 FROM user_roles WHERE user_id=$1) AS has_roles
        FROM users WHERE user_id=$1 FOR UPDATE`,
        [actor.userId]
      )
    ).rows[0];
    if (!account || account.disabled_at)
      throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
    if (customerOnly && (account.is_staff || account.is_admin || account.has_roles))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    await requireCurrentSession(client, actor);
  }

  async list(actor: Actor, query: unknown) {
    const parsed = z.object({ after: z.string().uuid().optional() }).strict().safeParse(query);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.lockActor(client, actor, true);
      const ttl = await readWizardDraftTtl(client);
      const result = await client.query(
        `SELECT p.id,p.profile_type,
          NULLIF(COALESCE(NULLIF(p.title,''),TRIM(CONCAT_WS(' ',p.first_name,p.last_name))),'') AS name,
          p.created_at,
          CASE WHEN d.data<>'{}'::jsonb THEN d.updated_at ELSE NULL END AS updated_at,
          COALESCE(d.data<>'{}'::jsonb,false) AS has_draft,
          COALESCE(d.data<>'{}'::jsonb AND d.updated_at<NOW()-($3*INTERVAL '1 day'),false) AS expired
         FROM profiles p LEFT JOIN profile_onboarding_drafts d ON d.profile_id=p.id
         WHERE p.user_id=$1 AND p.status='DRAFT' AND NOT p.archived
           AND p.profile_type IN ('INDIVIDUAL','LEGAL')
           AND ($2::uuid IS NULL OR p.id<$2::uuid)
           AND NOT EXISTS(SELECT 1 FROM profile_onboarding_journeys j
             WHERE j.individual_profile_id=p.id OR j.legal_profile_id=p.id)
         ORDER BY p.id DESC LIMIT 51`,
        [actor.userId, parsed.data.after ?? null, ttl]
      );
      const drafts = result.rows.slice(0, 50).map((row) => ({
        id: row.id as string,
        profileType: row.profile_type as 'INDIVIDUAL' | 'LEGAL',
        name: row.name as string | null,
        createdAt: (row.created_at as Date).toISOString(),
        updatedAt: row.updated_at ? (row.updated_at as Date).toISOString() : null,
        hasDraft: row.has_draft as boolean,
        expired: row.expired as boolean,
      }));
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { drafts, nextAfter: result.rows.length > 50 ? drafts.at(-1)!.id : null };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async get(actor: Actor, profileId: string) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.lockActor(client, actor);
      const profile = await client.query(
        "SELECT id FROM profiles WHERE id=$1 AND user_id=$2 AND profile_type IN ('INDIVIDUAL','LEGAL') AND status='DRAFT' AND NOT archived FOR UPDATE",
        [profileId, actor.userId]
      );
      if (!profile.rows.length)
        throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
      const draft = await readOnboardingDraftState(client, profileId);
      if (draft.expired) {
        // Retain a monotonically increasing version so stale tabs cannot reuse a deleted version.
        draft.version += 1;
        draft.data = {};
        await client.query(
          "UPDATE profile_onboarding_drafts SET version=$2,data='{}'::jsonb,updated_at=NOW() WHERE profile_id=$1",
          [profileId, draft.version]
        );
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
           VALUES(uuid_generate_v7(),$1,'onboarding_draft_expired',jsonb_build_object('profileId',$2::text,'version',$3::integer),uuid_generate_v7())`,
          [actor.userId, profileId, draft.version]
        );
      }
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { version: draft.version, data: draft.data };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async save(actor: Actor, profileId: string, input: unknown) {
    const parsed = onboardingDraftInputSchema.safeParse(input);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.lockActor(client, actor);
      const profile = await client.query(
        "SELECT id,profile_type FROM profiles WHERE id=$1 AND user_id=$2 AND profile_type IN ('INDIVIDUAL','LEGAL') AND status='DRAFT' AND NOT archived FOR UPDATE",
        [profileId, actor.userId]
      );
      if (!profile.rows.length)
        throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
      const fields = profile.rows[0].profile_type === 'INDIVIDUAL' ? individualFields : legalFields;
      if (!fields.safeParse(parsed.data.data).success)
        throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
      const current = await readOnboardingDraftState(client, profileId);
      if (current.expired || current.version !== parsed.data.expectedVersion)
        throw new HttpException({ error: ErrorCodes.CONFLICT_VERSION.code }, 409);
      const version = parsed.data.expectedVersion + 1;
      await client.query(
        `INSERT INTO profile_onboarding_drafts(profile_id,version,data) VALUES ($1,$2,$3::jsonb)
         ON CONFLICT(profile_id) DO UPDATE SET version=EXCLUDED.version,data=EXCLUDED.data,updated_at=NOW()`,
        [profileId, version, JSON.stringify(parsed.data.data)]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
         VALUES(uuid_generate_v7(),$1,'onboarding_draft_saved',jsonb_build_object('profileId',$2::text,'version',$3::integer),uuid_generate_v7(),NOW())`,
        [actor.userId, profileId, version]
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { version, data: parsed.data.data };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

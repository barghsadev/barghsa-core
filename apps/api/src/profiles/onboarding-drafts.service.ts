import { HttpException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { z } from 'zod';

const limits: Record<string, number> = {
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
export const legalDraftInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483646),
    // Incomplete values are intentional while editing. Full validation happens on submission.
    data: z
      .object(
        Object.fromEntries(
          Object.entries(limits).map(([key, max]) => [key, z.string().max(max).optional()])
        )
      )
      .strict()
      .refine(
        (data) => Buffer.byteLength(JSON.stringify(data), 'utf8') <= 16384,
        'Draft is too large'
      ),
  })
  .strict();

@Injectable()
export class OnboardingDraftsService {
  async get(userId: string, profileId: string) {
    const result = await getDbPool().query(
      `SELECT d.version,d.data FROM profiles p LEFT JOIN profile_onboarding_drafts d ON d.profile_id=p.id
       WHERE p.id=$1 AND p.user_id=$2 AND p.profile_type='LEGAL' AND p.status='DRAFT' AND NOT p.archived`,
      [profileId, userId]
    );
    if (!result.rows.length)
      throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    return { version: result.rows[0].version ?? 0, data: result.rows[0].data ?? {} };
  }

  async save(userId: string, profileId: string, input: unknown) {
    const parsed = legalDraftInputSchema.safeParse(input);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const profile = await client.query(
        "SELECT id FROM profiles WHERE id=$1 AND user_id=$2 AND profile_type='LEGAL' AND status='DRAFT' AND NOT archived FOR UPDATE",
        [profileId, userId]
      );
      if (!profile.rows.length)
        throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
      const current = await client.query(
        'SELECT version FROM profile_onboarding_drafts WHERE profile_id=$1',
        [profileId]
      );
      if ((current.rows[0]?.version ?? 0) !== parsed.data.expectedVersion)
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
        [userId, profileId, version]
      );
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

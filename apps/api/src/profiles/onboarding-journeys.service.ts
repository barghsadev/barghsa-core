import { HttpException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { ProfilesService } from './profiles.service.js';

const profileTypes = ['INDIVIDUAL', 'LEGAL'] as const;
export const onboardingJourneyInputSchema = z
  .object({
    requestId: z.string().uuid(),
    profileTypes: z
      .array(z.enum(profileTypes))
      .min(1)
      .max(2)
      .refine((types) => new Set(types).size === types.length, 'Select each type once'),
  })
  .strict();
export const onboardingJourneyFinishSchema = z
  .object({ selectedProfileId: z.string().uuid() })
  .strict();
type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
interface JourneyRow {
  id: string;
  request_id: string;
  individual_profile_id: string | null;
  legal_profile_id: string | null;
  selected_profile_id: string | null;
  completed_at: Date | null;
}
type Profile = {
  id: string;
  profileType: 'INDIVIDUAL' | 'LEGAL';
  status: 'DRAFT' | 'ACTIVE' | 'PENDING_VERIFICATION' | 'VERIFIED';
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  isDefault: boolean;
};
export interface OnboardingJourney {
  id: string;
  profiles: Profile[];
  completed: boolean;
  selectedProfileId: string | null;
  activeProfileId: string | null;
}
function fail(code: string, status: number): never {
  throw new HttpException({ error: code }, status);
}
function missing(): never {
  return fail(ErrorCodes.NOT_FOUND_RESOURCE.code, 404);
}
function conflict(): never {
  return fail(ErrorCodes.CONFLICT_VERSION.code, 409);
}

@Injectable()
export class OnboardingJourneysService {
  constructor(private readonly profiles: ProfilesService) {}

  private async requireCustomer(client: PoolClient, actor: Actor) {
    const result = await client.query(
      `SELECT u.disabled_at, u.is_staff, u.is_admin,
       EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.user_id) AS has_roles
       FROM users u WHERE u.user_id=$1 FOR UPDATE`,
      [actor.userId]
    );
    const user = result.rows[0];
    if (!user || user.disabled_at) fail(ErrorCodes.AUTH_UNAUTHENTICATED.code, 401);
    if (user.is_staff || user.is_admin || user.has_roles)
      fail(ErrorCodes.AUTHZ_FORBIDDEN.code, 403);
    await requireCurrentSession(client, actor);
  }

  private async project(
    client: Pool | PoolClient,
    userId: string,
    row: JourneyRow
  ): Promise<OnboardingJourney> {
    const ids = [row.individual_profile_id, row.legal_profile_id].filter(
      (id): id is string => !!id
    );
    const result = await client.query<Profile>(
      `SELECT id, profile_type AS "profileType", status, title, first_name AS "firstName",
       last_name AS "lastName", is_default AS "isDefault" FROM profiles
       WHERE id=ANY($1::uuid[]) AND user_id=$2 AND NOT archived`,
      [ids, userId]
    );
    const profiles = ids.map((id) => {
      const profile = result.rows.find((p) => p.id === id);
      if (!profile) missing();
      const expected = id === row.individual_profile_id ? 'INDIVIDUAL' : 'LEGAL';
      if (
        profile.profileType !== expected ||
        !['DRAFT', 'ACTIVE', 'PENDING_VERIFICATION', 'VERIFIED'].includes(profile.status)
      )
        conflict();
      // The selection order is stable regardless of checkbox click order.
      return profile;
    });
    const context = await client.query(
      `SELECT p.id FROM profiles p LEFT JOIN user_profile_contexts c ON c.user_id=$1
       WHERE NOT p.archived AND (p.user_id=$1 OR (p.profile_type='LEGAL' AND EXISTS(
         SELECT 1 FROM profile_agents a WHERE a.profile_id=p.id AND a.user_id=$1
         AND a.role IN ('Manager','Finance','Legal'))))
       AND CASE WHEN c.user_id IS NULL THEN p.user_id=$1 AND p.is_default ELSE p.id=c.profile_id END
       LIMIT 1`,
      [userId]
    );
    return {
      id: row.id,
      profiles,
      completed: row.completed_at !== null,
      selectedProfileId: row.selected_profile_id,
      activeProfileId: context.rows[0]?.id ?? null,
    };
  }

  async active(userId: string) {
    const pool = getDbPool();
    const result = await pool.query<JourneyRow>(
      'SELECT * FROM profile_onboarding_journeys WHERE user_id=$1 AND completed_at IS NULL',
      [userId]
    );
    return { journey: result.rows[0] ? await this.project(pool, userId, result.rows[0]) : null };
  }

  async get(userId: string, journeyId: string) {
    const pool = getDbPool();
    const result = await pool.query<JourneyRow>(
      'SELECT * FROM profile_onboarding_journeys WHERE id=$1 AND user_id=$2',
      [journeyId, userId]
    );
    if (!result.rows[0]) missing();
    return this.project(pool, userId, result.rows[0]);
  }

  async forProfile(userId: string, profileId: string) {
    const pool = getDbPool();
    const result = await pool.query<JourneyRow>(
      `SELECT * FROM profile_onboarding_journeys WHERE user_id=$1
       AND (individual_profile_id=$2 OR legal_profile_id=$2)`,
      [userId, profileId]
    );
    return result.rows[0] ? this.project(pool, userId, result.rows[0]) : null;
  }

  async start(actor: Actor, input: unknown) {
    const parsed = onboardingJourneyInputSchema.safeParse(input);
    if (!parsed.success) fail(ErrorCodes.VALIDATION_INPUT_INVALID.code, 400);
    const data = parsed.data!;
    const types = profileTypes.filter((type) => data.profileTypes.includes(type));
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await this.requireCustomer(client, actor);
      // Account locking serializes retries. Existing journeys are read without taking a
      // journey/profile lock after the account lock used by creation.
      const previous = await client.query<JourneyRow>(
        `SELECT * FROM profile_onboarding_journeys WHERE user_id=$1
         AND (request_id=$2 OR completed_at IS NULL) ORDER BY (request_id=$2) DESC LIMIT 1`,
        [actor.userId, data.requestId]
      );
      let row = previous.rows[0];
      if (row) {
        if (row.request_id !== data.requestId) conflict();
        if (
          !!row.individual_profile_id !== types.includes('INDIVIDUAL') ||
          !!row.legal_profile_id !== types.includes('LEGAL')
        )
          conflict();
      } else {
        const ids: Partial<Record<Profile['profileType'], string>> = {};
        for (const type of types)
          ids[type] = (await this.profiles.createProfile(actor.userId, type, client)).id;
        row = (
          await client.query<JourneyRow>(
            `INSERT INTO profile_onboarding_journeys(user_id,request_id,individual_profile_id,legal_profile_id)
           VALUES($1,$2,$3,$4) RETURNING *`,
            [actor.userId, data.requestId, ids.INDIVIDUAL ?? null, ids.LEGAL ?? null]
          )
        ).rows[0];
        if (!row) return conflict();
        await this.audit(client, actor.userId, 'onboarding_journey_started', row.id);
      }
      const result = await this.project(client, actor.userId, row);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async finish(actor: Actor, journeyId: string, input: unknown) {
    const parsed = onboardingJourneyFinishSchema.safeParse(input);
    if (!parsed.success) fail(ErrorCodes.VALIDATION_INPUT_INVALID.code, 400);
    const selected = parsed.data!.selectedProfileId;
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<JourneyRow>(
        'SELECT * FROM profile_onboarding_journeys WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [journeyId, actor.userId]
      );
      const row = result.rows[0];
      if (!row) return missing();
      const ids = [row.individual_profile_id, row.legal_profile_id].filter(Boolean);
      if (!ids.includes(selected)) missing();
      // Match profile writes' profile-before-account lock order.
      await client.query(
        'SELECT id FROM profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [ids]
      );
      await this.requireCustomer(client, actor);
      let journey = await this.project(client, actor.userId, row);
      if (journey.profiles.some((profile) => profile.status === 'DRAFT')) conflict();
      if (journey.completed) {
        // A lost response may be retried, but must not undo a later context change.
        if (journey.selectedProfileId !== selected || journey.activeProfileId !== selected)
          conflict();
      } else {
        await client.query(
          `INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)
           ON CONFLICT(user_id) DO UPDATE SET profile_id=EXCLUDED.profile_id,updated_at=NOW()`,
          [actor.userId, selected]
        );
        await client.query(
          'UPDATE profile_onboarding_journeys SET selected_profile_id=$2,completed_at=NOW(),updated_at=NOW() WHERE id=$1',
          [journeyId, selected]
        );
        await this.audit(client, actor.userId, 'onboarding_journey_completed', journeyId, selected);
        const persisted = await client.query<JourneyRow>(
          'SELECT * FROM profile_onboarding_journeys WHERE id=$1 AND user_id=$2',
          [journeyId, actor.userId]
        );
        const saved = persisted.rows[0];
        if (!saved) return conflict();
        journey = await this.project(client, actor.userId, saved);
        if (
          !journey.completed ||
          journey.selectedProfileId !== selected ||
          journey.activeProfileId !== selected
        )
          conflict();
      }
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return journey;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async audit(
    client: PoolClient,
    userId: string,
    event: string,
    journeyId: string,
    selectedProfileId: string | null = null
  ) {
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
       VALUES(uuid_generate_v7(),$1,$2,jsonb_build_object('journeyId',$3::text,'selectedProfileId',$4::text),uuid_generate_v7(),NOW())`,
      [userId, event, journeyId, selectedProfileId]
    );
  }
}

import { getDbPool } from '@barghsa/db';
import { z } from 'zod';
import { contractUuid } from './contract-validation.js';

export const authoringQuery = z
  .object({
    search: z.string().trim().max(100).default(''),
    profileId: contractUuid.optional(),
    before: contractUuid.optional(),
  })
  .strict();

/** Contract writers need only names and order references, not the CRM's private fields. */
export async function contractAuthoringOptions(input: z.infer<typeof authoringQuery>) {
  if (input.profileId) {
    const result = await getDbPool().query<{
      id: string;
      serviceType: string;
      createdAt: Date;
    }>(
      `SELECT o.id, o.order_type AS "serviceType", o.created_at AS "createdAt"
       FROM orders o JOIN profiles p ON p.id=o.profile_id
       WHERE o.profile_id=$1 AND NOT p.archived AND o.status<>'CANCELLED'
         AND ($2::uuid IS NULL OR o.id<$2)
       ORDER BY o.id DESC LIMIT 51`,
      [input.profileId, input.before ?? null]
    );
    return {
      orders: result.rows.slice(0, 50),
      nextBefore: result.rows.length > 50 ? result.rows[49]!.id : null,
    };
  }
  const result = await getDbPool().query<{ id: string; title: string; profileType: string }>(
    `SELECT id, COALESCE(NULLIF(title,''), NULLIF(concat_ws(' ',first_name,last_name),''),'') AS title,
       profile_type AS "profileType"
     FROM profiles WHERE NOT archived
       AND strpos(lower(concat_ws(' ',title,first_name,last_name)),lower($1))>0
       AND ($2::uuid IS NULL OR id<$2)
     ORDER BY id DESC LIMIT 51`,
    [input.search, input.before ?? null]
  );
  return {
    profiles: result.rows.slice(0, 50),
    nextBefore: result.rows.length > 50 ? result.rows[49]!.id : null,
  };
}

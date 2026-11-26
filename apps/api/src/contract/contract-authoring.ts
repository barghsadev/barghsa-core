import { getDbPool } from '@barghsa/db';
import { NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { contractUuid } from './contract-validation.js';

export const authoringQuery = z
  .object({
    search: z.string().trim().max(100).default(''),
    profileId: contractUuid.optional(),
    serviceType: z.enum(['electricity', 'savings', 'solar']).optional(),
    before: contractUuid.optional(),
  })
  .strict()
  .refine(({ profileId, serviceType }) => !serviceType || !!profileId);

export const contractInvoiceOptionsQuery = z
  .object({ versionId: contractUuid, before: contractUuid.optional() })
  .strict();

/** List only references for invoices that can be linked to this draft. */
export async function contractInvoiceOptions(
  contractId: string,
  { versionId, before }: z.infer<typeof contractInvoiceOptionsQuery>,
  client: PoolClient
) {
  const { rows } = await client.query<{
    profileId: string;
    id: string | null;
    createdAt: Date | null;
  }>(
    `SELECT c.profile_id AS "profileId", invoice.id, invoice.created_at AS "createdAt"
     FROM contracts c JOIN profiles p ON p.id=c.profile_id
     LEFT JOIN LATERAL (
       SELECT i.id,i.created_at FROM invoices i
       WHERE i.profile_id=c.profile_id AND i.adjustment_for_invoice_id IS NULL
         AND i.state NOT IN ('Cancelled','Refunded','PartiallyRefunded')
         AND (i.contract_id=c.id::text OR
           (i.order_id=c.order_id AND (i.contract_id IS NULL OR i.contract_id=c.id::text)))
         AND ($3::uuid IS NULL OR i.id<$3)
       ORDER BY i.id DESC LIMIT 51
     ) invoice ON true
     WHERE c.id=$1 AND c.current_version_id=$2 AND NOT p.archived
       AND c.state IN ('Draft','ChangesRequested')
     ORDER BY invoice.id DESC`,
    [contractId, versionId, before ?? null]
  );
  const draft = rows[0];
  if (!draft) throw new NotFoundException();
  return {
    contractId,
    versionId,
    profileId: draft.profileId,
    invoices: rows.slice(0, 50).flatMap(({ id, createdAt }) => (id ? [{ id, createdAt }] : [])),
    nextBefore: rows.length > 50 ? rows[49]!.id : null,
  };
}

/** Contract writers need only names and order references, not the CRM's private fields. */
export async function contractAuthoringOptions(
  input: z.infer<typeof authoringQuery>,
  client: PoolClient | ReturnType<typeof getDbPool> = getDbPool()
) {
  if (input.profileId) {
    const result = await client.query<{
      id: string;
      serviceType: string;
      createdAt: Date;
      productTitle: { en: string | null; fa: string | null };
    }>(
      `SELECT o.id, o.order_type AS "serviceType", o.created_at AS "createdAt",
           jsonb_build_object('en', product.title->>'en', 'fa', product.title->>'fa') AS "productTitle"
       FROM orders o JOIN profiles p ON p.id=o.profile_id
         JOIN products product ON product.id=o.product_id
       WHERE o.profile_id=$1 AND NOT p.archived AND o.status<>'CANCELLED'
         AND ($2::uuid IS NULL OR o.id<$2)
           AND ($3::text IS NULL OR o.order_type=$3)
       ORDER BY o.id DESC LIMIT 51`,
      [input.profileId, input.before ?? null, input.serviceType ?? null]
    );
    return {
      orders: result.rows.slice(0, 50),
      nextBefore: result.rows.length > 50 ? result.rows[49]!.id : null,
    };
  }
  const result = await client.query<{ id: string; title: string; profileType: string }>(
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

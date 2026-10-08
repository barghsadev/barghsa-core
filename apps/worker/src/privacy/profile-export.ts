import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { getDbPool, loadStoredStorageConfiguration } from '@barghsa/db';
import { runtimeStorageProvider, type StorageProvider } from '@barghsa/shared/storage';
import type { Pool } from 'pg';
import yazl from 'yazl';
import type { JobContext } from '../jobs/async-runner.js';

export const PROFILE_EXPORT_JOB_TYPE = 'profile-export';
const MAX_ROWS = 5000;
const MAX_DOCUMENTS = 500;
const MAX_DOCUMENT_BYTES = 1024 * 1024 * 1024;
const storage = runtimeStorageProvider(loadStoredStorageConfiguration);
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ExportPayload {
  ticketId: string;
  profileId: string;
  userId: string;
}
interface ExportDocument {
  id: string;
  original_name: string;
  storage_key: string;
  size_bytes: string;
  detected_mime: string;
  checksum: string;
  state: string;
  created_at: Date;
}

function parsePayload(value: unknown): ExportPayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid export payload');
  const row = value as Record<string, unknown>;
  if (
    typeof row.ticketId !== 'string' ||
    typeof row.profileId !== 'string' ||
    typeof row.userId !== 'string' ||
    !idPattern.test(row.ticketId) ||
    !idPattern.test(row.profileId) ||
    !row.userId
  )
    throw new Error('Invalid export payload');
  return row as unknown as ExportPayload;
}

async function boundedRows(pool: Pool, sql: string, values: unknown[], limit = MAX_ROWS) {
  const rows = (await pool.query<Record<string, unknown>>(sql, values)).rows;
  if (rows.length > limit) throw new Error('Profile export exceeds supported size');
  return rows;
}

/** Explicit fields keep credentials, internal notes, payment metadata and staff-only data out. */
export async function collectProfileData(pool: Pool, payload: ExportPayload) {
  const { profileId, userId } = payload;
  const data: Record<string, unknown> = { schemaVersion: 1, profileId };
  const selections: [string, string, unknown[]][] = [
    [
      'account',
      `SELECT user_id,username,email,mobile,locale,timezone,created_at
       FROM users WHERE user_id=$1 LIMIT 2`,
      [userId],
    ],
    [
      'profile',
      `SELECT id,profile_type,status,title,first_name,last_name,national_id,
              contact_email,contact_mobile,created_at,updated_at
       FROM profiles WHERE id=$1 AND user_id=$2 AND archived=false LIMIT 2`,
      [profileId, userId],
    ],
    [
      'addresses',
      `SELECT id,province_id,city_id,full_address,postal_code,main_address,created_at,updated_at
       FROM addresses WHERE profile_id=$1 AND deleted_at IS NULL ORDER BY created_at,id LIMIT 5001`,
      [profileId],
    ],
    [
      'orders',
      `SELECT id,product_id,order_type,status,snapshot_province_id,snapshot_city_id,
              snapshot_full_address,snapshot_postal_code,gift_discount_amount,created_at,updated_at
       FROM orders WHERE profile_id=$1 ORDER BY created_at,id LIMIT 5001`,
      [profileId],
    ],
    [
      'invoices',
      `SELECT id,order_id,contract_id,state,total_amount,paid_amount,refunded_amount,
              issued_at,payable_from,due_at,cancelled_at,created_at,updated_at
       FROM invoices WHERE profile_id=$1 ORDER BY created_at,id LIMIT 5001`,
      [profileId],
    ],
    [
      'invoiceLines',
      `SELECT l.id,l.invoice_id,l.description,l.quantity,l.unit_price,l.line_total,
              l.vat_rate,l.vat_amount,l.is_taxable,l.position,l.created_at
       FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id
       WHERE i.profile_id=$1 ORDER BY i.created_at,l.position,l.id LIMIT 5001`,
      [profileId],
    ],
    [
      'refunds',
      `SELECT id,invoice_id,amount,state,destination,created_at,updated_at
       FROM refunds WHERE profile_id=$1 ORDER BY created_at,id LIMIT 5001`,
      [profileId],
    ],
    [
      'contracts',
      `SELECT id,contract_number,order_id,service_type,state,submitted_at,accepted_at,
              signed_at,activated_at,completed_at,cancelled_at,created_at,updated_at
       FROM contracts WHERE profile_id=$1 ORDER BY created_at,id LIMIT 5001`,
      [profileId],
    ],
    [
      'wallet',
      `SELECT profile_id,posted_balance,reserved_balance,updated_at
       FROM wallets WHERE profile_id=$1 LIMIT 2`,
      [profileId],
    ],
    [
      'electricityOrders',
      `SELECT id,mode,status,period_start,period_end,submitted_at,total_kwh,
              average_power_kw,green_rule_applied,created_at,updated_at
       FROM electricity_orders WHERE profile_id=$1 ORDER BY created_at,id LIMIT 5001`,
      [profileId],
    ],
    [
      'electricityOrderLines',
      `SELECT l.id,l.order_id,l.product_id,l.revision,l.quantity_kwh,l.unit_price,
              l.line_total,l.created_at
       FROM electricity_order_lines l JOIN electricity_orders o ON o.id=l.order_id
       WHERE o.profile_id=$1 ORDER BY o.created_at,l.revision,l.id LIMIT 5001`,
      [profileId],
    ],
    [
      'savingOrders',
      `SELECT id,order_id,saving_plan_id,hardware_product_id,bill_identifier,
              installation_address_id,agreement_version_id,agreement_snapshot,
              address_snapshot,pricing_snapshot,status,financial_status,submitted_at,
              created_at,updated_at
       FROM saving_orders WHERE profile_id=$1 ORDER BY created_at,id LIMIT 5001`,
      [profileId],
    ],
    [
      'savingOrderLines',
      `SELECT l.id,l.order_id,l.description,l.amount,l.type,l.created_at,l.updated_at
       FROM saving_order_lines l JOIN saving_orders o ON o.id=l.order_id
       WHERE o.profile_id=$1 ORDER BY l.created_at,l.id LIMIT 5001`,
      [profileId],
    ],
    [
      'savingFulfillmentStages',
      `SELECT s.id,s.order_id,s.stage,s.status,s.started_at,s.completed_at,
              s.explanation,s.handover_description
       FROM saving_fulfillment_stages s JOIN saving_orders o ON o.id=s.order_id
       WHERE o.profile_id=$1 ORDER BY s.created_at,s.id LIMIT 5001`,
      [profileId],
    ],
    [
      'savingFulfillmentEvents',
      `SELECT e.id,e.order_id,e.stage,e.from_status,e.to_status,
              e.explanation,e.handover_description,e.actor_context,e.created_at
       FROM saving_fulfillment_events e JOIN saving_orders o ON o.id=e.order_id
       WHERE o.profile_id=$1 ORDER BY e.created_at,e.id LIMIT 5001`,
      [profileId],
    ],
    [
      'savingOrderComments',
      `SELECT c.id,c.order_id,c.body,c.created_at
       FROM saving_order_comments c JOIN saving_orders o ON o.id=c.order_id
       WHERE o.profile_id=$1 ORDER BY c.created_at,c.id LIMIT 5001`,
      [profileId],
    ],
    [
      'savingRevisions',
      `SELECT r.id,r.order_id,r.previous_version_id,r.version_id,r.actor_context,r.created_at
       FROM saving_order_revisions r JOIN saving_orders o ON o.id=r.order_id
       WHERE o.profile_id=$1 ORDER BY r.created_at,r.id LIMIT 5001`,
      [profileId],
    ],
    [
      'savingAddressAmendments',
      `SELECT a.id,a.order_id,a.contract_id,a.contract_version_id,a.previous_address_id,
              a.address_id,a.previous_snapshot,a.address_snapshot,a.reason,a.actor_context,a.created_at
       FROM saving_address_amendments a JOIN saving_orders o ON o.id=a.order_id
       WHERE o.profile_id=$1 ORDER BY a.created_at,a.id LIMIT 5001`,
      [profileId],
    ],
    [
      'savingHardwareAmendments',
      `SELECT a.id,a.order_id,a.contract_id,a.contract_version_id,a.previous_hardware_id,
              a.hardware_id,a.previous_snapshot,a.hardware_snapshot,a.original_invoice_id,
              a.adjustment_invoice_id,a.price_delta_irr,a.reason,a.actor_context,a.created_at
       FROM saving_hardware_amendments a JOIN saving_orders o ON o.id=a.order_id
       WHERE o.profile_id=$1 ORDER BY a.created_at,a.id LIMIT 5001`,
      [profileId],
    ],
    [
      'savingHardwareUpgrades',
      `SELECT u.id,u.order_id,u.contract_id,u.contract_version_id,u.previous_hardware_id,
              u.hardware_id,u.hardware_snapshot,u.original_invoice_id,u.adjustment_invoice_id,
              u.price_delta_irr,u.status,u.reason,u.actor_context,u.created_at,u.applied_at,u.closed_at
       FROM saving_hardware_upgrade_requests u JOIN saving_orders o ON o.id=u.order_id
       WHERE o.profile_id=$1 ORDER BY u.created_at,u.id LIMIT 5001`,
      [profileId],
    ],
    [
      'solarRequests',
      `SELECT id,status,contract_id,building_type,grid_type,bill_identifier,
              property_form,structural_frame,building_completion_date,total_units,
              site_category,installation_surface,usable_area_sqm,site_address_id,
              submission_review->'data'->>'siteAddress' AS site_address,
              site_relationship,site_description,agreement_version,agreement_snapshot,
              agreement_accepted_at,status_reason,support_path,submitted_at,created_at,updated_at
       FROM solar_construction_requests WHERE profile_id=$1 ORDER BY created_at,id LIMIT 5001`,
      [profileId],
    ],
    [
      'solarDocumentReviews',
      `SELECT d.id,d.request_id,d.document_id,d.file_name,d.staff_status,d.staff_reason,
              d.staff_reviewed_at,d.uploaded_at
       FROM solar_construction_documents d JOIN solar_construction_requests r ON r.id=d.request_id
       WHERE r.profile_id=$1 ORDER BY d.uploaded_at,d.id LIMIT 5001`,
      [profileId],
    ],
    [
      'solarDocumentRequests',
      `SELECT d.id,d.request_id,d.description,d.created_at
       FROM solar_document_requests d JOIN solar_construction_requests r ON r.id=d.request_id
       WHERE r.profile_id=$1 ORDER BY d.created_at,d.id LIMIT 5001`,
      [profileId],
    ],
    [
      'solarPostal',
      `SELECT p.id,p.request_id,p.status,p.courier,p.tracking_number,p.send_date,
              p.receipt_image_id,p.staff_confirmed_at,p.estimated_arrival_date,
              p.tracking_url,p.tracking_note,p.tracking_recorded_at
       FROM solar_construction_postal p JOIN solar_construction_requests r ON r.id=p.request_id
       WHERE r.profile_id=$1 ORDER BY p.id LIMIT 5001`,
      [profileId],
    ],
    [
      'solarConstructionProgress',
      `SELECT e.id,e.request_id,e.contract_id,e.stage,e.revision,e.note,e.actor_context,e.recorded_at
       FROM solar_construction_progress_events e JOIN solar_construction_requests r ON r.id=e.request_id
       WHERE r.profile_id=$1 ORDER BY e.recorded_at,e.id LIMIT 5001`,
      [profileId],
    ],
    [
      'consultations',
      `SELECT id,product_id,product_snapshot,status,fee,scope,deliverables,expected_next_step,
              offer_valid_until,accepted_at,invoice_id,submitted_at,created_at,updated_at
       FROM consultation_requests WHERE profile_id=$1 ORDER BY created_at,id LIMIT 5001`,
      [profileId],
    ],
    [
      'consultationEvents',
      `SELECT e.id,e.request_id,e.status,e.reason,e.actor_context,e.created_at
       FROM consultation_request_events e JOIN consultation_requests r ON r.id=e.request_id
       WHERE r.profile_id=$1 ORDER BY e.created_at,e.id LIMIT 5001`,
      [profileId],
    ],
    [
      'walletTransactions',
      `SELECT id,type,amount,state,ref_id,description,created_at,updated_at
       FROM wallet_transactions WHERE wallet_id=$1 ORDER BY created_at,id LIMIT 5001`,
      [profileId],
    ],
    [
      'supportTickets',
      `SELECT id,subject,body,category,status,created_at,updated_at
       FROM tickets WHERE profile_id=$1 AND user_id=$2 ORDER BY created_at,id LIMIT 5001`,
      [profileId, userId],
    ],
    [
      'supportMessages',
      `SELECT c.id,c.ticket_id,c.author_id,c.body,c.created_at,c.updated_at
       FROM ticket_comments c JOIN tickets t ON t.id=c.ticket_id
       WHERE t.profile_id=$1 AND t.user_id=$2 AND c.visibility='public'
       ORDER BY c.created_at,c.id LIMIT 5001`,
      [profileId, userId],
    ],
  ];
  for (const [name, sql, values] of selections) {
    data[name] = await boundedRows(pool, sql, values);
  }
  if ((data.profile as unknown[]).length !== 1 || (data.account as unknown[]).length !== 1)
    throw new Error('Profile export owner unavailable');
  return data;
}

export async function generateProfileExport(
  value: unknown,
  context: JobContext,
  pool: Pool = getDbPool(),
  provider: StorageProvider = storage
): Promise<{ resultUrl: string }> {
  const payload = parsePayload(value);
  const { ticketId, profileId, userId } = payload;
  const owned = await pool.query<{ privacy_export_storage_key: string | null }>(
    `SELECT t.privacy_export_storage_key FROM tickets t JOIN profiles p ON p.id=t.profile_id
     JOIN users u ON u.user_id=t.user_id AND u.disabled_at IS NULL
     JOIN async_jobs j ON j.id=t.privacy_export_job_id
     LEFT JOIN user_profile_contexts c ON c.user_id=u.user_id
     WHERE t.id=$1 AND t.user_id=$2 AND t.profile_id=$3 AND t.privacy_request_type='export'
       AND t.privacy_export_job_id=$4 AND j.status='processing' AND j.lease_token=$5
       AND j.lease_until>clock_timestamp()
       AND j.operating_context='customer' AND p.user_id=$2 AND NOT p.archived
       AND ((c.user_id IS NULL AND p.is_default) OR c.profile_id=p.id)`,
    [ticketId, userId, profileId, context.jobId, context.leaseToken]
  );
  if (owned.rowCount !== 1) throw new Error('Profile export no longer authorized');
  const priorKey = owned.rows[0]?.privacy_export_storage_key;
  if (priorKey) {
    await provider.deleteObject(priorKey);
    await pool.query(
      `UPDATE tickets SET privacy_export_storage_key=NULL,privacy_export_expires_at=NULL
       WHERE id=$1 AND privacy_export_job_id=$2 AND privacy_export_storage_key=$3`,
      [ticketId, context.jobId, priorKey]
    );
  }
  const data = await collectProfileData(pool, payload);
  const documents = (
    await pool.query<ExportDocument>(
      `SELECT d.id,d.original_name,d.storage_key,d.size_bytes::text,d.detected_mime,
              d.checksum,d.state,d.created_at
       FROM documents d LEFT JOIN contract_documents cd ON cd.document_id=d.id
       WHERE d.profile_id=$1 AND d.storage_key IS NOT NULL AND d.scan_state='Available'
         AND d.state IN ('Available','SubmittedForReview','Approved','Rejected','Superseded')
         AND (d.business_record_type<>'contract' OR EXISTS (
           SELECT 1 FROM contract_publications p
           WHERE p.contract_id=d.business_record_id AND p.version_id=cd.contract_version_id))
       ORDER BY d.created_at,d.id LIMIT 501`,
      [profileId]
    )
  ).rows;
  if (documents.length > MAX_DOCUMENTS) throw new Error('Profile export exceeds document limit');
  const bytes = documents.reduce((total, doc) => total + Number(doc.size_bytes), 0);
  if (!Number.isSafeInteger(bytes) || bytes > MAX_DOCUMENT_BYTES)
    throw new Error('Profile export exceeds document size limit');
  await context.setProgress(10);
  const archive = new yazl.ZipFile();
  const contents = documents.map(({ storage_key: _key, ...doc }) => doc);
  const dataBytes = Buffer.from(JSON.stringify({ ...data, documents: contents }, null, 2));
  if (dataBytes.length > 20 * 1024 * 1024)
    throw new Error('Profile export data exceeds size limit');
  archive.addBuffer(dataBytes, 'data.json');
  for (const doc of documents) {
    const safeName = doc.original_name.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 120) || 'file';
    archive.addReadStreamLazy(`documents/${doc.id}/${safeName}`, (callback) => {
      void provider.getObject(doc.storage_key).then(
        (object) => callback(null, Readable.from(object.body as AsyncIterable<Uint8Array>)),
        (error: unknown) => callback(error, Readable.from([]))
      );
    });
  }
  const key = `tmp/profile-exports/${ticketId}/${randomUUID()}.zip`;
  try {
    const uploaded = provider.putObject(
      key,
      Readable.toWeb(archive.outputStream as Readable) as ReadableStream,
      'application/zip'
    );
    archive.end();
    await uploaded;
    if (provider.scheduleExpiration) await provider.scheduleExpiration(key);
    await context.setProgress(90);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Match account-before-job lock order used by authorized retries.
      await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [userId]);
      await client.query('SELECT id FROM async_jobs WHERE id=$1 FOR UPDATE', [context.jobId]);
      const updated = await client.query(
        `UPDATE tickets t SET privacy_export_storage_key=$5,
         privacy_export_expires_at=now()+interval '24 hours',privacy_export_downloaded_at=NULL
       FROM async_jobs j, profiles p, users u
       LEFT JOIN user_profile_contexts c ON c.user_id=u.user_id
       WHERE t.id=$1 AND t.user_id=$2 AND t.profile_id=$3
         AND t.privacy_request_type='export' AND t.privacy_export_job_id=$4
         AND j.id=$4 AND j.status='processing' AND j.lease_token=$6
         AND j.lease_until>clock_timestamp()
         AND j.operating_context='customer'
         AND p.id=t.profile_id AND p.user_id=$2 AND NOT p.archived
         AND u.user_id=$2 AND u.disabled_at IS NULL
         AND ((c.user_id IS NULL AND p.is_default) OR c.profile_id=p.id)
       RETURNING t.id`,
        [ticketId, userId, profileId, context.jobId, key, context.leaseToken]
      );
      if (updated.rowCount !== 1) throw new Error('Profile export authorization changed');
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,operating_context)
       VALUES($1,$2,'profile_export_generated',$3::jsonb,'customer')`,
        [
          randomUUID(),
          userId,
          JSON.stringify({
            ticketId,
            profileId,
            documentCount: documents.length,
            operatingContext: 'customer',
          }),
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { resultUrl: `/api/tickets/lifecycle-requests/${ticketId}/export` };
  } catch (error) {
    await provider.deleteObject(key).catch(() => undefined);
    throw error;
  }
}

/** Expired links are rejected by the API immediately; this reclaims their private objects. */
export async function cleanupExpiredProfileExports(
  pool: Pool = getDbPool(),
  provider: StorageProvider = storage
): Promise<number> {
  const expired = (
    await pool.query<{ id: string; privacy_export_storage_key: string }>(
      `SELECT id,privacy_export_storage_key FROM tickets
       WHERE privacy_export_storage_key IS NOT NULL AND privacy_export_expires_at<=now()
       ORDER BY privacy_export_expires_at,id LIMIT 25`
    )
  ).rows;
  for (const row of expired) {
    await provider.deleteObject(row.privacy_export_storage_key);
    await pool.query(
      `UPDATE tickets SET privacy_export_storage_key=NULL
       WHERE id=$1 AND privacy_export_storage_key=$2 AND privacy_export_expires_at<=now()`,
      [row.id, row.privacy_export_storage_key]
    );
  }
  return expired.length;
}

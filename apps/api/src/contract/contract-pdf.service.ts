import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { contractDocuments, createDbClient, documents, eq, getDbPool } from '@barghsa/db';
import { StorageObjectNotFound, type StorageProvider } from '@barghsa/shared/storage';
import type { PoolClient } from 'pg';
import { DocumentService, recordEvent } from '../documents/document.service.js';
import { notifyDocumentReview } from '../documents/document-notifications.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { readCappedBytes } from '../storage/read-capped-bytes.js';
import { reserveStorageCopy } from '../storage/reserve-storage-copy.js';
import { reserveUpload } from '../upload/upload-reservations.js';
import { renderContractPdf } from './contract-pdf.js';

interface VersionRow {
  profile_id: string;
  contract_number: string;
  service_type: string;
  version_number: number;
  content: unknown;
  created_at: Date;
  amendment_state: string | null;
}

function savedTemplate(content: unknown): { name: string; text: string } | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const template = (content as Record<string, unknown>).template;
  if (!template || typeof template !== 'object' || Array.isArray(template)) return null;
  const row = template as Record<string, unknown>;
  if (typeof row.name !== 'string' || typeof row.text !== 'string' || !row.text.trim()) return null;
  return { name: row.name, text: row.text };
}

@Injectable()
export class ContractPdfService {
  constructor(
    @Inject(DocumentService) private readonly documents: DocumentService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider
  ) {}

  /** Generate the order's initial PDF inside its creation transaction. */
  async generateInitial(
    client: PoolClient,
    contractId: string,
    versionId: string,
    profileId: string,
    actorUserId: string,
    ip: string
  ) {
    const row = (
      await client.query<
        Pick<VersionRow, 'contract_number' | 'version_number' | 'content' | 'created_at'>
      >(
        `SELECT c.contract_number,v.version_number,v.content,v.created_at
         FROM contracts c JOIN contract_versions v ON v.contract_id=c.id
         WHERE c.id=$1 AND v.id=$2 AND c.profile_id=$3 AND c.service_type='electricity'
           AND c.current_version_id=v.id`,
        [contractId, versionId, profileId]
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    const template = savedTemplate(row.content);
    if (!template) throw new ConflictException('Initial contract has no saved template');
    const bytes = await renderContractPdf({
      contractNumber: row.contract_number,
      versionNumber: row.version_number,
      templateName: template.name,
      text: template.text,
      createdAt: row.created_at,
    });
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const fileName = `contract-${row.contract_number}-v${row.version_number}.pdf`;
    const uploadKey = `uploads/contract/${randomUUID()}.pdf`;
    const storageKey = `business-documents/${randomUUID()}/${checksum}`;
    // Both reservations commit independently. A failed order leaves cleanup intent for its objects.
    await reserveUpload({
      key: uploadKey,
      userId: actorUserId,
      fileName,
      contentType: 'application/pdf',
      fileSize: bytes.length,
      category: 'contract',
      expiresIn: 900,
      context: { profileId, purpose: '' },
      independent: true,
    });
    await this.storage.putObject(uploadKey, bytes, 'application/pdf');
    const db = createDbClient(client);
    const created = (
      await db
        .insert(documents)
        .values({
          profileId,
          businessRecordType: 'contract',
          businessRecordId: contractId,
          category: 'contract',
          uploadKey,
          originalName: fileName,
          sizeBytes: bytes.length,
          uploadedBy: actorUserId,
          uploadedByType: 'system',
        })
        .returning()
    )[0]!;
    await db.insert(contractDocuments).values({
      contractId,
      contractVersionId: versionId,
      documentId: created.id,
      role: 'original',
    });
    const actor = { userId: actorUserId };
    await recordEvent(client, created, null, actor, ip);
    const pending = (
      await db
        .update(documents)
        .set({ state: 'PendingScan', scanState: 'Pending' })
        .where(eq(documents.id, created.id))
        .returning()
    )[0]!;
    await recordEvent(client, pending, 'Uploading', actor, ip);
    await reserveStorageCopy(storageKey, {
      purpose: 'system_contract_pdf',
      profileId,
      uploadedBy: actorUserId,
      sourceKey: uploadKey,
    });
    const reserved = await client.query(
      `SELECT storage_key FROM storage_records WHERE storage_key=$1 AND status='removed'
       AND metadata->>'provisionalCopy'='true' AND metadata->>'deletionRequested'='true' FOR UPDATE`,
      [storageKey]
    );
    if (reserved.rowCount !== 1)
      throw new ConflictException('Generated PDF copy reservation expired');
    await this.storage.putObject(storageKey, bytes, 'application/pdf');
    await client.query(
      `UPDATE storage_records SET status='immutable',signed_at=NOW(),signed_by=$2,
       content_type='application/pdf',file_size=$3,category='contract',file_name=$4,
       metadata=$5::jsonb,removed_at=NULL,updated_at=NOW() WHERE storage_key=$1`,
      [
        storageKey,
        actorUserId,
        bytes.length,
        fileName,
        JSON.stringify({
          purpose: 'system_contract_pdf',
          profileId,
          uploadedBy: actorUserId,
          sourceKey: uploadKey,
          sha256: checksum,
        }),
      ]
    );
    await client.query(
      `UPDATE storage_records SET status='active',content_type='application/pdf',file_size=$2,
       metadata=(metadata-'provisionalUpload'-'deletionRequested'-'uploadExpiresAt')
         ||jsonb_build_object('scanState','Available','scanSkippedReason','not_configured','sha256',$3::text),
       removed_at=NULL,updated_at=NOW() WHERE storage_key=$1`,
      [uploadKey, bytes.length, checksum]
    );
    const available = (
      await db
        .update(documents)
        .set({
          state: 'Available',
          scanState: 'Available',
          scanSkippedReason: 'not_configured',
          storageKey,
          detectedMime: 'application/pdf',
          checksum,
        })
        .where(eq(documents.id, created.id))
        .returning()
    )[0]!;
    await recordEvent(client, available, 'PendingScan', actor, ip);
    const submitted = (
      await db
        .update(documents)
        .set({ state: 'SubmittedForReview' })
        .where(eq(documents.id, created.id))
        .returning()
    )[0]!;
    await recordEvent(client, submitted, 'Available', actor, ip);
    await notifyDocumentReview(client, submitted, 'submit');
    return submitted.id;
  }

  async generate(
    contractId: string,
    versionId: string,
    idempotencyKey: string,
    request: AuthenticatedRequest
  ) {
    const row = (
      await getDbPool().query<VersionRow>(
        `SELECT c.profile_id,c.contract_number,c.service_type,v.version_number,v.content,v.created_at,
          amendment.state AS amendment_state
         FROM contracts c JOIN contract_versions v ON v.contract_id=c.id AND v.id=$2
         LEFT JOIN contract_amendments amendment ON amendment.contract_id=c.id AND amendment.version_id=v.id
           AND amendment.base_version_id=c.current_version_id
         WHERE c.id=$1 AND (v.id=c.current_version_id OR amendment.state IN
           ('Draft','AwaitingCustomerAcceptance','AwaitingSignature'))`,
        [contractId, versionId]
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    if (row.service_type !== 'electricity')
      throw new ConflictException('PDF generation requires an electricity contract');
    const template = savedTemplate(row.content);
    if (!template)
      throw new ConflictException('This contract version has no saved electricity template');
    const existing = (
      await getDbPool().query<{ id: string }>(
        `SELECT d.id FROM documents d JOIN contract_documents cd ON cd.document_id=d.id
         WHERE cd.contract_id=$1 AND cd.contract_version_id=$2 AND cd.role='original'
           AND d.uploaded_by_type='system' AND d.state NOT IN ('Removed','Superseded','Quarantined')
         ORDER BY d.created_at DESC LIMIT 1`,
        [contractId, versionId]
      )
    ).rows[0];
    if (existing) return this.documents.get(existing.id, request.session, true);
    const bytes = await renderContractPdf({
      contractNumber: row.contract_number,
      versionNumber: row.version_number,
      templateName: template.name,
      text: template.text,
      createdAt: row.created_at,
    });
    const created = await this.documents.create(
      {
        profileId: row.profile_id,
        businessRecordType: 'contract',
        businessRecordId: contractId,
        contractVersionId: versionId,
        contractRole: row.amendment_state ? 'amendment' : 'original',
        category: 'contract',
        fileName: `contract-${row.contract_number}-v${row.version_number}.pdf`,
        contentType: 'application/pdf',
        fileSize: bytes.length,
        idempotencyKey,
      },
      request,
      true,
      request.ip ?? '',
      true
    );
    const current = await this.documents.get(created.document.id, request.session, true);
    if (current.state === 'SubmittedForReview' || current.state === 'Approved') return current;
    if (current.state === 'Available')
      return this.documents.act(
        current.id,
        'submit',
        { expectedRevision: current.revision, idempotencyKey },
        request.session,
        true,
        request.ip ?? ''
      );
    if (current.state !== 'Uploading' && current.state !== 'PendingScan')
      throw new ConflictException('Generated document cannot resume in this state');
    let present = false;
    try {
      const stored = await this.storage.getObject(created.upload.key);
      const read = await readCappedBytes(stored.body, bytes.length);
      if (
        read.truncated ||
        createHash('sha256').update(read.bytes).digest('hex') !==
          createHash('sha256').update(bytes).digest('hex')
      )
        throw new ConflictException('Generated upload bytes changed; retry with a new version');
      present = true;
    } catch (error) {
      if (!(error instanceof StorageObjectNotFound)) throw error;
    }
    if (!present) await this.storage.putObject(created.upload.key, bytes, 'application/pdf');
    const confirmed = await this.documents.confirm(
      created.document.id,
      { expectedRevision: 1, idempotencyKey },
      request,
      true,
      request.ip ?? ''
    );
    return this.documents.act(
      confirmed.id,
      'submit',
      { expectedRevision: confirmed.revision, idempotencyKey },
      request.session,
      true,
      request.ip ?? ''
    );
  }
}

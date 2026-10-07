import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import { CONTRACT_TEMPLATE_PLACEHOLDER_PATTERN } from '@barghsa/shared/admin';
import { contractDocuments, createDbClient, documents, eq } from '@barghsa/db';
import { reserveStorageCopy } from '../storage/reserve-storage-copy.js';
import { reserveUpload } from '../upload/upload-reservations.js';
import { recordEvent } from '../documents/document.service.js';
import { notifyDocumentReview, notifyDocumentUpload } from '../documents/document-notifications.js';
import { renderContractPdf } from '../contract/contract-pdf.js';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { readCappedBytes } from '../storage/read-capped-bytes.js';
import type { SolarContractReviewInput } from './solar-contract.validation.js';

@Injectable()
export class SolarContractSourceService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  async resolve(client: PoolClient, input: SolarContractReviewInput, amount: bigint) {
    const template = input.source.kind === 'template';
    const source = template
      ? (
          await client.query<Source>(
            `SELECT t.name AS label,v.version_number,v.storage_key,v.file_name,
           v.file_size,v.content_type,NULL::text AS checksum
           FROM contract_template_versions v JOIN contract_templates t ON t.id=v.template_id
           JOIN storage_records s ON s.storage_key=v.storage_key
           WHERE v.id=$1 AND t.status='active' AND s.status='immutable' FOR SHARE OF v,t,s`,
            [input.source.kind === 'template' ? input.source.templateVersionId : null]
          )
        ).rows[0]
      : (
          await client.query<Source>(
            `SELECT d.original_name AS label,NULL::integer AS version_number,d.storage_key,
           d.original_name AS file_name,d.size_bytes AS file_size,d.detected_mime AS content_type,
           d.checksum FROM documents d JOIN storage_records s ON s.storage_key=d.storage_key
           WHERE d.id=$1 AND d.profile_id=$2 AND d.business_record_type='solar_request'
             AND d.business_record_id=$3 AND d.category='document'
             AND d.state IN ('Available','Approved') AND d.scan_state='Available'
             AND s.status='immutable' FOR SHARE OF d,s`,
            [
              input.source.kind === 'document' ? input.source.documentId : null,
              input.profileId,
              input.requestId,
            ]
          )
        ).rows[0];
    if (!source) throw new ConflictException('Select an available contract source');
    const limit = (template ? 10 : 50) * 1024 * 1024;
    if (
      !Number.isSafeInteger(Number(source.file_size)) ||
      Number(source.file_size) <= 0 ||
      Number(source.file_size) > limit
    )
      throw new ConflictException('Contract source size is invalid');
    let bytes: Buffer;
    try {
      const object = await this.storage.getObject(source.storage_key);
      const read = await readCappedBytes(object.body, limit);
      if (read.truncated || read.bytes.length !== Number(source.file_size)) throw new Error('size');
      bytes = Buffer.from(read.bytes);
    } catch {
      throw new ServiceUnavailableException('Contract source could not be read');
    }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (!template && checksum !== source.checksum)
      throw new ConflictException('Contract source checksum changed');
    let rendered: { name: string; text: string } | null = null;
    if (template) {
      const profile = (
        await client.query<{ customer_name: string }>(
          `SELECT COALESCE(NULLIF(lp.legal_name,''),NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),
         NULLIF(p.title,''),p.id::text) AS customer_name FROM profiles p
         LEFT JOIN legal_profiles lp ON lp.id=p.id WHERE p.id=$1`,
          [input.profileId]
        )
      ).rows[0];
      if (!profile) throw new ConflictException('Contract customer is unavailable');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new ConflictException('Contract template must contain UTF-8 text');
      }
      const values: Record<string, string> = {
        date: new Date().toISOString().slice(0, 10),
        customerName: profile.customer_name,
        amount: amount.toString(),
      };
      text = text.replace(CONTRACT_TEMPLATE_PLACEHOLDER_PATTERN, (_token, name: string) => {
        if (!Object.hasOwn(values, name))
          throw new ConflictException('Unsupported contract template placeholder');
        return values[name]!;
      });
      if (!text.trim()) throw new ConflictException('Contract template is empty');
      rendered = { name: source.label, text: `${text.trim()}\n\n${input.text}` };
    }
    return {
      bytes,
      storageKey: source.storage_key,
      rendered,
      snapshot: {
        ...input.source,
        label: source.label,
        versionNumber: source.version_number,
        checksum,
        sizeBytes: bytes.length,
        fileName: source.file_name,
        contentType: source.content_type,
      },
    };
  }

  async attach(
    client: PoolClient,
    source: Awaited<ReturnType<SolarContractSourceService['resolve']>>,
    contractId: string,
    versionId: string,
    profileId: string,
    actorId: string,
    ip: string
  ) {
    const contract = (
      await client.query<{ contract_number: string; created_at: Date }>(
        'SELECT contract_number,created_at FROM contracts WHERE id=$1 AND profile_id=$2',
        [contractId, profileId]
      )
    ).rows[0];
    if (!contract) throw new ConflictException('Contract is unavailable');
    const bytes = source.rendered
      ? await renderContractPdf({
          contractNumber: contract.contract_number,
          versionNumber: 1,
          templateName: source.rendered.name,
          text: source.rendered.text,
          createdAt: contract.created_at,
        })
      : source.bytes;
    const mime = source.rendered ? 'application/pdf' : source.snapshot.contentType;
    const fileName = source.rendered
      ? `contract-${contract.contract_number}-v1.pdf`
      : source.snapshot.fileName;
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const uploadKey = `uploads/contract/${randomUUID()}`;
    const storageKey = `business-documents/${randomUUID()}/${checksum}`;
    await reserveUpload({
      key: uploadKey,
      userId: actorId,
      fileName,
      contentType: mime,
      fileSize: bytes.length,
      category: 'contract',
      expiresIn: 900,
      context: { profileId, purpose: '' },
      independent: true,
    });
    await this.storage.putObject(uploadKey, bytes, mime);
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
          uploadedBy: actorId,
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
    await recordEvent(client, created, null, { userId: actorId }, ip);
    const pending = (
      await db
        .update(documents)
        .set({ state: 'PendingScan', scanState: 'Pending' })
        .where(eq(documents.id, created.id))
        .returning()
    )[0]!;
    await recordEvent(client, pending, 'Uploading', { userId: actorId }, ip);
    const metadata = {
      purpose: 'solar_contract_source',
      profileId,
      uploadedBy: actorId,
      sourceKey: uploadKey,
      selectedSourceKey: source.storageKey,
      selectedSource: source.snapshot,
      sha256: checksum,
    };
    await reserveStorageCopy(storageKey, metadata);
    const reservation = await client.query(
      `SELECT storage_key FROM storage_records WHERE storage_key=$1
      AND status='removed' AND metadata->>'provisionalCopy'='true'
      AND metadata->>'deletionRequested'='true' FOR UPDATE`,
      [storageKey]
    );
    if (reservation.rowCount !== 1)
      throw new ConflictException('Contract copy reservation expired');
    await this.storage.putObject(storageKey, bytes, mime);
    await client.query(
      `UPDATE storage_records SET status='immutable',signed_at=NOW(),signed_by=$2,
      content_type=$3,file_size=$4,category='contract',file_name=$5,metadata=$6::jsonb,
      removed_at=NULL,updated_at=NOW() WHERE storage_key=$1`,
      [storageKey, actorId, mime, bytes.length, fileName, JSON.stringify(metadata)]
    );
    const scan = Boolean(process.env['DOCUMENT_CLAMAV_HOST']?.trim());
    await client.query(
      `UPDATE storage_records SET status='active',content_type=$2,file_size=$3,
      metadata=(metadata-'provisionalUpload'-'deletionRequested'-'uploadExpiresAt')
      ||jsonb_build_object('scanState',$4::text,'scanSkippedReason',$5::text,'sha256',$6::text),
      removed_at=NULL,updated_at=NOW() WHERE storage_key=$1`,
      [
        uploadKey,
        mime,
        bytes.length,
        scan ? 'Pending' : 'Available',
        scan ? null : 'not_configured',
        checksum,
      ]
    );
    const available = (
      await db
        .update(documents)
        .set({
          state: scan ? 'PendingScan' : 'Available',
          scanState: scan ? 'Pending' : 'Available',
          scanSkippedReason: scan ? null : 'not_configured',
          storageKey,
          detectedMime: mime,
          checksum,
        })
        .where(eq(documents.id, created.id))
        .returning()
    )[0]!;
    await recordEvent(client, available, 'PendingScan', { userId: actorId }, ip);
    await notifyDocumentUpload(client, available);
    if (scan)
      await client.query('INSERT INTO document_scan_jobs(document_id) VALUES($1)', [created.id]);
    else {
      const submitted = (
        await db
          .update(documents)
          .set({ state: 'SubmittedForReview' })
          .where(eq(documents.id, created.id))
          .returning()
      )[0]!;
      await recordEvent(client, submitted, 'Available', { userId: actorId }, ip);
      await notifyDocumentReview(client, submitted, 'submit');
    }
    return created.id;
  }
}

interface Source {
  label: string;
  version_number: number | null;
  storage_key: string;
  file_name: string;
  file_size: string | number;
  content_type: string;
  checksum: string | null;
}

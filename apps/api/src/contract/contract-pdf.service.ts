import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { getDbPool } from '@barghsa/db';
import { StorageObjectNotFound, type StorageProvider } from '@barghsa/shared/storage';
import { DocumentService } from '../documents/document.service.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { readCappedBytes } from '../storage/read-capped-bytes.js';
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

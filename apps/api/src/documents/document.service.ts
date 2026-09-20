import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  createDbClient,
  desc,
  documents,
  documentEvents,
  contractDocuments,
  eq,
  getDbPool,
  lt,
  ne,
  sql,
  type Document,
} from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { UploadService } from '../upload/upload.service.js';
import { idempotentMutation } from '../database/idempotency.js';
import { documentAccess, staffDocumentRead, type DocumentActor } from './document-access.js';
import { DocumentStorageService } from './document-storage.service.js';
import type { DocumentCommand, DocumentCreate, DocumentListSchema } from './document-validation.js';
import type { z } from 'zod';
import { notifyDocumentReview } from './document-notifications.js';

type LinkedDocument = {
  document: Document;
  contractVersionId: string | null;
  contractRole: string | null;
};
function visible(staff: boolean) {
  return staff
    ? sql`true`
    : sql`(${documents.state}<>'Removed' AND (${documents.businessRecordType}<>'contract'
    OR EXISTS (SELECT 1 FROM contract_publications p WHERE p.contract_id=${documents.businessRecordId}
      AND p.version_id=${contractDocuments.contractVersionId})))`;
}
function dto(row: LinkedDocument) {
  const d = row.document;
  return {
    id: d.id,
    profileId: d.profileId,
    businessRecordType: d.businessRecordType,
    businessRecordId: d.businessRecordId,
    contractVersionId: row.contractVersionId,
    contractRole: row.contractRole,
    category: d.category,
    state: d.state,
    scanState: d.scanState,
    scanSkippedReason: d.scanSkippedReason,
    originalName: d.originalName,
    detectedMime: d.detectedMime,
    sizeBytes: d.sizeBytes,
    checksum: d.checksum,
    uploadedBy: d.uploadedBy,
    uploadedByType: d.uploadedByType,
    supersedesDocumentId: d.supersedesDocumentId,
    rejectionReason: d.rejectionReason,
    reviewComment: d.state === 'Quarantined' ? null : d.reviewComment,
    revision: d.revision,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    removedAt: d.removedAt,
  };
}
async function load(
  client: PoolClient,
  id: string,
  profileId: string,
  staff: boolean,
  lock = false
) {
  const query = createDbClient(client)
    .select({
      document: documents,
      contractVersionId: contractDocuments.contractVersionId,
      contractRole: contractDocuments.role,
    })
    .from(documents)
    .leftJoin(contractDocuments, eq(contractDocuments.documentId, documents.id))
    .where(and(eq(documents.id, id), eq(documents.profileId, profileId), visible(staff)));
  const row = (await (lock ? query.for('update', { of: documents }) : query))[0];
  if (!row) throw new NotFoundException();
  return row;
}
async function recordEvent(
  client: PoolClient,
  document: Document,
  previousState: Document['state'] | null,
  actor: DocumentActor,
  ip: string,
  reason?: string
) {
  await createDbClient(client)
    .insert(documentEvents)
    .values({
      documentId: document.id,
      revision: document.revision,
      state: document.state,
      previousState,
      actorId: actor.userId,
      reason: reason ?? null,
    });
  await client.query(
    'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
    [
      uuidv7(),
      actor.userId,
      'document_state_changed',
      JSON.stringify({
        documentId: document.id,
        revision: document.revision,
        previousState,
        state: document.state,
        reason,
      }),
      uuidv7(),
      ip,
    ]
  );
}

@Injectable()
export class DocumentService {
  constructor(
    @Inject(UploadService) private readonly uploads: UploadService,
    @Inject(DocumentStorageService) private readonly storage: DocumentStorageService
  ) {}

  private async context(id: string) {
    const row = (
      await createDbClient(getDbPool())
        .select({ profileId: documents.profileId, kind: documents.businessRecordType })
        .from(documents)
        .where(eq(documents.id, id))
    )[0];
    if (!row || row.kind === 'solar_request') throw new NotFoundException();
    return { profileId: row.profileId, kind: row.kind };
  }

  private async business(
    client: PoolClient,
    input: DocumentCreate,
    profileId: string,
    staff: boolean
  ) {
    if (input.businessRecordType === 'standalone') return;
    const table = { contract: 'contracts', invoice: 'invoices', order: 'orders' }[
      input.businessRecordType
    ];
    const record = (
      await client.query(`SELECT * FROM ${table} WHERE id=$1 AND profile_id=$2 FOR SHARE`, [
        input.businessRecordId,
        profileId,
      ])
    ).rows[0];
    if (!record) throw new NotFoundException();
    if (input.businessRecordType !== 'contract') return;
    if (record.current_version_id !== input.contractVersionId)
      throw new ConflictException('Select the current contract version');
    if (record.signed_at || ['Signed', 'Active', 'Completed', 'Cancelled'].includes(record.state))
      throw new ConflictException('This contract version no longer accepts documents');
    if (!staff) {
      if (
        input.contractRole !== 'signed' ||
        !['Accepted', 'AwaitingSignature'].includes(record.state)
      )
        throw new ConflictException(
          'Accept the published contract before uploading its signed copy'
        );
      const publication = await client.query(
        'SELECT 1 FROM contract_publications WHERE contract_id=$1 AND version_id=$2',
        [input.businessRecordId, input.contractVersionId]
      );
      if (!publication.rows.length) throw new NotFoundException();
    }
  }

  async create(input: DocumentCreate, request: AuthenticatedRequest, staff: boolean, ip: string) {
    if (staff && !input.profileId) throw new BadRequestException('Profile is required');
    return documentAccess(
      request.session,
      input.businessRecordType,
      true,
      staff,
      input.profileId,
      async (client, profileId) => {
        await this.business(client, input, profileId, staff);
        if (input.supersedesDocumentId) {
          const prior = await load(client, input.supersedesDocumentId, profileId, staff, true);
          if (
            prior.document.businessRecordType !== input.businessRecordType ||
            prior.document.businessRecordId !== (input.businessRecordId ?? null)
          )
            throw new NotFoundException();
          if (!['Available', 'Approved', 'Rejected'].includes(prior.document.state))
            throw new ConflictException('Document cannot be replaced in this state');
          if (!staff && input.businessRecordType === 'contract' && prior.contractRole !== 'signed')
            throw new ConflictException('Customers may replace only signed-copy uploads');
        }
        const result = await idempotentMutation(
          client,
          'document_create',
          { ...input, profileId },
          request.session,
          async () => {
            const upload = await this.uploads.getPresignedUrl(
              {
                fileName: input.fileName,
                contentType: input.contentType,
                fileSize: input.fileSize,
                category: input.category,
                purpose: staff ? 'staff_business_document' : 'business_document',
                profileId,
              },
              request
            );
            const document = (
              await createDbClient(client)
                .insert(documents)
                .values({
                  profileId,
                  businessRecordType: input.businessRecordType,
                  businessRecordId: input.businessRecordId ?? null,
                  category: input.category,
                  uploadKey: upload.key,
                  originalName: input.fileName,
                  sizeBytes: input.fileSize,
                  uploadedBy: request.session.userId,
                  uploadedByType: staff ? 'staff' : 'customer',
                  supersedesDocumentId: input.supersedesDocumentId ?? null,
                })
                .returning()
            )[0]!;
            if (input.businessRecordType === 'contract')
              await createDbClient(client).insert(contractDocuments).values({
                contractId: input.businessRecordId!,
                contractVersionId: input.contractVersionId!,
                documentId: document.id,
                role: input.contractRole!,
              });
            await recordEvent(client, document, null, request.session, ip);
            return {
              document: dto(await load(client, document.id, profileId, staff)),
              upload,
              expiresAt: new Date(Date.now() + upload.expiresIn * 1000).toISOString(),
            };
          }
        );
        if (Date.parse(result.expiresAt) <= Date.now())
          throw new ConflictException('Upload link expired; start a new upload');
        return result;
      }
    );
  }

  async list(input: z.infer<typeof DocumentListSchema>, actor: DocumentActor, staff: boolean) {
    const read = async (client: PoolClient, profileId?: string) => {
      const rows = await createDbClient(client)
        .select({
          document: documents,
          contractVersionId: contractDocuments.contractVersionId,
          contractRole: contractDocuments.role,
        })
        .from(documents)
        .leftJoin(contractDocuments, eq(contractDocuments.documentId, documents.id))
        .where(
          and(
            profileId ? eq(documents.profileId, profileId) : undefined,
            eq(documents.businessRecordType, input.businessRecordType),
            visible(staff),
            input.businessRecordId
              ? eq(documents.businessRecordId, input.businessRecordId)
              : undefined,
            input.before ? lt(documents.id, input.before) : undefined,
            input.state ? eq(documents.state, input.state) : ne(documents.state, 'Removed')
          )
        )
        .orderBy(desc(documents.id))
        .limit(input.limit + 1);
      return {
        documents: rows.slice(0, input.limit).map(dto),
        nextBefore: rows.length > input.limit ? rows[input.limit - 1]!.document.id : null,
      };
    };
    return staff
      ? staffDocumentRead(actor, input.businessRecordType, (client) =>
          read(client, input.profileId)
        )
      : documentAccess(actor, input.businessRecordType, false, false, input.profileId, read);
  }

  async get(id: string, actor: DocumentActor, staff: boolean) {
    const context = await this.context(id);
    return documentAccess(
      actor,
      context.kind,
      false,
      staff,
      context.profileId,
      async (client, profileId) => {
        const row = await load(client, id, profileId, staff);
        const history = await createDbClient(client)
          .select()
          .from(documentEvents)
          .where(eq(documentEvents.documentId, id))
          .orderBy(documentEvents.revision);
        return {
          ...dto(row),
          history: history.map((event) =>
            !staff && event.state === 'Quarantined' ? { ...event, reason: null } : event
          ),
        };
      }
    );
  }

  async download(id: string, actor: DocumentActor, staff: boolean) {
    const context = await this.context(id);
    return documentAccess(
      actor,
      context.kind,
      false,
      staff,
      context.profileId,
      async (client, profileId) => {
        const row = await load(client, id, profileId, staff);
        if (
          !row.document.storageKey ||
          ['Uploading', 'PendingScan', 'Quarantined'].includes(row.document.state)
        )
          throw new ConflictException('Document is not available for download');
        return { url: await this.storage.download(row.document.storageKey), expiresIn: 300 };
      }
    );
  }

  private async mutableContract(client: PoolClient, row: LinkedDocument, staff: boolean) {
    if (row.document.businessRecordType !== 'contract') return;
    const contract = (
      await client.query(
        'SELECT state,current_version_id,signed_at FROM contracts WHERE id=$1 FOR SHARE',
        [row.document.businessRecordId]
      )
    ).rows[0];
    if (
      !contract ||
      contract.current_version_id !== row.contractVersionId ||
      contract.signed_at ||
      ['Signed', 'Active', 'Completed', 'Cancelled'].includes(contract.state)
    )
      throw new ConflictException('This contract version no longer accepts document changes');
    if (
      !staff &&
      (row.contractRole !== 'signed' || !['Accepted', 'AwaitingSignature'].includes(contract.state))
    )
      throw new ConflictException(
        'Customers may change only signed copies of their accepted contract'
      );
  }

  async confirm(
    id: string,
    input: DocumentCommand,
    request: AuthenticatedRequest,
    staff: boolean,
    ip: string
  ) {
    const context = await this.context(id);
    const actor = request.session;
    const command = { ...input, id };
    // Persist PendingScan independently so failed inspection/copying remains retryable.
    const pending = await documentAccess(
      actor,
      context.kind,
      true,
      staff,
      context.profileId,
      async (client, profileId) => {
        const initial = await load(client, id, profileId, staff);
        if (
          initial.document.uploadedBy !== actor.userId ||
          initial.document.uploadedByType !== (staff ? 'staff' : 'customer')
        )
          throw new ConflictException('Only the original uploader may confirm this upload');
        return idempotentMutation(client, 'document_confirm_pending', command, actor, async () => {
          await this.mutableContract(client, initial, staff);
          const row = await load(client, id, profileId, staff, true);
          if (
            row.document.revision !== input.expectedRevision ||
            row.document.state !== 'Uploading'
          )
            throw new ConflictException('Document changed; refresh before confirming');
          const changed = (
            await createDbClient(client)
              .update(documents)
              .set({ state: 'PendingScan', scanState: 'Pending' })
              .where(eq(documents.id, id))
              .returning()
          )[0]!;
          await recordEvent(client, changed, 'Uploading', actor, ip);
          return { revision: changed.revision };
        });
      }
    );
    return documentAccess(
      actor,
      context.kind,
      true,
      staff,
      context.profileId,
      async (client, profileId) => {
        const initial = await load(client, id, profileId, staff);
        if (initial.document.uploadedBy !== actor.userId)
          throw new ConflictException('Upload belongs to another actor');
        return idempotentMutation(client, 'document_confirm', command, actor, async () => {
          await this.mutableContract(client, initial, staff);
          const row = await load(client, id, profileId, staff, true);
          if (row.document.revision !== pending.revision || row.document.state !== 'PendingScan')
            throw new ConflictException('Document changed during confirmation');
          const previous = row.document.supersedesDocumentId
            ? await load(client, row.document.supersedesDocumentId, profileId, staff, true)
            : null;
          if (previous && !['Available', 'Approved', 'Rejected'].includes(previous.document.state))
            throw new ConflictException(
              'Another replacement already changed the previous document'
            );
          await this.uploads.recordUpload(row.document.uploadKey, {}, request);
          const copy = await this.storage.seal(
            client,
            row.document.uploadKey,
            actor.userId,
            profileId,
            staff
          );
          const changed = (
            await createDbClient(client)
              .update(documents)
              .set({
                state: 'Available',
                scanState: 'Available',
                scanSkippedReason: 'not_configured',
                ...copy,
              })
              .where(eq(documents.id, id))
              .returning()
          )[0]!;
          await recordEvent(client, changed, 'PendingScan', actor, ip);
          if (changed.supersedesDocumentId) {
            const replaced = (
              await createDbClient(client)
                .update(documents)
                .set({ state: 'Superseded' })
                .where(eq(documents.id, previous!.document.id))
                .returning()
            )[0]!;
            await recordEvent(client, replaced, previous!.document.state, actor, ip);
          }
          return dto({ ...row, document: changed });
        });
      }
    );
  }

  async act(
    id: string,
    action: 'submit' | 'approve' | 'reject' | 'request-changes' | 'quarantine' | 'remove',
    input: DocumentCommand,
    actor: DocumentActor,
    staff: boolean,
    ip: string
  ) {
    if (!staff && !['submit', 'remove'].includes(action))
      throw new BadRequestException('Staff review is required');
    if (['reject', 'request-changes', 'quarantine'].includes(action) && !input.reason)
      throw new BadRequestException('A reason is required');
    const context = await this.context(id);
    return documentAccess(
      actor,
      context.kind,
      true,
      staff,
      context.profileId,
      async (client, profileId) => {
        const initial = await load(client, id, profileId, staff);
        if (!staff && context.kind === 'contract' && initial.contractRole !== 'signed')
          throw new ConflictException('Customers may change only signed-copy uploads');
        return idempotentMutation(
          client,
          `document_${action}`,
          { ...input, id },
          actor,
          async () => {
            if (action !== 'quarantine') await this.mutableContract(client, initial, staff);
            const row = await load(client, id, profileId, staff, true);
            if (row.document.revision !== input.expectedRevision)
              throw new ConflictException('Document changed; refresh before continuing');
            const target: Record<typeof action, Document['state']> = {
              submit: 'SubmittedForReview',
              approve: 'Approved',
              reject: 'Rejected',
              'request-changes': 'Available',
              quarantine: 'Quarantined',
              remove: 'Removed',
            };
            const allowed =
              action === 'submit'
                ? ['Available']
                : action === 'remove'
                  ? ['Uploading', 'PendingScan', 'Superseded', 'Quarantined']
                  : action === 'quarantine'
                    ? [
                        'Uploading',
                        'PendingScan',
                        'Available',
                        'SubmittedForReview',
                        'Approved',
                        'Rejected',
                        'Superseded',
                      ]
                    : ['SubmittedForReview'];
            if (!allowed.includes(row.document.state))
              throw new ConflictException('Action is not permitted in this document state');
            const changed = (
              await createDbClient(client)
                .update(documents)
                .set({
                  state: target[action],
                  ...(action === 'quarantine' ? { scanState: 'Quarantined' as const } : {}),
                  rejectionReason: action === 'reject' ? input.reason! : null,
                  reviewComment: input.reason ?? null,
                })
                .where(eq(documents.id, id))
                .returning()
            )[0]!;
            await recordEvent(client, changed, row.document.state, actor, ip, input.reason);
            if (action !== 'remove')
              await notifyDocumentReview(client, changed, action, input.reason);
            return dto({ ...row, document: changed });
          }
        );
      }
    );
  }
}

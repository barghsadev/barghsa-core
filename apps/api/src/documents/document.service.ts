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
async function writablePendingAmendment(
  client: PoolClient,
  contractId: string,
  versionId: string,
  role: string,
  staff: boolean
) {
  return (
    (
      await client.query(
        `SELECT 1 FROM contract_amendments a JOIN contracts c ON c.id=a.contract_id
       WHERE a.contract_id=$1 AND a.version_id=$2 AND a.base_version_id=c.current_version_id
         AND c.state IN ('Accepted','Signed','Active')
         AND (($3::text='amendment' AND $4::boolean AND a.state IN ('Draft','AwaitingCustomerAcceptance'))
           OR ($3::text='signed' AND a.state='AwaitingSignature')) FOR SHARE OF c`,
        [contractId, versionId, role, staff]
      )
    ).rowCount === 1
  );
}
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
        .select({
          profileId: documents.profileId,
          kind: documents.businessRecordType,
          businessRecordId: documents.businessRecordId,
        })
        .from(documents)
        .where(eq(documents.id, id))
    )[0];
    if (!row) throw new NotFoundException();
    return { profileId: row.profileId, kind: row.kind, businessRecordId: row.businessRecordId };
  }

  private async business(
    client: PoolClient,
    input: DocumentCreate,
    profileId: string,
    staff: boolean
  ) {
    if (input.businessRecordType === 'standalone') return;
    const table = {
      contract: 'contracts',
      invoice: 'invoices',
      order: 'orders',
      solar_request: 'solar_construction_requests',
    }[input.businessRecordType];
    const record = (
      await client.query(`SELECT * FROM ${table} WHERE id=$1 AND profile_id=$2 FOR SHARE`, [
        input.businessRecordId,
        profileId,
      ])
    ).rows[0];
    if (!record) throw new NotFoundException();
    if (input.businessRecordType === 'solar_request') {
      const documentStage = [
        'submitted',
        'uploading_documents',
        'documents_under_review',
        'changes_requested',
      ].includes(record.status);
      const postalImage =
        record.status === 'waiting_for_postal_submission' &&
        input.category === 'image' &&
        !staff &&
        !!(
          await client.query(
            `SELECT 1 FROM solar_construction_postal WHERE request_id=$1
               AND status IN ('waiting_for_shipment','incomplete','not_received')`,
            [input.businessRecordId]
          )
        ).rows.length;
      if (!documentStage && !postalImage)
        throw new ConflictException('Solar request no longer accepts documents');
    }
    if (input.businessRecordType !== 'contract') return;
    if (
      input.contractRole &&
      input.contractVersionId &&
      (await writablePendingAmendment(
        client,
        input.businessRecordId!,
        input.contractVersionId,
        input.contractRole,
        staff
      ))
    )
      return;
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
        const savingOrder =
          input.businessRecordType === 'order'
            ? (
                await client.query<{ status: string }>(
                  'SELECT status FROM saving_orders WHERE order_id=$1 FOR SHARE',
                  [input.businessRecordId]
                )
              ).rows[0]
            : null;
        if (savingOrder && ['completed', 'cancelled', 'rejected'].includes(savingOrder.status))
          throw new ConflictException('This saving order no longer accepts documents');
        if (input.supersedesDocumentId) {
          if (input.businessRecordType === 'solar_request') {
            const phase = (
              await client.query<{ status: string }>(
                'SELECT status FROM solar_construction_requests WHERE id=$1',
                [input.businessRecordId]
              )
            ).rows[0]?.status;
            if (phase === 'waiting_for_postal_submission')
              throw new ConflictException(
                'Upload a new postal receipt image instead of replacing a reviewed file'
              );
          }
          const prior = await load(client, input.supersedesDocumentId, profileId, staff, true);
          if (
            prior.document.businessRecordType !== input.businessRecordType ||
            prior.document.businessRecordId !== (input.businessRecordId ?? null)
          )
            throw new NotFoundException();
          if (
            savingOrder &&
            !staff &&
            (prior.document.uploadedBy !== request.session.userId ||
              prior.document.state !== 'Available')
          )
            throw new ConflictException('Only your unsubmitted saving document may be replaced');
          if (
            input.businessRecordType === 'solar_request' &&
            !staff &&
            (prior.document.uploadedBy !== request.session.userId ||
              prior.document.uploadedByType !== 'customer')
          )
            throw new ConflictException('Only your solar document may be replaced');
          if (
            !['Available', 'Approved', 'Rejected'].includes(prior.document.state) &&
            !(
              input.businessRecordType === 'solar_request' &&
              prior.document.state === 'SubmittedForReview'
            )
          )
            throw new ConflictException('Document cannot be replaced in this state');
          if (
            input.businessRecordType === 'contract' &&
            (prior.contractVersionId !== input.contractVersionId ||
              prior.contractRole !== input.contractRole)
          )
            throw new ConflictException('Replacement must keep the contract version and role');
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
            if (input.businessRecordType === 'solar_request')
              await client.query(
                `INSERT INTO solar_construction_documents
                 (request_id,document_id,file_name,uploaded_by)
                 VALUES($1,$2,$3,$4)`,
                [input.businessRecordId, document.id, input.fileName, request.session.userId]
              );
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
      },
      input.businessRecordId
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
            input.category ? eq(documents.category, input.category) : undefined,
            input.contractVersionId
              ? eq(contractDocuments.contractVersionId, input.contractVersionId)
              : undefined,
            input.q
              ? sql`strpos(lower(${documents.originalName}), lower(${input.q})) > 0`
              : undefined,
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
      ? staffDocumentRead(
          actor,
          input.businessRecordType,
          (client) => read(client, input.profileId),
          input.businessRecordId
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
      },
      context.businessRecordId ?? undefined
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
      },
      context.businessRecordId ?? undefined
    );
  }

  private async mutableContract(client: PoolClient, row: LinkedDocument, staff: boolean) {
    if (row.document.businessRecordType !== 'contract') return;
    if (
      row.contractRole &&
      row.contractVersionId &&
      row.document.businessRecordId &&
      (await writablePendingAmendment(
        client,
        row.document.businessRecordId,
        row.contractVersionId,
        row.contractRole,
        staff
      ))
    )
      return;
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
      },
      context.businessRecordId ?? undefined
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
          if (
            previous &&
            ![
              'Available',
              'Approved',
              'Rejected',
              ...(context.kind === 'solar_request' ? ['SubmittedForReview'] : []),
            ].includes(previous.document.state)
          )
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
      },
      context.businessRecordId ?? undefined
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
        const savingDocument =
          context.kind === 'order' && initial.document.businessRecordId
            ? !!(
                await client.query('SELECT 1 FROM saving_orders WHERE order_id=$1', [
                  initial.document.businessRecordId,
                ])
              ).rows.length
            : false;
        const solarDocument = context.kind === 'solar_request';
        if (solarDocument) {
          const solar = (
            await client.query<{ status: string }>(
              'SELECT status FROM solar_construction_requests WHERE id=$1 FOR SHARE',
              [context.businessRecordId]
            )
          ).rows[0];
          const documentStage =
            !!solar &&
            [
              'submitted',
              'uploading_documents',
              'documents_under_review',
              'changes_requested',
            ].includes(solar.status);
          const postalImage =
            solar?.status === 'waiting_for_postal_submission' &&
            initial.document.category === 'image' &&
            !staff &&
            !!(
              await client.query(
                `SELECT 1 FROM solar_construction_postal WHERE request_id=$1
                   AND status IN ('waiting_for_shipment','incomplete','not_received')`,
                [context.businessRecordId]
              )
            ).rows.length;
          if (
            !documentStage &&
            !(
              postalImage &&
              action === 'remove' &&
              ['Uploading', 'PendingScan', 'Available'].includes(initial.document.state)
            )
          )
            throw new ConflictException('Solar request no longer accepts document changes');
          if (
            staff &&
            ['approve', 'reject', 'request-changes'].includes(action) &&
            !['documents_under_review', 'changes_requested'].includes(solar.status)
          )
            throw new ConflictException('Solar documents have not been submitted for review');
        }
        if (
          solarDocument &&
          !staff &&
          (initial.document.uploadedBy !== actor.userId ||
            initial.document.uploadedByType !== 'customer')
        )
          throw new ConflictException('Only your solar document may be changed');
        if (
          savingDocument &&
          !staff &&
          (initial.document.uploadedBy !== actor.userId ||
            !['Available', 'Uploading', 'PendingScan'].includes(initial.document.state))
        )
          throw new ConflictException('Only your unsubmitted saving document may be changed');
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
                  ? (savingDocument || solarDocument) && !staff
                    ? solarDocument
                      ? [
                          'Uploading',
                          'PendingScan',
                          'Available',
                          'SubmittedForReview',
                          'Approved',
                          'Rejected',
                        ]
                      : ['Uploading', 'PendingScan', 'Available']
                    : ['Uploading', 'PendingScan', 'Superseded', 'Quarantined']
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
                    : solarDocument &&
                        staff &&
                        ['approve', 'reject', 'request-changes'].includes(action)
                      ? ['SubmittedForReview', 'Available']
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
            if (solarDocument && staff && ['approve', 'reject'].includes(action))
              await client.query(
                `UPDATE solar_construction_documents SET staff_status=$2,staff_reason=$3,
                 staff_reviewed_by=$4,staff_reviewed_at=NOW() WHERE document_id=$1`,
                [
                  id,
                  action === 'approve' ? 'approved' : 'rejected',
                  action === 'reject' ? input.reason : null,
                  actor.userId,
                ]
              );
            if (action !== 'remove')
              await notifyDocumentReview(client, changed, action, input.reason);
            return dto({ ...row, document: changed });
          }
        );
      },
      context.businessRecordId ?? undefined
    );
  }
}

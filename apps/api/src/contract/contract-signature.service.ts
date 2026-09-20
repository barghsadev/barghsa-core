import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  staffContractMutation,
  contractIdempotency,
  auditContract,
  type ContractActor,
} from './contract-transactions.js';
import { customerContractAccess } from './contract-customer-access.js';
import { staffDocumentRead } from '../documents/document-access.js';
import { activeProfileSql } from '../profiles/profile-context.js';
import { notifyContractReview } from './contract-review-notifications.js';
import type {
  SignatureRequestInput,
  SignatureRecordInput,
} from './contract-signature-validation.js';
interface Parent {
  id: string;
  profile_id: string;
  current_version_id: string;
  state: string;
  signed_at: Date | null;
}
interface RequestRow {
  id: string;
  request_number: number;
  original_document_id: string;
  requested_by: string;
  requested_at: Date;
  original_name: string;
  document_state: string;
}
interface SignatureRow {
  request_id: string;
  signed_document_id: string;
  recorded_by: string;
  recorded_by_type: 'customer' | 'staff';
  recorded_at: Date;
  original_name: string;
  document_state: string;
  uploaded_by: string;
  uploaded_by_type: string;
}
@Injectable()
export class ContractSignatureService {
  private async parent(client: PoolClient, id: string, profileId?: string, lock = false) {
    const row = (
      await client.query<Parent>(
        `SELECT id,profile_id,current_version_id,state,signed_at FROM contracts WHERE id=$1 AND ($2::uuid IS NULL OR profile_id=$2)${lock ? ' FOR UPDATE' : ''}`,
        [id, profileId ?? null]
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    return row;
  }
  private async latest(client: PoolClient, versionId: string) {
    return (
      await client.query<RequestRow>(
        `SELECT r.id,r.request_number,r.original_document_id,r.requested_by,r.requested_at,d.original_name,d.state AS document_state
   FROM contract_signature_requests r JOIN documents d ON d.id=r.original_document_id WHERE r.version_id=$1 ORDER BY r.request_number DESC LIMIT 1`,
        [versionId]
      )
    ).rows[0];
  }
  private async visibleVersion(
    client: PoolClient,
    parent: Parent,
    staff: boolean,
    versionId?: string
  ) {
    const row = (
      await client.query<{ id: string }>(
        `SELECT v.id FROM contract_versions v WHERE v.contract_id=$1 AND ($2::uuid IS NULL OR v.id=$2)
   AND ($3::boolean OR EXISTS(SELECT 1 FROM contract_publications p WHERE p.version_id=v.id AND p.contract_id=v.contract_id)) ORDER BY v.version_number DESC LIMIT 1`,
        [parent.id, versionId ?? null, staff]
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    return row.id;
  }
  private async view(
    client: PoolClient,
    parent: Parent,
    versionId: string,
    staff: boolean,
    canWrite: boolean
  ) {
    const request = await this.latest(client, versionId);
    const signed = (
      await client.query<SignatureRow>(
        `SELECT s.request_id,s.signed_document_id,s.recorded_by,s.recorded_by_type,s.recorded_at,d.original_name,d.state AS document_state,d.uploaded_by,d.uploaded_by_type
   FROM contract_signatures s JOIN documents d ON d.id=s.signed_document_id WHERE s.contract_id=$1 AND s.version_id=$2`,
        [parent.id, versionId]
      )
    ).rows[0];
    const isCurrent = parent.current_version_id === versionId;
    return {
      contractId: parent.id,
      versionId,
      state: parent.state,
      isCurrent,
      canRequest:
        staff &&
        canWrite &&
        isCurrent &&
        !parent.signed_at &&
        ['Accepted', 'AwaitingSignature'].includes(parent.state),
      canRecord:
        canWrite &&
        isCurrent &&
        parent.state === 'AwaitingSignature' &&
        request?.document_state === 'Approved' &&
        !signed,
      request: request
        ? {
            id: request.id,
            requestNumber: request.request_number,
            originalDocumentId: request.original_document_id,
            originalName: request.original_name,
            documentState: request.document_state,
            requestedAt: request.requested_at.toISOString(),
            ...(staff ? { requestedBy: request.requested_by } : {}),
          }
        : null,
      signature: signed
        ? {
            requestId: signed.request_id,
            signedDocumentId: signed.signed_document_id,
            originalName: signed.original_name,
            documentState: signed.document_state,
            recordedByType: signed.recorded_by_type,
            uploadedByType: signed.uploaded_by_type,
            recordedAt: signed.recorded_at.toISOString(),
            ...(staff ? { recordedBy: signed.recorded_by, uploadedBy: signed.uploaded_by } : {}),
          }
        : null,
    };
  }
  async get(
    id: string,
    versionId: string | undefined,
    actor: ContractActor,
    staff: boolean,
    staffCanWrite = false
  ) {
    const read = async (client: PoolClient, profileId?: string) => {
      const parent = await this.parent(client, id, profileId),
        version = await this.visibleVersion(client, parent, staff, versionId);
      const canWrite = staff
        ? staffCanWrite
        : (await client.query<{ id: string }>(activeProfileSql('contracts:sign'), [actor.userId]))
            .rows[0]?.id === parent.profile_id;
      return this.view(client, parent, version, staff, canWrite);
    };
    return staff
      ? staffDocumentRead(actor, 'contract', (client) => read(client))
      : customerContractAccess(actor, false, read);
  }
  private async mutation<T>(
    id: string,
    actor: ContractActor,
    staff: boolean,
    work: (client: PoolClient, parent: Parent) => Promise<T>
  ) {
    try {
      if (!staff)
        return await customerContractAccess(actor, true, async (client, profile) =>
          work(client, await this.parent(client, id, profile, true))
        );
      const identity = (
        await getDbPool().query<{ profile_id: string }>(
          'SELECT profile_id FROM contracts WHERE id=$1',
          [id]
        )
      ).rows[0];
      if (!identity) throw new NotFoundException();
      return await staffContractMutation(identity.profile_id, actor, async (client, archived) => {
        if (archived) throw new ConflictException('Profile is archived');
        return work(client, await this.parent(client, id, identity.profile_id, true));
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['23514', '23505'].includes(String(error.code))
      )
        throw new ConflictException('The signing request or document changed');
      throw error;
    }
  }
  async request(id: string, input: SignatureRequestInput, actor: ContractActor, ip: string) {
    return this.mutation(id, actor, true, async (client, parent) =>
      contractIdempotency(
        client,
        'contract_signature_request',
        { ...input, contractId: id },
        actor,
        async () => {
          if (
            parent.current_version_id !== input.expectedVersionId ||
            parent.signed_at ||
            !['Accepted', 'AwaitingSignature'].includes(parent.state)
          )
            throw new ConflictException('Contract is not the expected accepted version');
          const previous = await this.latest(client, input.expectedVersionId);
          if ((previous?.id ?? null) !== input.expectedRequestId)
            throw new ConflictException('The signing request changed');
          const requestId = uuidv7();
          await client.query(
            'INSERT INTO contract_signature_requests(id,contract_id,version_id,request_number,original_document_id,requested_by) VALUES($1,$2,$3,$4,$5,$6)',
            [
              requestId,
              id,
              input.expectedVersionId,
              (previous?.request_number ?? 0) + 1,
              input.originalDocumentId,
              actor.userId,
            ]
          );
          await auditContract(
            client,
            id,
            input.expectedVersionId,
            'contract.signature_requested',
            actor,
            ip,
            { requestId, originalDocumentId: input.originalDocumentId }
          );
          await notifyContractReview(client, id, 'signature_requested');
          return this.view(
            client,
            await this.parent(client, id),
            input.expectedVersionId,
            true,
            true
          );
        }
      )
    );
  }
  async record(
    id: string,
    input: SignatureRecordInput,
    actor: ContractActor,
    ip: string,
    staff: boolean
  ) {
    return this.mutation(id, actor, staff, async (client, parent) => {
      // Cached results remain behind the contract's current profile/publication boundary.
      await this.visibleVersion(client, parent, staff, input.expectedVersionId);
      return contractIdempotency(
        client,
        'contract_signature_record',
        { ...input, contractId: id, staff },
        actor,
        async () => {
          if (
            parent.current_version_id !== input.expectedVersionId ||
            parent.state !== 'AwaitingSignature' ||
            parent.signed_at
          )
            throw new ConflictException('Contract is not awaiting this signature');
          const latest = await this.latest(client, input.expectedVersionId);
          if (latest?.id !== input.requestId)
            throw new ConflictException('The signing request changed');
          await client.query(
            'INSERT INTO contract_signatures(contract_id,version_id,request_id,signed_document_id,recorded_by,recorded_by_type) VALUES($1,$2,$3,$4,$5,$6)',
            [
              id,
              input.expectedVersionId,
              input.requestId,
              input.signedDocumentId,
              actor.userId,
              staff ? 'staff' : 'customer',
            ]
          );
          await auditContract(
            client,
            id,
            input.expectedVersionId,
            'contract.signed_copy_recorded',
            actor,
            ip,
            {
              requestId: input.requestId,
              signedDocumentId: input.signedDocumentId,
              recordedByType: staff ? 'staff' : 'customer',
            }
          );
          await notifyContractReview(client, id, 'signed_copy_recorded');
          return this.view(
            client,
            await this.parent(client, id),
            input.expectedVersionId,
            staff,
            true
          );
        }
      );
    });
  }
}

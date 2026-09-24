import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { ContractService } from './contract.service.js';
import {
  auditContract,
  contractIdempotency,
  staffContractMutation,
  type ContractActor,
} from './contract-transactions.js';
import { customerContractAccess } from './contract-customer-access.js';
import { activeProfileSql } from '../profiles/profile-context.js';
import { notifyContractReview } from './contract-review-notifications.js';
import { readContractFinancialReview } from './contract-financial-review.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';
export interface ContractReviewInput {
  expectedVersionId: string;
  idempotencyKey: string;
  reason?: string;
  expectedReviewHash?: string;
}
type ReviewAction = 'submit' | 'request-changes' | 'publish';
interface PublishedRow {
  id: string;
  profile_id: string;
  order_id: string | null;
  saving_order_id: string | null;
  service_type: string;
  state: string;
  current_version_id: string;
  version_id: string;
  version_number: number;
  content: Record<string, unknown>;
  change_description: string;
  created_at: Date;
  published_at: Date;
  accepted_at: Date | null;
  accepted_by: string | null;
}
function customerDto(row: PublishedRow) {
  return {
    id: row.id,
    profileId: row.profile_id,
    orderId: row.order_id,
    savingOrderId: row.saving_order_id,
    serviceType: row.service_type,
    state: row.state,
    canAccept:
      row.state === 'AwaitingCustomerAcceptance' && row.current_version_id === row.version_id,
    version: {
      id: row.version_id,
      versionNumber: row.version_number,
      content: row.content,
      changeDescription: row.change_description,
      createdAt: row.created_at.toISOString(),
      publishedAt: row.published_at.toISOString(),
      acceptedAt: row.accepted_at?.toISOString() ?? null,
      acceptedBy: row.accepted_by,
    },
  };
}
@Injectable()
export class ContractReviewService {
  constructor(private readonly contracts: ContractService) {}
  async act(
    id: string,
    action: ReviewAction,
    input: ContractReviewInput,
    actor: ContractActor,
    ip: string
  ) {
    const identity = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM contracts WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!identity) throw new NotFoundException();
    return staffContractMutation(identity.profile_id, actor, async (client, archived) =>
      contractIdempotency(
        client,
        'contract_review',
        { ...input, contractId: id, action },
        actor,
        async () => {
          if (archived) throw new ConflictException('Profile is archived');
          const row = (
            await client.query<{ state: string; current_version_id: string }>(
              'SELECT state,current_version_id FROM contracts WHERE id=$1 FOR UPDATE',
              [id]
            )
          ).rows[0]!;
          const expected = action === 'submit' ? 'Draft' : 'AwaitingStaffReview';
          if (row.state !== expected || row.current_version_id !== input.expectedVersionId)
            throw new ConflictException('Contract is not the expected review version');
          const event =
            action === 'submit'
              ? 'submitted'
              : action === 'publish'
                ? 'published'
                : 'changes_requested';
          if (action === 'publish') {
            await client.query(
              'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
              [id, input.expectedVersionId, actor.userId]
            );
          } else if (action === 'submit') {
            await client.query(
              "UPDATE contracts SET state='AwaitingStaffReview',submitted_at=clock_timestamp() WHERE id=$1",
              [id]
            );
          } else {
            if (!input.reason?.trim())
              throw new ConflictException('A changes request requires a reason');
            await client.query("UPDATE contracts SET state='ChangesRequested' WHERE id=$1", [id]);
          }
          await auditContract(
            client,
            id,
            input.expectedVersionId,
            'contract.' + event,
            actor,
            ip,
            input.reason ? { reason: input.reason } : {}
          );
          await notifyContractReview(client, id, event, input.reason);
          return this.contracts.get(id, client);
        }
      )
    );
  }
  async list(actor: ContractActor, before?: string, state?: 'Active') {
    return customerContractAccess(actor, false, async (client, profileId) => {
      const rows = (
        await client.query<{
          id: string;
          profile_type: 'INDIVIDUAL' | 'LEGAL';
          profile_title: string | null;
          profile_first_name: string | null;
          profile_last_name: string | null;
          order_id: string | null;
          saving_order_id: string | null;
          service_type: string;
          state: string;
          version_id: string;
          version_number: number;
          published_at: Date;
          accepted_at: Date | null;
          service_starts_at: Date | null;
          service_ends_at: Date | null;
          initial_invoice_id: string | null;
          initial_invoice_amount: string | null;
          initial_invoice_state: string | null;
        }>(
          `SELECT DISTINCT ON(c.id) c.id,profile.profile_type,profile.title AS profile_title,
          profile.first_name AS profile_first_name,profile.last_name AS profile_last_name,
          c.order_id,s.id AS saving_order_id,c.service_type,c.state,v.id AS version_id,v.version_number,p.published_at,a.accepted_at,
          r.service_starts_at,r.service_ends_at,r.initial_invoice_id,i.total_amount AS initial_invoice_amount,i.state AS initial_invoice_state
          FROM contracts c JOIN profiles profile ON profile.id=c.profile_id
          JOIN contract_versions v ON v.contract_id=c.id JOIN contract_publications p ON p.version_id=v.id
          LEFT JOIN contract_acceptances a ON a.version_id=v.id
          LEFT JOIN contract_activation_requirements r ON r.version_id=v.id
          LEFT JOIN invoices i ON i.id=r.initial_invoice_id AND i.profile_id=c.profile_id
          LEFT JOIN saving_orders s ON s.order_id=c.order_id AND s.profile_id=c.profile_id AND c.service_type='savings'
      WHERE c.profile_id=$1 AND ($2::uuid IS NULL OR c.id<$2)
        AND (NOT $3::boolean OR c.state='Active')
      ORDER BY c.id DESC,v.version_number DESC LIMIT 101`,
          [profileId, before ?? null, state === 'Active']
        )
      ).rows;
      return {
        contracts: rows.slice(0, 100).map((r) => ({
          id: r.id,
          profileType: r.profile_type,
          profileTitle:
            r.profile_title?.trim() ||
            [r.profile_first_name, r.profile_last_name].filter(Boolean).join(' ').trim() ||
            null,
          orderId: r.order_id,
          savingOrderId: r.saving_order_id,
          serviceType: r.service_type,
          state: r.state,
          versionId: r.version_id,
          versionNumber: r.version_number,
          publishedAt: r.published_at.toISOString(),
          acceptedAt: r.accepted_at?.toISOString() ?? null,
          serviceStartsAt: r.service_starts_at?.toISOString() ?? null,
          serviceEndsAt: r.service_ends_at?.toISOString() ?? null,
          initialInvoiceId: r.initial_invoice_id,
          initialInvoiceAmount: r.initial_invoice_amount,
          initialInvoiceState: r.initial_invoice_state,
        })),
        nextBefore: rows.length > 100 ? rows[99]!.id : null,
      };
    });
  }
  async get(id: string, actor: ContractActor, versionId?: string) {
    return customerContractAccess(actor, false, async (client, profileId) => {
      const visible = await this.published(client, profileId, id, versionId);
      const authorized =
        (await client.query<{ id: string }>(activeProfileSql('contracts:sign'), [actor.userId]))
          .rows[0]?.id === profileId;
      return { ...visible, canAccept: visible.canAccept && authorized };
    });
  }
  async versions(id: string, actor: ContractActor, before?: number) {
    return customerContractAccess(actor, false, async (client, profileId) => {
      await this.published(client, profileId, id);
      const rows = (
        await client.query<{
          id: string;
          version_number: number;
          change_description: string;
          created_at: Date;
          published_at: Date;
          accepted_at: Date | null;
        }>(
          `SELECT v.id,v.version_number,v.change_description,v.created_at,p.published_at,a.accepted_at
      FROM contracts c JOIN contract_versions v ON v.contract_id=c.id JOIN contract_publications p ON p.version_id=v.id
      LEFT JOIN contract_acceptances a ON a.version_id=v.id WHERE c.id=$1 AND c.profile_id=$2 AND ($3::int IS NULL OR v.version_number<$3)
      ORDER BY v.version_number DESC LIMIT 101`,
          [id, profileId, before ?? null]
        )
      ).rows;
      return {
        versions: rows.slice(0, 100).map((r) => ({
          id: r.id,
          versionNumber: r.version_number,
          changeDescription: r.change_description,
          createdAt: r.created_at.toISOString(),
          publishedAt: r.published_at.toISOString(),
          acceptedAt: r.accepted_at?.toISOString() ?? null,
        })),
        nextBefore: rows.length > 100 ? rows[99]!.version_number : null,
      };
    });
  }
  async acceptanceReview(id: string, versionId: string, actor: ContractActor) {
    return customerContractAccess(
      actor,
      false,
      (client, profileId) =>
        readContractFinancialReview(client, {
          action: 'contract.acceptance',
          contractId: id,
          profileId,
          versionId,
        }),
      { financialReview: true }
    );
  }
  async accept(id: string, input: ContractReviewInput, actor: ContractActor, ip: string) {
    return customerContractAccess(
      actor,
      true,
      async (client, profileId) => {
        // Replays must pass the original contract's current profile access boundary too.
        await this.published(client, profileId, id);
        return contractIdempotency(
          client,
          'contract_accept',
          { ...input, contractId: id },
          actor,
          async () => {
            const row = (
              await client.query<{ state: string; current_version_id: string }>(
                'SELECT state,current_version_id FROM contracts WHERE id=$1 AND profile_id=$2 FOR UPDATE',
                [id, profileId]
              )
            ).rows[0];
            if (!row) throw new NotFoundException();
            if (
              row.state !== 'AwaitingCustomerAcceptance' ||
              row.current_version_id !== input.expectedVersionId
            )
              throw new ConflictException('Contract is not awaiting acceptance of this version');
            const financialReview =
              input.expectedReviewHash === undefined
                ? undefined
                : await readContractFinancialReview(client, {
                    action: 'contract.acceptance',
                    contractId: id,
                    profileId,
                    versionId: input.expectedVersionId,
                  });
            if (financialReview)
              new ReviewSnapshotService().assertConfirmed(
                financialReview,
                input.expectedReviewHash!
              );
            await client.query(
              'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
              [id, input.expectedVersionId, actor.userId]
            );
            await auditContract(
              client,
              id,
              input.expectedVersionId,
              'contract.accepted',
              actor,
              ip,
              financialReview ? { financialReview } : {}
            );
            await notifyContractReview(client, id, 'accepted');
            return {
              ...(await this.published(client, profileId, id)),
              ...(financialReview ? { financialReview } : {}),
            };
          }
        );
      },
      { financialReview: input.expectedReviewHash !== undefined }
    );
  }
  private async published(client: PoolClient, profileId: string, id: string, versionId?: string) {
    const row = (
      await client.query<PublishedRow>(
        `SELECT c.id,c.profile_id,c.order_id,s.id AS saving_order_id,c.service_type,c.state,c.current_version_id,v.id AS version_id,v.version_number,
        v.content,v.change_description,v.created_at,p.published_at,a.accepted_at,a.accepted_by
        FROM contracts c JOIN contract_versions v ON v.contract_id=c.id JOIN contract_publications p ON p.version_id=v.id
        LEFT JOIN contract_acceptances a ON a.version_id=v.id
        LEFT JOIN saving_orders s ON s.order_id=c.order_id AND s.profile_id=c.profile_id AND c.service_type='savings'
      WHERE c.id=$1 AND c.profile_id=$2 AND ($3::uuid IS NULL OR v.id=$3) ORDER BY v.version_number DESC LIMIT 1`,
        [id, profileId, versionId ?? null]
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    return customerDto(row);
  }
}

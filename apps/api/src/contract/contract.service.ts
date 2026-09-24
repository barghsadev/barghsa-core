import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  getDbPool,
  contracts,
  contractAcceptances,
  electricityOrders,
  contractVersions,
  contractActivationRequirements,
  invoices,
  profiles,
} from '@barghsa/db';
import { and, desc, eq, lt, sql, createDbClient as drizzle } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import type {
  CreateContractInput,
  UpdateContractInput,
  ContractListInput,
} from './contract-validation.js';
import { parseContractCommercialValue } from './contract-validation.js';

import {
  contractIdempotency,
  staffContractMutation,
  auditContract,
  type ContractActor as Actor,
} from './contract-transactions.js';
import { notifyContractReview } from './contract-review-notifications.js';
import { readCancellationSnapshot } from './contract-cancellation-snapshot.js';
import { ManualInvoiceService } from '../invoice/manual-invoice.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { SolarContractInput } from '../solar/solar-contract.validation.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession } from '../session/session-step-up.js';
const versionDto = (row: typeof contractVersions.$inferSelect) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  acceptedAt: row.acceptedAt?.toISOString() ?? null,
});
@Injectable()
export class ContractService {
  constructor(private readonly manualInvoices: ManualInvoiceService) {}

  cancellationPreview(id: string) {
    return readCancellationSnapshot(getDbPool(), id);
  }

  async list(input: ContractListInput) {
    const rows = await drizzle(getDbPool())
      .select({
        id: contracts.id,
        contractNumber: contracts.contractNumber,
        profileId: contracts.profileId,
        acceptedParty: contractAcceptances.partySnapshot,
        profileType: profiles.profileType,
        profileTitle: profiles.title,
        profileFirstName: profiles.firstName,
        profileLastName: profiles.lastName,
        orderId: contracts.orderId,
        linkedOrderStatus: electricityOrders.status,
        serviceType: contracts.serviceType,
        state: contracts.state,
        versionId: contractVersions.id,
        versionNumber: contractVersions.versionNumber,
        commercialValue: sql<unknown>`${contractVersions.content}->'commercialValue'`,
        changeDescription: contractVersions.changeDescription,
        updatedAt: contracts.updatedAt,
        acceptedAt: contracts.acceptedAt,
        serviceStartsAt: contractActivationRequirements.serviceStartsAt,
        serviceEndsAt: contractActivationRequirements.serviceEndsAt,
        initialInvoiceId: contractActivationRequirements.initialInvoiceId,
        initialInvoiceAmount: invoices.totalAmount,
        initialInvoiceState: invoices.state,
      })
      .from(contracts)
      .innerJoin(profiles, eq(profiles.id, contracts.profileId))
      .leftJoin(
        electricityOrders,
        and(
          eq(electricityOrders.id, contracts.orderId),
          eq(electricityOrders.profileId, contracts.profileId),
          eq(contracts.serviceType, 'electricity')
        )
      )
      .innerJoin(
        contractVersions,
        and(
          eq(contractVersions.contractId, contracts.id),
          eq(contractVersions.id, contracts.currentVersionId)
        )
      )
      .leftJoin(contractAcceptances, eq(contractAcceptances.versionId, contractVersions.id))
      .leftJoin(
        contractActivationRequirements,
        eq(contractActivationRequirements.versionId, contractVersions.id)
      )
      .leftJoin(
        invoices,
        and(
          eq(invoices.id, contractActivationRequirements.initialInvoiceId),
          eq(invoices.profileId, contracts.profileId)
        )
      )
      .where(
        and(
          input.profileId ? eq(contracts.profileId, input.profileId) : undefined,
          input.contractNumber
            ? eq(contracts.contractNumber, BigInt(input.contractNumber))
            : undefined,
          input.serviceType ? eq(contracts.serviceType, input.serviceType) : undefined,
          input.state ? eq(contracts.state, input.state) : undefined,
          input.before ? lt(contracts.id, input.before) : undefined
        )
      )
      .orderBy(desc(contracts.id))
      .limit(input.limit + 1);
    return {
      contracts: rows
        .slice(0, input.limit)
        .map(({ profileFirstName, profileLastName, ...row }) => ({
          ...row,
          contractNumber: row.contractNumber.toString(),
          commercialValue: parseContractCommercialValue(row.commercialValue),
          profileTitle:
            row.profileTitle?.trim() ||
            [profileFirstName, profileLastName].filter(Boolean).join(' ').trim() ||
            null,
          updatedAt: row.updatedAt.toISOString(),
          acceptedAt: row.acceptedAt?.toISOString() ?? null,
          serviceStartsAt: row.serviceStartsAt?.toISOString() ?? null,
          serviceEndsAt: row.serviceEndsAt?.toISOString() ?? null,
          initialInvoiceAmount: row.initialInvoiceAmount?.toString() ?? null,
        })),
      nextBefore: rows.length > input.limit ? rows[input.limit - 1]!.id : null,
    };
  }

  async get(id: string, client: ReturnType<typeof getDbPool> | PoolClient = getDbPool()) {
    const db = drizzle(client);
    const row = (await db.select().from(contracts).where(eq(contracts.id, id)))[0];
    if (!row) throw new NotFoundException();
    const version = await this.version(id, row.currentVersionId, client);
    const acceptance = (
      await db
        .select({ acceptedParty: contractAcceptances.partySnapshot })
        .from(contractAcceptances)
        .where(eq(contractAcceptances.versionId, row.currentVersionId))
    )[0];
    const linkedOrderStatus =
      row.serviceType === 'electricity' && row.orderId
        ? ((
            await db
              .select({ status: electricityOrders.status })
              .from(electricityOrders)
              .where(
                and(
                  eq(electricityOrders.id, row.orderId),
                  eq(electricityOrders.profileId, row.profileId)
                )
              )
          )[0]?.status ?? null)
        : null;
    const pendingAmendment = (
      await client.query<{
        version_id: string;
        base_version_id: string;
        state: string;
        proposed_by: string;
        created_at: Date;
        published_at: Date | null;
      }>(
        `SELECT version_id,base_version_id,state,proposed_by,created_at,published_at
         FROM contract_amendments WHERE contract_id=$1
           AND state IN ('Draft','AwaitingCustomerAcceptance','AwaitingSignature')`,
        [id]
      )
    ).rows[0];
    return {
      ...row,
      linkedOrderStatus,
      acceptedParty: acceptance?.acceptedParty ?? null,
      contractNumber: row.contractNumber.toString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      signedAt: row.signedAt?.toISOString() ?? null,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      currentVersion: version,
      pendingAmendment: pendingAmendment
        ? {
            versionId: pendingAmendment.version_id,
            baseVersionId: pendingAmendment.base_version_id,
            state: pendingAmendment.state,
            proposedBy: pendingAmendment.proposed_by,
            createdAt: pendingAmendment.created_at.toISOString(),
            publishedAt: pendingAmendment.published_at?.toISOString() ?? null,
          }
        : null,
    };
  }
  async version(
    id: string,
    versionId: string,
    client: ReturnType<typeof getDbPool> | PoolClient = getDbPool()
  ) {
    const row = (
      await drizzle(client)
        .select()
        .from(contractVersions)
        .where(and(eq(contractVersions.contractId, id), eq(contractVersions.id, versionId)))
    )[0];
    if (!row) throw new NotFoundException();
    return versionDto(row);
  }
  async versions(id: string, before?: number) {
    if (
      !(
        await drizzle(getDbPool())
          .select({ id: contracts.id })
          .from(contracts)
          .where(eq(contracts.id, id))
      )[0]
    )
      throw new NotFoundException();
    const rows = await drizzle(getDbPool())
      .select()
      .from(contractVersions)
      .where(
        and(
          eq(contractVersions.contractId, id),
          before === undefined ? undefined : lt(contractVersions.versionNumber, before)
        )
      )
      .orderBy(desc(contractVersions.versionNumber))
      .limit(101);
    const more = rows.length > 100;
    return {
      versions: rows.slice(0, 100).map(({ content: _content, ...row }) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
      })),
      nextBefore: more ? rows[99]!.versionNumber : null,
    };
  }
  async create(input: CreateContractInput, actor: Actor, ip: string) {
    return staffContractMutation(input.profileId, actor, async (client, archived) => {
      return contractIdempotency(client, 'contract_create', input, actor, async () => {
        if (archived) throw new ConflictException('Profile is archived');
        if (input.orderId) {
          const order = (
            await client.query(
              'SELECT profile_id,order_type,status FROM orders WHERE id=$1 FOR SHARE',
              [input.orderId]
            )
          ).rows[0];
          if (
            !order ||
            order.profile_id !== input.profileId ||
            order.order_type !== input.serviceType ||
            order.status === 'CANCELLED'
          )
            throw new ConflictException('Order is unavailable or does not match the contract');
        }
        const id = uuidv7(),
          versionId = uuidv7();
        await client.query(
          'INSERT INTO contracts(id,profile_id,order_id,service_type,current_version_id) VALUES($1,$2,$3,$4,$5)',
          [id, input.profileId, input.orderId ?? null, input.serviceType, versionId]
        );
        await this.insertVersion(client, id, versionId, 1, input, actor);
        await this.activationContext(client, versionId, input.activationContext);
        await auditContract(client, id, versionId, 'contract.created', actor, ip);
        return this.get(id, client);
      });
    });
  }

  async createSolar(input: SolarContractInput, actor: Actor, ip: string) {
    return staffContractMutation(
      input.profileId,
      actor,
      async (client, archived) => {
        return contractIdempotency(client, 'solar_contract_create', input, actor, async () => {
          if (archived) throw new ConflictException('Profile is archived');
          const request = (
            await client.query<{
              status: string;
              submitted_by: string;
              contract_id: string | null;
            }>(
              `SELECT status,submitted_by,contract_id FROM solar_construction_requests
           WHERE id=$1 AND profile_id=$2 FOR UPDATE`,
              [input.requestId, input.profileId]
            )
          ).rows[0];
          if (!request) throw new NotFoundException('Solar request not found');
          if (request.status !== 'approved' || request.contract_id)
            throw new ConflictException('Solar request is not awaiting a contract');
          if (input.source.kind === 'template') {
            const source = (
              await client.query(
                `SELECT 1 FROM contract_template_versions v
             JOIN contract_templates t ON t.id=v.template_id
             WHERE v.id=$1 AND t.status='active'`,
                [input.source.templateVersionId]
              )
            ).rows[0];
            if (!source) throw new ConflictException('Select an active contract template version');
          } else {
            const source = (
              await client.query(
                `SELECT 1 FROM documents WHERE id=$1 AND profile_id=$2
             AND business_record_type='solar_request' AND business_record_id=$3
             AND category='document' AND state IN ('Available','Approved')`,
                [input.source.documentId, input.profileId, input.requestId]
              )
            ).rows[0];
            if (!source)
              throw new ConflictException('Select an available uploaded contract document');
          }
          const id = uuidv7(),
            versionId = uuidv7();
          await client.query(
            `INSERT INTO contracts(id,profile_id,service_type,current_version_id)
           VALUES($1,$2,'solar',$3)`,
            [id, input.profileId, versionId]
          );
          await this.insertVersion(
            client,
            id,
            versionId,
            1,
            {
              content: {
                title: input.title,
                text: input.text,
                commercialValue: input.commercialValue,
                solarRequestId: input.requestId,
                solarSource: input.source,
              },
              changeDescription: input.changeDescription,
            },
            actor
          );
          await auditContract(client, id, versionId, 'contract.created', actor, ip, {
            solarRequestId: input.requestId,
            source: input.source,
          });
          const invoice = await this.manualInvoices.createManualInvoice({
            transactionClient: client,
            profileId: input.profileId,
            contractId: id,
            idempotencyKey: input.idempotencyKey,
            lines: input.invoiceLines.map((line) => ({
              ...line,
              unitPrice: BigInt(line.unitPrice),
            })),
            actorUserId: actor.userId,
            actorSession: actor,
            ip,
            reason: 'Solar construction contract invoice',
          });
          await client.query(
            `UPDATE solar_construction_requests
           SET contract_id=$2,status='contract_created',updated_at=NOW() WHERE id=$1`,
            [input.requestId, id]
          );
          await new NotificationsService().create(
            {
              userId: request.submitted_by,
              profileId: input.profileId,
              type: 'general',
              title: 'Solar invoice issued',
              localizedContent: {
                fa: {
                  title: 'قرارداد نیروگاه خورشیدی',
                  body: 'فاکتور اولیه صادر شد. قرارداد پس از انتشار توسط کارشناس قابل مشاهده خواهد بود.',
                },
                en: {
                  title: 'Solar contract',
                  body: 'The initial invoice was issued. The contract will appear after staff publishes it.',
                },
              },
            },
            client
          );
          await client.query(
            `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
           VALUES($1,$2,'solar.contract.created',$3::jsonb,$4,$5)`,
            [
              uuidv7(),
              actor.userId,
              JSON.stringify({
                requestId: input.requestId,
                contractId: id,
                invoiceId: invoice.invoiceId,
                previousStatus: 'approved',
                status: 'contract_created',
              }),
              uuidv7(),
              ip,
            ]
          );
          return { status: 'contract_created', contractId: id, invoiceIds: [invoice.invoiceId] };
        });
      },
      { financialReview: true }
    );
  }
  async solarOptions(requestId: string, actor: Actor) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'contracts:write');
      await requireCurrentSession(client, actor);
      const request = (
        await client.query<{ status: string }>(
          'SELECT status FROM solar_construction_requests WHERE id=$1',
          [requestId]
        )
      ).rows[0];
      if (!request) throw new NotFoundException('Solar request not found');
      if (request.status !== 'approved')
        throw new ConflictException('Solar request is not awaiting a contract');
      const templates = (
        await client.query(
          `SELECT DISTINCT ON (t.id) v.id AS version_id,t.name,v.version_number
         FROM contract_templates t JOIN contract_template_versions v ON v.template_id=t.id
         WHERE t.status='active' ORDER BY t.id,v.version_number DESC LIMIT 100`
        )
      ).rows;
      const documents = (
        await client.query(
          `SELECT d.id,d.original_name FROM solar_construction_requests r
         JOIN documents d ON d.profile_id=r.profile_id
           AND d.business_record_type='solar_request' AND d.business_record_id=r.id
         WHERE r.id=$1 AND d.category='document' AND d.state IN ('Available','Approved')
         ORDER BY d.created_at DESC LIMIT 100`,
          [requestId]
        )
      ).rows;
      await client.query('COMMIT');
      return { templates, documents };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async updateContract(id: string, input: UpdateContractInput, actor: Actor, ip: string) {
    const identity = (
      await getDbPool().query<{ profile_id: string }>(
        'SELECT profile_id FROM contracts WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (!identity) throw new NotFoundException();
    return staffContractMutation(identity.profile_id, actor, async (client, archived) => {
      return contractIdempotency(
        client,
        'contract_update',
        { ...input, contractId: id },
        actor,
        async () => {
          if (archived) throw new ConflictException('Profile is archived');
          const row = (
            await client.query<{ state: string; current_version_id: string }>(
              'SELECT state,current_version_id FROM contracts WHERE id=$1 FOR UPDATE',
              [id]
            )
          ).rows[0]!;
          if (
            !['Draft', 'ChangesRequested'].includes(row.state) ||
            row.current_version_id !== input.expectedVersionId
          )
            throw new ConflictException('Contract is no longer the expected draft version');
          const previous = (
            await client.query<{ version_number: number; unchanged: boolean }>(
              'SELECT version_number,content=$2::jsonb AS unchanged FROM contract_versions WHERE id=$1',
              [row.current_version_id, JSON.stringify(input.content)]
            )
          ).rows[0]!;
          const contextChanged =
            input.activationContext !== undefined &&
            !(
              await client.query<{ same: boolean }>(
                'SELECT initial_invoice_id IS NOT DISTINCT FROM $2::uuid AND service_starts_at IS NOT DISTINCT FROM $3::timestamptz AND (NOT $4::boolean OR service_ends_at IS NOT DISTINCT FROM $5::timestamptz) AS same FROM contract_activation_requirements WHERE version_id=$1',
                [
                  row.current_version_id,
                  input.activationContext.initialInvoiceId,
                  input.activationContext.serviceStartsAt,
                  input.activationContext.serviceEndsAt !== undefined,
                  input.activationContext.serviceEndsAt ?? null,
                ]
              )
            ).rows[0]?.same;
          if (previous.unchanged && !contextChanged) {
            if (row.state === 'ChangesRequested')
              throw new ConflictException('Resubmission requires a new material version');
            return this.get(id, client);
          }
          const versionId = uuidv7();
          await this.insertVersion(
            client,
            id,
            versionId,
            previous.version_number + 1,
            input,
            actor
          );
          await client.query('UPDATE contracts SET current_version_id=$2 WHERE id=$1', [
            id,
            versionId,
          ]);
          await this.activationContext(client, versionId, input.activationContext);
          await auditContract(client, id, versionId, 'contract.version_created', actor, ip);
          if (row.state === 'ChangesRequested') {
            await client.query(
              "UPDATE contracts SET state='AwaitingStaffReview',submitted_at=clock_timestamp() WHERE id=$1",
              [id]
            );
            await auditContract(client, id, versionId, 'contract.resubmitted', actor, ip);
            await notifyContractReview(client, id, 'resubmitted');
          }
          return this.get(id, client);
        }
      );
    });
  }
  async createAmendment(id: string, input: UpdateContractInput, actor: Actor, ip: string) {
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
        'contract_amendment_create',
        { ...input, contractId: id },
        actor,
        async () => {
          if (archived) throw new ConflictException('Profile is archived');
          const row = (
            await client.query<{
              state: string;
              current_version_id: string;
              version_number: number;
            }>(
              `SELECT c.state,c.current_version_id,v.version_number FROM contracts c
               JOIN contract_versions v ON v.id=c.current_version_id
               WHERE c.id=$1 FOR UPDATE OF c`,
              [id]
            )
          ).rows[0]!;
          if (
            !['Accepted', 'Signed', 'Active'].includes(row.state) ||
            row.current_version_id !== input.expectedVersionId
          )
            throw new ConflictException('Contract is not the expected accepted version');
          if (
            (
              await client.query(
                `SELECT 1 FROM contract_amendments WHERE contract_id=$1
                 AND state IN ('Draft','AwaitingCustomerAcceptance','AwaitingSignature')`,
                [id]
              )
            ).rowCount
          )
            throw new ConflictException('A pending amendment already exists');
          const versionId = uuidv7();
          await client.query(
            `INSERT INTO contract_amendments(version_id,contract_id,base_version_id,proposed_by)
             VALUES($1,$2,$3,$4)`,
            [versionId, id, row.current_version_id, actor.userId]
          );
          await this.insertVersion(client, id, versionId, row.version_number + 1, input, actor);
          await this.activationContext(client, versionId, input.activationContext);
          await auditContract(client, id, versionId, 'contract.amendment_created', actor, ip, {
            baseVersionId: row.current_version_id,
          });
          return this.get(id, client);
        }
      )
    );
  }
  private async activationContext(
    client: PoolClient,
    versionId: string,
    context: UpdateContractInput['activationContext']
  ) {
    if (context === undefined) return;
    try {
      await client.query(
        'UPDATE contract_activation_requirements SET initial_invoice_id=$2,service_starts_at=$3,service_ends_at=CASE WHEN $4::boolean THEN $5::timestamptz ELSE service_ends_at END WHERE version_id=$1',
        [
          versionId,
          context.initialInvoiceId,
          context.serviceStartsAt,
          context.serviceEndsAt !== undefined,
          context.serviceEndsAt ?? null,
        ]
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['23514', '23503'].includes(String(error.code))
      )
        throw new ConflictException(
          'Activation context is unavailable or belongs to another contract'
        );
      throw error;
    }
  }
  private async insertVersion(
    client: PoolClient,
    id: string,
    versionId: string,
    number: number,
    input: Pick<UpdateContractInput, 'content' | 'changeDescription'>,
    actor: Actor
  ) {
    await client.query(
      'INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
      [versionId, id, number, JSON.stringify(input.content), input.changeDescription, actor.userId]
    );
  }
}

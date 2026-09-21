import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool, contracts, contractVersions } from '@barghsa/db';
import { and, desc, eq, lt, createDbClient as drizzle } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import type {
  CreateContractInput,
  UpdateContractInput,
  ContractListInput,
} from './contract-validation.js';

import {
  contractIdempotency,
  staffContractMutation,
  auditContract,
  type ContractActor as Actor,
} from './contract-transactions.js';
import { notifyContractReview } from './contract-review-notifications.js';
const versionDto = (row: typeof contractVersions.$inferSelect) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  acceptedAt: row.acceptedAt?.toISOString() ?? null,
});
@Injectable()
export class ContractService {
  async list(input: ContractListInput) {
    const rows = await drizzle(getDbPool())
      .select({
        id: contracts.id,
        profileId: contracts.profileId,
        serviceType: contracts.serviceType,
        state: contracts.state,
        versionId: contractVersions.id,
        versionNumber: contractVersions.versionNumber,
        changeDescription: contractVersions.changeDescription,
        updatedAt: contracts.updatedAt,
        acceptedAt: contracts.acceptedAt,
      })
      .from(contracts)
      .innerJoin(
        contractVersions,
        and(
          eq(contractVersions.contractId, contracts.id),
          eq(contractVersions.id, contracts.currentVersionId)
        )
      )
      .where(
        and(
          input.profileId ? eq(contracts.profileId, input.profileId) : undefined,
          input.serviceType ? eq(contracts.serviceType, input.serviceType) : undefined,
          input.state ? eq(contracts.state, input.state) : undefined,
          input.before ? lt(contracts.id, input.before) : undefined
        )
      )
      .orderBy(desc(contracts.id))
      .limit(input.limit + 1);
    return {
      contracts: rows.slice(0, input.limit).map((row) => ({
        ...row,
        updatedAt: row.updatedAt.toISOString(),
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
      })),
      nextBefore: rows.length > input.limit ? rows[input.limit - 1]!.id : null,
    };
  }

  async get(id: string, client: ReturnType<typeof getDbPool> | PoolClient = getDbPool()) {
    const db = drizzle(client);
    const row = (await db.select().from(contracts).where(eq(contracts.id, id)))[0];
    if (!row) throw new NotFoundException();
    const version = await this.version(id, row.currentVersionId, client);
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      signedAt: row.signedAt?.toISOString() ?? null,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      currentVersion: version,
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
                'SELECT initial_invoice_id IS NOT DISTINCT FROM $2::uuid AND service_starts_at IS NOT DISTINCT FROM $3::timestamptz AS same FROM contract_activation_requirements WHERE version_id=$1',
                [
                  row.current_version_id,
                  input.activationContext.initialInvoiceId,
                  input.activationContext.serviceStartsAt,
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
  private async activationContext(
    client: PoolClient,
    versionId: string,
    context: UpdateContractInput['activationContext']
  ) {
    if (context === undefined) return;
    try {
      await client.query(
        'UPDATE contract_activation_requirements SET initial_invoice_id=$2,service_starts_at=$3 WHERE version_id=$1',
        [versionId, context.initialInvoiceId, context.serviceStartsAt]
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

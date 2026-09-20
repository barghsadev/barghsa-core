import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool, contracts, contractVersions } from '@barghsa/db';
import { and, desc, eq, lt, createDbClient as drizzle } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
import type { CreateContractInput, UpdateContractInput } from './contract-validation.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
const versionDto = (row: typeof contractVersions.$inferSelect) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  acceptedAt: row.acceptedAt?.toISOString() ?? null,
});
@Injectable()
export class ContractService {
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
    return this.mutate(input.profileId, actor, async (client, archived) => {
      return this.idempotent(client, 'contract_create', input, actor, async () => {
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
        await this.audit(client, id, versionId, 'contract.created', actor, ip);
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
    return this.mutate(identity.profile_id, actor, async (client, archived) => {
      return this.idempotent(
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
          if (row.state !== 'Draft' || row.current_version_id !== input.expectedVersionId)
            throw new ConflictException('Contract is no longer the expected draft version');
          const previous = (
            await client.query<{ version_number: number; unchanged: boolean }>(
              'SELECT version_number,content=$2::jsonb AS unchanged FROM contract_versions WHERE id=$1',
              [row.current_version_id, JSON.stringify(input.content)]
            )
          ).rows[0]!;
          if (previous.unchanged) return this.get(id, client);
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
          await this.audit(client, id, versionId, 'contract.version_created', actor, ip);
          return this.get(id, client);
        }
      );
    });
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
  private async idempotent<T, Input extends { idempotencyKey: string }>(
    client: PoolClient,
    kind: string,
    input: Input,
    actor: Actor,
    work: () => Promise<T>
  ): Promise<T> {
    const key = actor.userId + ':' + input.idempotencyKey;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [kind + ':' + key]);
    const prior = (
      await client.query<{ matches: boolean; result: T }>(
        "SELECT response->'request'=$3::jsonb AS matches,response->'result' AS result FROM idempotency_keys WHERE entity_type=$1 AND idempotency_key=$2",
        [kind, key, JSON.stringify(input)]
      )
    ).rows[0];
    if (prior) {
      if (!prior.matches)
        throw new ConflictException('Idempotency key belongs to a different request');
      return prior.result;
    }
    const result = await work();
    await client.query(
      'INSERT INTO idempotency_keys(entity_type,idempotency_key,response) VALUES($1,$2,$3::jsonb)',
      [kind, key, JSON.stringify({ request: input, result })]
    );
    return result;
  }
  private async mutate<T>(
    profileId: string,
    actor: Actor,
    work: (client: PoolClient, archived: boolean) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const profile = (
        await client.query<{ archived: boolean }>(
          'SELECT archived FROM profiles WHERE id=$1 FOR SHARE',
          [profileId]
        )
      ).rows[0];
      if (!profile) throw new NotFoundException();
      await requireStaffMutationPermission(client, actor.userId, 'contracts:write');
      await requireSessionStepUp(client, actor);
      const result = await work(client, profile.archived);
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async audit(
    client: PoolClient,
    id: string,
    versionId: string,
    event: string,
    actor: Actor,
    ip: string
  ) {
    await client.query(
      'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
      [uuidv7(), actor.userId, event, JSON.stringify({ contractId: id, versionId }), uuidv7(), ip]
    );
  }
}

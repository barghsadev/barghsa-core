import { readContractActivation } from '@barghsa/db/contract-activation';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool, type ContractActivationRule } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { staffDocumentRead } from '../documents/document-access.js';
import { customerContractAccess } from './contract-customer-access.js';
import { contractIdempotency, type ContractActor } from './contract-transactions.js';
import type {
  ActivationRuleInput,
  ActivationServiceType,
} from './contract-activation-validation.js';
interface RuleRow {
  service_type: ContractActivationRule['serviceType'];
  signature_required: boolean;
  payment_required: boolean;
  service_start_required: boolean;
  revision: number;
  updated_at: Date;
}
const ruleDto = (r: RuleRow) => ({
  serviceType: r.service_type,
  signatureRequired: r.signature_required,
  paymentRequired: r.payment_required,
  serviceStartRequired: r.service_start_required,
  revision: r.revision,
  updatedAt: r.updated_at.toISOString(),
});
@Injectable()
export class ContractActivationService {
  async rules(actor: ContractActor, canEdit: boolean) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(
        client,
        actor.userId,
        canEdit ? 'admin:catalogue:edit' : 'contracts:read'
      );
      await requireCurrentSession(client, actor);
      const rows = await client.query<RuleRow>(
        'SELECT service_type,signature_required,payment_required,service_start_required,revision,updated_at FROM contract_activation_rules ORDER BY service_type'
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return { rules: rows.rows.map(ruleDto), canEdit };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async updateRule(
    serviceType: ActivationServiceType,
    input: ActivationRuleInput,
    actor: ContractActor,
    ip: string
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:catalogue:edit');
      await requireSessionStepUp(client, actor);
      const previous = (
        await client.query<RuleRow>(
          'SELECT * FROM contract_activation_rules WHERE service_type=$1 FOR UPDATE',
          [serviceType]
        )
      ).rows[0];
      if (!previous) throw new NotFoundException();
      const result = await contractIdempotency(
        client,
        'contract_activation_rule',
        { ...input, serviceType },
        actor,
        async () => {
          if (previous.revision !== input.expectedRevision)
            throw new ConflictException('Activation rules changed');
          if (
            (serviceType === 'solar' && !input.signatureRequired) ||
            (serviceType === 'electricity' && !input.paymentRequired)
          )
            throw new ConflictException('Mandatory service prerequisites cannot be disabled');
          const next = (
            await client.query<RuleRow>(
              'UPDATE contract_activation_rules SET signature_required=$2,payment_required=$3,service_start_required=$4,revision=revision+1,updated_by=$5 WHERE service_type=$1 RETURNING *',
              [
                serviceType,
                input.signatureRequired,
                input.paymentRequired,
                input.serviceStartRequired,
                actor.userId,
              ]
            )
          ).rows[0]!;
          await client.query(
            'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
            [
              uuidv7(),
              actor.userId,
              'contract.activation_rule_changed',
              JSON.stringify({ serviceType, previous: ruleDto(previous), current: ruleDto(next) }),
              uuidv7(),
              ip,
            ]
          );
          return ruleDto(next);
        }
      );
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
  async get(id: string, versionId: string | undefined, actor: ContractActor, staff: boolean) {
    const read = (client: PoolClient, profileId?: string) =>
      this.resolve(client, id, versionId, staff, profileId);
    return staff
      ? staffDocumentRead(actor, 'contract', (client) => read(client))
      : customerContractAccess(actor, false, read);
  }
  private async resolve(
    client: PoolClient,
    id: string,
    versionId: string | undefined,
    staff: boolean,
    profileId?: string
  ) {
    const result = await readContractActivation(client, id, versionId, staff, profileId);
    if (!result) throw new NotFoundException();
    return result;
  }
}

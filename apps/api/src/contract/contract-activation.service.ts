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
    const r = (
      await client.query<{
        id: string;
        version_id: string;
        current_version_id: string;
        state: string;
        archived: boolean;
        rule_revision: number;
        signature_required: boolean;
        payment_required: boolean;
        service_start_required: boolean;
        initial_invoice_id: string | null;
        service_starts_at: Date | null;
        approved: boolean;
        accepted: boolean;
        signed: boolean;
        paid: boolean;
        started: boolean;
        evaluated_at: Date;
      }>(
        `SELECT c.id,v.id AS version_id,c.current_version_id,c.state,p.archived,r.rule_revision,r.signature_required,r.payment_required,r.service_start_required,r.initial_invoice_id,r.service_starts_at,
      EXISTS(SELECT 1 FROM contract_publications WHERE contract_id=c.id AND version_id=v.id) AS approved,
      EXISTS(SELECT 1 FROM contract_acceptances WHERE contract_id=c.id AND version_id=v.id) AS accepted,
      EXISTS(SELECT 1 FROM contract_signatures s JOIN documents d ON d.id=s.signed_document_id WHERE s.contract_id=c.id AND s.version_id=v.id AND d.state='Approved') AS signed,
      EXISTS(SELECT 1 FROM invoices i WHERE i.id=r.initial_invoice_id AND i.profile_id=c.profile_id AND (i.contract_id=c.id::text OR (c.order_id IS NOT NULL AND i.order_id=c.order_id AND (i.contract_id IS NULL OR i.contract_id=c.id::text)))
        AND i.adjustment_for_invoice_id IS NULL AND i.state='Paid' AND i.paid_amount>=i.total_amount AND i.refunded_amount=0) AS paid,
      COALESCE(r.service_starts_at<=statement_timestamp(),false) AS started,statement_timestamp() AS evaluated_at
      FROM contracts c JOIN profiles p ON p.id=c.profile_id JOIN contract_versions v ON v.contract_id=c.id
      JOIN contract_activation_requirements r ON r.version_id=v.id AND r.contract_id=c.id
      WHERE c.id=$1 AND ($2::uuid IS NULL OR c.profile_id=$2) AND ($3::uuid IS NULL OR v.id=$3)
        AND ($4::boolean OR EXISTS(SELECT 1 FROM contract_publications WHERE contract_id=c.id AND version_id=v.id))
      ORDER BY v.version_number DESC LIMIT 1`,
        [id, profileId ?? null, versionId ?? null, staff]
      )
    ).rows[0];
    if (!r) throw new NotFoundException();
    const check = (key: string, required: boolean, met: boolean) => ({
      key,
      required,
      status: !required ? 'not_required' : met ? 'met' : 'unmet',
    });
    const checks = [
      check('staffApproval', true, r.approved),
      check('customerAcceptance', true, r.accepted),
      check('signature', r.signature_required, r.signed),
      check('initialPayment', r.payment_required, r.paid),
      check('serviceStart', r.service_start_required, r.started),
    ];
    const isCurrent = r.version_id === r.current_version_id;
    return {
      contractId: r.id,
      versionId: r.version_id,
      state: r.state,
      isCurrent,
      ruleRevision: r.rule_revision,
      initialInvoiceId: r.initial_invoice_id,
      serviceStartsAt: r.service_starts_at?.toISOString() ?? null,
      evaluatedAt: r.evaluated_at.toISOString(),
      checks,
      ready:
        isCurrent &&
        !r.archived &&
        ['Accepted', 'Signed'].includes(r.state) &&
        checks.every((item) => item.status !== 'unmet'),
    };
  }
}

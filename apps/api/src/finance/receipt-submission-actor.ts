import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import {
  lockFinancialSubmissionActor,
  type FinancialSubmissionActor,
} from './financial-submission-actor.js';

export type ReceiptSubmissionActor = FinancialSubmissionActor;
type Client = Parameters<typeof lockFinancialSubmissionActor>[0];

/** Receipt flows retain the shared account/session/profile authorization boundary. */
export async function lockReceiptSubmissionActor(
  client: Client,
  actor: ReceiptSubmissionActor,
  profileId: string
): Promise<void> {
  await lockFinancialSubmissionActor(client, actor, profileId, 'bank-receipts:submit');
}

export async function auditReceiptSubmission(
  client: Client,
  actor: ReceiptSubmissionActor,
  profileId: string,
  receiptId: string,
  flow: 'wallet' | 'invoice'
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
    VALUES(uuid_generate_v7(),$1,$2,$3::jsonb,COALESCE($4::uuid,uuid_generate_v7()),NOW())`,
    [
      actor.userId,
      flow === 'wallet' ? 'wallet_bank_receipt_submitted' : 'invoice_bank_receipt_submitted',
      JSON.stringify({ sessionId: actor.sessionId, profileId, receiptId }),
      actor.correlationId ?? correlationIdStorage.getStore() ?? null,
    ]
  );
}

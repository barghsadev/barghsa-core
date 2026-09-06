import { notifyApprovalRequested } from '../admin/approval-notifications.js';
import { createHash, randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { ErrorCodes } from "@barghsa/shared/errors";
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  readInvoiceBankReceiptDualApprovalThreshold,
  invoiceBankReceiptRequiresDualApproval,
} from "@barghsa/shared/finance";
import { applyApprovalRequestResolutionOnClient } from "../admin/dual-approval-resolution.js";
import { requireCurrentFinancePermission } from "../admin/approval-permissions.js";
import type { WalletQueryClient } from "./wallet.service.js";

export interface WalletReceiptApproval {
  requestId: string;
  initiatorId: string;
  fingerprint: string;
  invoiceId: string | null;
}
function conflict(message: string): never {
  throw new HttpException(
    { statusCode: 409, error: ErrorCodes.CONFLICT_STATE.code, message },
    409,
  );
}
export function walletReceiptApproval(
  metadata: unknown,
): WalletReceiptApproval | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).dualApproval;
  if (raw === undefined) return null;
  if (!raw || typeof raw !== "object")
    return conflict("Invalid saved receipt approval binding");
  const row = raw as Record<string, unknown>;
  if (
    typeof row.requestId !== "string" ||
    typeof row.initiatorId !== "string" ||
    typeof row.fingerprint !== "string" ||
    (row.invoiceId !== null && typeof row.invoiceId !== "string")
  )
    return conflict("Invalid saved receipt approval binding");
  return row as unknown as WalletReceiptApproval;
}
/** Caller holds the receipt lock and owns the transaction. Returns a pending binding, or null to settle. */
export async function gateWalletReceiptApproval(
  client: WalletQueryClient,
  input: {
    id: string;
    walletId: string;
    amount: bigint;
    metadata: unknown;
    attachmentKey: string | null;
    invoiceId: string | null;
    actorUserId: string;
    ip: string;
    now: Date;
  },
): Promise<WalletReceiptApproval | null> {
  const value = (
    await client.query("SELECT value FROM app_config WHERE key=$1", [
      DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
    ])
  ).rows[0] as { value: unknown } | undefined;
  const threshold = readInvoiceBankReceiptDualApprovalThreshold(value?.value);
  if (threshold.status === "corrupt")
    conflict("Dual-approval threshold configuration is invalid");
  const saved = walletReceiptApproval(input.metadata);
  if (
    !saved &&
    !invoiceBankReceiptRequiresDualApproval(threshold, input.amount)
  )
    return null;
  const metadata = (input.metadata ?? {}) as Record<string, unknown>;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        id: input.id,
        walletId: input.walletId,
        amount: input.amount.toString(),
        invoiceId: input.invoiceId,
        attachmentKey: input.attachmentKey,
        receipt: metadata.receipt ?? null,
      }),
    )
    .digest("hex");
  await requireCurrentFinancePermission(client, input.actorUserId);
  if (!saved) {
    const binding: WalletReceiptApproval = {
      requestId: randomUUID(),
      initiatorId: input.actorUserId,
      fingerprint,
      invoiceId: input.invoiceId,
    };
    await client.query(
      `INSERT INTO approval_requests(id,action_type,amount_irr,initiator_id,reason,details)
      VALUES ($1,'bank_payment_confirmation',$2,$3,'Wallet bank receipt confirmation',$4::jsonb)`,
      [
        binding.requestId,
        input.amount.toString(),
        input.actorUserId,
        JSON.stringify({
          entityType: "wallet_bank_receipt",
          receiptId: input.id,
          walletId: input.walletId,
          invoiceId: input.invoiceId,
          fingerprint,
        }),
      ],
    );
    await client.query(
      `UPDATE wallet_transactions SET metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('dualApproval',$2::jsonb) WHERE id=$1`,
      [input.id, JSON.stringify(binding)],
    );
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
      VALUES ($1,$2,'wallet.bank_receipt.dual_approval_requested',$3::jsonb,$4,$5)`,
      [
        randomUUID(),
        input.actorUserId,
        JSON.stringify({
          receiptId: input.id,
          requestId: binding.requestId,
          amount: input.amount.toString(),
          fingerprint,
        }),
        randomUUID(),
        input.ip,
      ],
    );
    await notifyApprovalRequested(client, { requestId: binding.requestId,
      amountIrR: input.amount.toString(), initiatorUserId: input.actorUserId });
    return binding;
  }
  if (saved.fingerprint !== fingerprint)
    conflict(
      "Receipt evidence or intended invoice changed after approval was requested",
    );
  const request = (
    await client.query(
      "SELECT * FROM approval_requests WHERE id=$1 FOR UPDATE",
      [saved.requestId],
    )
  ).rows[0] as Record<string, unknown> | undefined;
  const details = request?.details as Record<string, unknown> | undefined;
  if (
    !request ||
    request.initiator_id !== saved.initiatorId ||
    String(request.amount_irr) !== input.amount.toString() ||
    request.action_type !== "bank_payment_confirmation" ||
    details?.entityType !== "wallet_bank_receipt" ||
    details.receiptId !== input.id ||
    details.fingerprint !== fingerprint
  )
    conflict("Receipt approval does not match its saved binding");
  if (request.status === "rejected") conflict("Receipt approval was rejected");
  await requireCurrentFinancePermission(client, saved.initiatorId);
  if (request.status === "pending") {
    if (saved.initiatorId === input.actorUserId) return saved;
    await applyApprovalRequestResolutionOnClient(client, {
      requestId: saved.requestId,
      reviewerUserId: input.actorUserId,
      initiatorId: saved.initiatorId,
      status: "pending",
      decision: "approve",
      reviewReason: null,
      now: input.now,
      ip: input.ip,
      actionType: request.action_type,
      amountIrR: request.amount_irr,
    });
    return null;
  }
  if (
    request.status !== "approved" ||
    typeof request.reviewer_id !== "string" ||
    request.reviewer_id === saved.initiatorId
  )
    conflict("Receipt has no valid second approval");
  await requireCurrentFinancePermission(client, request.reviewer_id);
  return null;
}

/** Keep a receipt rejection and its pending approval decision in one transaction. */
export async function rejectWalletReceiptApproval(client:WalletQueryClient,input:{
  id:string;metadata:unknown;actorUserId:string;reason:string;ip:string;now:Date;
}):Promise<string> {
  const binding=walletReceiptApproval(input.metadata)
  if(!binding)return input.reason
  const row=(await client.query('SELECT * FROM approval_requests WHERE id=$1 FOR UPDATE',[binding.requestId])).rows[0] as Record<string,unknown>|undefined
  const details=row?.details as Record<string,unknown>|undefined
  if(!row||row.initiator_id!==binding.initiatorId||details?.receiptId!==input.id||details?.fingerprint!==binding.fingerprint)conflict('Receipt approval binding is invalid')
  if(row.status==='rejected') {
    if(typeof row.review_reason!=='string'||!row.review_reason.trim())conflict('Approval rejection has no reason')
    return row.review_reason
  }
  if(row.status!=='pending')conflict('An approved receipt request cannot be rejected')
  await requireCurrentFinancePermission(client,input.actorUserId)
  await applyApprovalRequestResolutionOnClient(client,{requestId:binding.requestId,reviewerUserId:input.actorUserId,initiatorId:binding.initiatorId,status:'pending',decision:'reject',reviewReason:input.reason,now:input.now,ip:input.ip,actionType:row.action_type,amountIrR:row.amount_irr})
  return input.reason
}

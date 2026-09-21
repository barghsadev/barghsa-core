export interface CancellationRefund {
  invoiceId: string;
  amount: string;
  destination: 'wallet' | 'external_bank';
}
export interface CancellationStatus {
  contractId: string;
  state: string;
  cancelledAt: string | null;
  financialStatus:
    'not_cancelled' | 'unverified' | 'needs_attention' | 'closed' | 'refunds_pending';
  financiallyClosed: boolean;
  refundAmount: string;
  returnedAmount: string;
  canCancel?: boolean;
  canChooseRefund?: boolean;
  refunds: Array<
    CancellationRefund & { id: string; state: string; transactionState: string | null }
  >;
}
export interface CancellationPreview {
  versionId: string;
  fingerprint: string;
  serviceType: string;
  refundableAmount: string;
  blockers: string[];
  invoices: Array<{
    id: string;
    paidAmount: string;
    refundedAmount: string;
    availableRefundAmount: string;
    refundableAmount: string;
  }>;
}
export interface CancellationIntent {
  id: string;
  customerRequestId?: string | null;
  versionId: string;
  reason: string;
  financialFingerprint: string;
  status: 'ready' | 'awaiting_approval' | 'rejected' | 'executed';
  approvalRequestId: string | null;
  refundDecision: { mode: 'full_wallet' | 'custom'; refunds: CancellationRefund[] };
}
export function validCancellationAmount(raw: string, available: string) {
  return (
    /^(0|[1-9][0-9]{0,18})$/.test(raw) &&
    BigInt(raw) <= BigInt(available) &&
    BigInt(raw) <= 9223372036854775807n
  );
}

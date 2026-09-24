import type { ContractDetailData, ContractSignatureData } from './contracts.js';

export function customerContractNextAction(
  contract: Pick<ContractDetailData, 'state' | 'canAccept'> &
    Partial<Pick<ContractDetailData, 'amendment' | 'initialInvoiceId' | 'initialInvoiceState'>>,
  signature: Pick<ContractSignatureData, 'canRecord' | 'canRequest'> | null
): { key: string; owner: 'customer' | 'staff' | 'none'; href: string | null } {
  if (contract.canAccept) return { key: 'accept', owner: 'customer', href: '#contract-accept' };
  if (signature?.canRecord)
    return { key: 'recordSignature', owner: 'customer', href: '#contract-signature' };
  if (signature?.canRequest)
    return { key: 'prepareSignature', owner: 'customer', href: '#contract-signature' };
  if (contract.amendment?.state === 'AwaitingSignature')
    return { key: 'workflow.contract.awaitStaff', owner: 'staff', href: null };
  if (['Active', 'Completed', 'Cancelled'].includes(contract.state))
    return { key: 'workflow.none', owner: 'none', href: null };
  if (
    ['Accepted', 'AwaitingSignature', 'Signed'].includes(contract.state) &&
    contract.initialInvoiceId
  ) {
    if (['Unpaid', 'PartiallyFunded', 'Overdue'].includes(contract.initialInvoiceState ?? ''))
      return {
        key: 'payInitialInvoice',
        owner: 'customer',
        href: `/invoices/${encodeURIComponent(contract.initialInvoiceId)}`,
      };
    if (contract.initialInvoiceState === 'PaymentUnderReview')
      return { key: 'initialPaymentUnderReview', owner: 'staff', href: null };
  }
  return { key: 'workflow.contract.awaitStaff', owner: 'staff', href: null };
}

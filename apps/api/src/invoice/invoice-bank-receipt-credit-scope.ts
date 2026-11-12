import { INVOICE_BANK_RECEIPT_CHANNEL } from '@barghsa/shared/finance';

/** Scope the candidate ledger credit to the confirmed bank receipt. The
 * immutable ledger identity also covers older credits without snapshot metadata. */
export const invoiceBankReceiptCreditScopeSql = `
  credit.wallet_id=r.profile_id AND credit.ref_id=r.id::text
  AND credit.type='topup' AND credit.state='Completed'
  AND credit.amount>0 AND credit.amount<=r.amount
  AND COALESCE(credit.metadata->>'channel','${INVOICE_BANK_RECEIPT_CHANNEL}')='${INVOICE_BANK_RECEIPT_CHANNEL}'
  AND COALESCE(credit.metadata->>'purpose','overpayment')='overpayment'
  AND COALESCE(credit.metadata->>'receiptId',r.id::text)=r.id::text
  AND COALESCE(credit.metadata->>'invoiceId',r.invoice_id::text)=r.invoice_id::text`;

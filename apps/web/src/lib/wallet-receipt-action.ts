export const walletReceiptActions = ['confirm', 'reject', 'emergency'] as const;
export type WalletReceiptAction = (typeof walletReceiptActions)[number];

export function walletReceiptAction(value: string | undefined): WalletReceiptAction | undefined {
  return walletReceiptActions.find((action) => action === value);
}

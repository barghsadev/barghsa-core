import { receiptEditorMessages } from '@barghsa/i18n/receipt-editor';
import type { Page } from '@playwright/test';
import type { WalletReceiptAction } from '../src/lib/wallet-receipt-action';

export async function openWalletReceiptAction(page: Page, action: WalletReceiptAction) {
  const back = page.getByTestId('wallet-receipt-back-to-review');
  if (await back.count()) await back.click();
  await page.getByTestId(`wallet-receipt-open-${action}`).click();
}

export async function enterWalletReceiptInvoiceId(page: Page, locale: 'en' | 'fa') {
  const trigger = page.getByRole('button', {
    name: receiptEditorMessages[locale].useInvoiceId,
    exact: true,
  });
  await trigger.click();
}

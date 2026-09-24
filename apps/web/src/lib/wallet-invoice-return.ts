import { isInvoiceUuid } from './due-at-override.js';

const prefix = 'barghsa.wallet.invoice-return.';
const maxAgeMs = 24 * 60 * 60 * 1000;

export function rememberWalletInvoiceReturn(topUpId: string, invoiceId: string): void {
  if (!isInvoiceUuid(topUpId) || !isInvoiceUuid(invoiceId)) return;
  try {
    window.sessionStorage.setItem(
      `${prefix}${topUpId}`,
      JSON.stringify({ invoiceId, savedAt: Date.now() })
    );
  } catch {
    // Wallet payment must still proceed if tab storage is unavailable.
  }
}

export function walletInvoiceReturnFor(topUpId: string): string | null {
  if (!isInvoiceUuid(topUpId)) return null;
  try {
    const key = `${prefix}${topUpId}`;
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return null;
    const record = saved as { invoiceId?: unknown; savedAt?: unknown };
    if (
      typeof record.invoiceId !== 'string' ||
      !isInvoiceUuid(record.invoiceId) ||
      typeof record.savedAt !== 'number' ||
      !Number.isFinite(record.savedAt) ||
      Date.now() < record.savedAt ||
      Date.now() - record.savedAt > maxAgeMs
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return record.invoiceId;
  } catch {
    return null;
  }
}

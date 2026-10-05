import { evaluateInvoiceBankReceiptClientFile } from '@barghsa/shared/finance/browser';

/** Western comma and Arabic thousands separator (U+066C). */
const IRR_THOUSANDS_SEPARATORS = /[,٬]/g;
/** Integer with explicit thousands grouping, e.g. `250,000` or `1٬234٬567`. */
const IRR_THOUSANDS_GROUPED = /^[0-9]{1,3}(?:[,٬][0-9]{3})+$/;

/**
 * Map Persian (`۰`–`۹`) and Arabic-Indic (`٠`–`٩`) digits to ASCII.
 * Strip only well-formed thousands grouping; preserve every other character
 * so later integer validation can reject decimals, signs, exponents, and
 * pasted text instead of concatenating leftover digit groups into a new amount.
 */
export function normalizeIrrAmountDigits(raw: string): string {
  let ascii = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x06f0 && code <= 0x06f9) {
      ascii += String(code - 0x06f0);
    } else if (code >= 0x0660 && code <= 0x0669) {
      ascii += String(code - 0x0660);
    } else {
      ascii += ch;
    }
  }
  const trimmed = ascii.trim();
  if (IRR_THOUSANDS_GROUPED.test(trimmed)) {
    return trimmed.replace(IRR_THOUSANDS_SEPARATORS, '');
  }
  return trimmed;
}

export function isAllowedInvoiceReceiptFile(file: File): boolean {
  return evaluateInvoiceBankReceiptClientFile({
    name: file.name,
    type: file.type,
    size: file.size,
  }).ok;
}

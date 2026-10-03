import { normalizeProfileDigits } from './profile-digits.js';
export interface InvoiceDraftLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vat: string;
}
export interface InvoiceDraftValues {
  profileId: string;
  reason: string;
  amount: string;
  lines: Record<string, InvoiceDraftLine>;
  lineOrder: string[];
}
export const maxInvoiceIrr = 9_223_372_036_854_775_807n;
export function invoiceDigits(value: string): string {
  return normalizeProfileDigits(value).replace('٫', '.');
}
export function blankInvoiceLine(): InvoiceDraftLine {
  return { id: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '', vat: '0' };
}
export function invoiceLineValues(line: InvoiceDraftLine) {
  const quantity = invoiceDigits(line.quantity),
    price = invoiceDigits(line.unitPrice);
  const rate = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(invoiceDigits(line.vat));
  if (
    !line.description.trim() ||
    line.description.trim().length > 1000 ||
    !/^\d{1,10}$/.test(quantity) ||
    !/^\d{1,19}$/.test(price) ||
    !rate
  )
    return null;
  const count = Number(quantity),
    amount = BigInt(price);
  const basisPoints = Number(rate[1]) * 100 + Number((rate[2] ?? '').padEnd(2, '0'));
  if (count < 1 || count > 2_147_483_647 || amount > maxInvoiceIrr || basisPoints > 10000)
    return null;
  const subtotal = BigInt(count) * amount;
  const total = subtotal + (subtotal * BigInt(basisPoints) + 5000n) / 10000n;
  if (total > maxInvoiceIrr) return null;
  return {
    total,
    line: {
      description: line.description.trim(),
      quantity: count,
      unitPrice: amount.toString(),
      vatRate: basisPoints,
      isTaxable: basisPoints > 0,
    },
  };
}
export function calculateInvoiceDraft(lines: InvoiceDraftLine[]) {
  if (!lines.length || lines.length > 100) return null;
  let total = 0n;
  const parsed = [];
  for (const line of lines) {
    const value = invoiceLineValues(line);
    if (!value) return null;
    total += value.total;
    parsed.push(value.line);
  }
  return total > 0n && total <= maxInvoiceIrr ? { lines: parsed, total } : null;
}

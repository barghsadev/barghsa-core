/** Optional bank name: blank becomes null; invalid input becomes undefined. */
export function parseBankReceiptBankName(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (!name) return null;
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return undefined;
  }
  return name.length <= 128 ? name : undefined;
}

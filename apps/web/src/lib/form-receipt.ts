export function sameFormData(value: unknown, expected: unknown): boolean {
  if (value === expected) return true;
  if (!value || !expected || typeof value !== 'object' || typeof expected !== 'object')
    return false;
  if (Array.isArray(value) || Array.isArray(expected)) return false;
  const actual = value as Record<string, unknown>,
    input = expected as Record<string, unknown>;
  return (
    Object.keys(actual).length === Object.keys(input).length &&
    Object.keys(input).every(
      (key) => Object.hasOwn(actual, key) && sameFormData(actual[key], input[key])
    )
  );
}

export function confirmedDraftReceipt(
  value: unknown,
  input: { profileId: string; currentStep: number; data: object }
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return (
    receipt.currentStep === input.currentStep &&
    (receipt.profileId === undefined || receipt.profileId === input.profileId) &&
    sameFormData(receipt.data, input.data)
  );
}

export function uuidReference(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    throw new Error('Invalid resource reference');
  return value;
}

export function electricityOrderReceipt(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid order receipt');
  const receipt = value as Record<string, unknown>;
  return {
    orderId: uuidReference(receipt.orderId),
    contractId: uuidReference(receipt.contractId),
    invoiceId: uuidReference(receipt.invoiceId),
  };
}

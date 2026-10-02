function sameData(value: unknown, expected: unknown): boolean {
  if (value === expected) return true;
  if (!value || !expected || typeof value !== 'object' || typeof expected !== 'object')
    return false;
  if (Array.isArray(value) || Array.isArray(expected)) return false;
  const actual = value as Record<string, unknown>,
    input = expected as Record<string, unknown>;
  return (
    Object.keys(actual).length === Object.keys(input).length &&
    Object.keys(input).every(
      (key) => Object.hasOwn(actual, key) && sameData(actual[key], input[key])
    )
  );
}

export function electricityDraftConfirmed(
  value: unknown,
  input: { profileId: string; currentStep: number; data: object }
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return (
    receipt.currentStep === input.currentStep &&
    (receipt.profileId === undefined || receipt.profileId === input.profileId) &&
    sameData(receipt.data, input.data)
  );
}

export function electricityOrderReceipt(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid order receipt');
  const receipt = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const key of ['orderId', 'contractId', 'invoiceId']) {
    if (typeof receipt[key] !== 'string' || !uuid.test(receipt[key]))
      throw new Error('Invalid order reference');
  }
  return {
    orderId: receipt.orderId as string,
    contractId: receipt.contractId as string,
    invoiceId: receipt.invoiceId as string,
  };
}

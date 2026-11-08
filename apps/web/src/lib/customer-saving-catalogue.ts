export interface SavingProduct {
  id: string;
  title: { fa: string; en: string };
  description: { fa: string; en: string } | null;
  price: string | null;
  status: string;
  stock_tracking?: boolean;
  available_count?: number;
}
export interface SavingPlan extends SavingProduct {
  hardware: SavingProduct[];
  agreement: { versionId: string; title: string; body: string } | null;
  available: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function localizedText(value: unknown): boolean {
  return record(value) && typeof value.fa === 'string' && typeof value.en === 'string';
}

function validProduct(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    localizedText(value.title) &&
    (value.description === null || localizedText(value.description)) &&
    (value.price === null || (typeof value.price === 'string' && /^-?\d+$/.test(value.price))) &&
    typeof value.status === 'string' &&
    (value.stock_tracking === undefined || typeof value.stock_tracking === 'boolean') &&
    (value.available_count === undefined || Number.isSafeInteger(value.available_count))
  );
}

function validPlan(value: unknown): value is SavingPlan {
  if (!record(value) || !validProduct(value)) return false;
  const { agreement, hardware } = value;
  return (
    typeof value.available === 'boolean' &&
    Array.isArray(hardware) &&
    hardware.every(validProduct) &&
    (agreement === null ||
      (record(agreement) &&
        typeof agreement.versionId === 'string' &&
        agreement.versionId.length > 0 &&
        typeof agreement.title === 'string' &&
        typeof agreement.body === 'string'))
  );
}

export function parseSavingCatalogue(value: unknown): SavingPlan[] | null {
  return record(value) && Array.isArray(value.plans) && value.plans.every(validPlan)
    ? value.plans
    : null;
}

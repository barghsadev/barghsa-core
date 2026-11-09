const systemKeys = ['thermal', 'green', 'free_market', 'energy_saving'] as const;

export type ElectricityCatalogueProduct = {
  id: string | null;
  systemKey: (typeof systemKeys)[number];
  title: Record<string, string> | null;
  description: Record<string, string> | null;
  status: 'active' | 'inactive' | 'archived' | 'missing';
  price: string | null;
  limits: { minKwh: string; maxKwh: string };
  orderable: boolean;
  simpleOrderable: boolean;
  simpleOrderBlockReasons: string[];
};

function isLocalizedText(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value).every((text) => typeof text === 'string'))
  );
}

export function isElectricityCatalogue(value: unknown): value is ElectricityCatalogueProduct[] {
  return (
    Array.isArray(value) &&
    value.length === systemKeys.length &&
    value.every(
      (item, index) =>
        item &&
        typeof item === 'object' &&
        item.systemKey === systemKeys[index] &&
        (item.id === null || typeof item.id === 'string') &&
        isLocalizedText(item.title) &&
        isLocalizedText(item.description) &&
        ['active', 'inactive', 'archived', 'missing'].includes(item.status) &&
        (item.price === null || (typeof item.price === 'string' && /^\d+$/.test(item.price))) &&
        typeof item.limits?.minKwh === 'string' &&
        /^\d+$/.test(item.limits.minKwh) &&
        typeof item.limits?.maxKwh === 'string' &&
        /^\d+$/.test(item.limits.maxKwh) &&
        typeof item.orderable === 'boolean' &&
        typeof item.simpleOrderable === 'boolean' &&
        Array.isArray(item.simpleOrderBlockReasons) &&
        item.simpleOrderBlockReasons.every((reason: unknown) => typeof reason === 'string')
    )
  );
}

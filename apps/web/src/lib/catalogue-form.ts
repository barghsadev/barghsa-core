import { normalizeProfileDigits } from './profile-digits.js';
export const types = ['consultation', 'electricity', 'hardware', 'saving_plan'] as const;
export type ProductType = (typeof types)[number];
export type Product = {
  id: string;
  type: ProductType;
  systemKey: string | null;
  title: { fa: string; en: string };
  description: { fa: string; en: string } | null;
  price: string | null;
  status: 'active' | 'inactive' | 'archived';
  categories: string[];
  electricityLimits: { minKwh: string; maxKwh: string } | null;
};
export type Detail = Product & {
  hardwareIds?: string[];
  priceHistory: {
    id: string;
    price: string;
    effectiveFrom: string;
    effectiveUntil: string | null;
  }[];
  electricityLimitHistory: {
    id: string;
    minKwh: string;
    maxKwh: string;
    effectiveFrom: string;
    effectiveUntil: string | null;
  }[];
};
export type References = { greenModes: string[]; vatOverride: boolean };
export type Draft = {
  titleFa: string;
  titleEn: string;
  descriptionFa: string;
  descriptionEn: string;
  price: string;
  categories: string[];
  hardwareIds: string[];
  configureLimits: boolean;
  minKwh: string;
  maxKwh: string;
};
export const categoryOptions: Record<ProductType, string[]> = {
  consultation: [
    'electricity_generation_station_consultation',
    'electricity_saving_certificate_consultation',
  ],
  electricity: [
    'thermal_electricity',
    'green_electricity',
    'free_market_electricity',
    'energy_saving_electricity',
  ],
  hardware: [],
  saving_plan: [],
};

export const productDefaults: Draft = {
  titleFa: '',
  titleEn: '',
  descriptionFa: '',
  descriptionEn: '',
  price: '',
  categories: [],
  hardwareIds: [],
  configureLimits: false,
  minKwh: '0',
  maxKwh: '0',
};
export interface PriceDraft {
  price: string;
  scheduled: boolean;
  date: Date | undefined;
  time: string;
}
export const priceDefaults: PriceDraft = {
  price: '',
  scheduled: false,
  date: undefined,
  time: '00:00',
};
export function catalogueInteger(raw: string): string | null {
  const normalized = normalizeProfileDigits(raw).trim();
  return /^\d{1,18}$/.test(normalized) ? BigInt(normalized).toString() : null;
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const text = (value: unknown) =>
  record(value) && typeof value.fa === 'string' && typeof value.en === 'string';
const amount = (value: unknown) => typeof value === 'string' && /^\d{1,18}$/.test(value);
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function validProduct(value: unknown): value is Product {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    types.includes(value.type as ProductType) &&
    (value.systemKey === null || typeof value.systemKey === 'string') &&
    text(value.title) &&
    (value.description === null || text(value.description)) &&
    (value.price === null || amount(value.price)) &&
    ['active', 'inactive', 'archived'].includes(String(value.status)) &&
    strings(value.categories) &&
    (value.electricityLimits === null ||
      (record(value.electricityLimits) &&
        amount(value.electricityLimits.minKwh) &&
        amount(value.electricityLimits.maxKwh)))
  );
}
export function validProducts(value: unknown, type: ProductType): value is Product[] {
  return Array.isArray(value) && value.every((row) => validProduct(row) && row.type === type);
}
export function validDetail(value: unknown): value is Detail {
  const window = (row: unknown) =>
    record(row) &&
    typeof row.id === 'string' &&
    instant(row.effectiveFrom) &&
    (row.effectiveUntil === null ||
      (instant(row.effectiveUntil) &&
        Date.parse(String(row.effectiveUntil)) > Date.parse(String(row.effectiveFrom))));
  const data = value as Record<string, unknown>;
  return (
    validProduct(value) &&
    record(value) &&
    Array.isArray(data.priceHistory) &&
    data.priceHistory.every((row) => window(row) && amount(row.price)) &&
    Array.isArray(data.electricityLimitHistory) &&
    data.electricityLimitHistory.every(
      (row) => window(row) && amount(row.minKwh) && amount(row.maxKwh)
    ) &&
    (data.hardwareIds === undefined || strings(data.hardwareIds))
  );
}
export function validReferences(value: unknown): value is References {
  return record(value) && strings(value.greenModes) && typeof value.vatOverride === 'boolean';
}
export function validConfig(
  value: unknown
): value is { hardwareIds: string[]; preventActiveDuplicates: boolean } {
  return (
    record(value) &&
    strings(value.hardwareIds) &&
    typeof value.preventActiveDuplicates === 'boolean'
  );
}
export function productBasis(value: Product | null) {
  return value
    ? {
        id: value.id,
        type: value.type,
        systemKey: value.systemKey,
        title: value.title,
        description: value.description,
        price: value.price,
        status: value.status,
        categories: [...value.categories].sort(),
        electricityLimits: value.electricityLimits,
      }
    : null;
}
export function detailBasis(
  value: Detail | null,
  refs: References | null,
  config?: { hardwareIds: string[]; preventActiveDuplicates: boolean }
) {
  const versions = (
    rows: (Detail['priceHistory'][number] | Detail['electricityLimitHistory'][number])[]
  ) =>
    rows
      .map((row) => ({
        id: row.id,
        from: row.effectiveFrom,
        until: row.effectiveUntil,
        ...('price' in row ? { price: row.price } : { min: row.minKwh, max: row.maxKwh }),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    product: productBasis(value),
    prices: versions(value?.priceHistory ?? []),
    limits: versions(value?.electricityLimitHistory ?? []),
    references: refs
      ? { greenModes: [...refs.greenModes].sort(), vatOverride: refs.vatOverride }
      : null,
    ...(config
      ? { hardware: [...config.hardwareIds].sort(), duplicates: config.preventActiveDuplicates }
      : {}),
  });
}
export function matchesProductReceipt(
  body: unknown,
  value: unknown,
  selected: Detail | null,
  type: ProductType
): boolean {
  if (
    !record(body) ||
    !validDetail(value) ||
    value.type !== type ||
    (selected
      ? value.id !== selected.id || value.systemKey !== selected.systemKey
      : value.systemKey !== null)
  )
    return false;
  const setsEqual = (a: string[], b: unknown) =>
    strings(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (
    body.title !== undefined &&
    (!record(body.title) || value.title.fa !== body.title.fa || value.title.en !== body.title.en)
  )
    return false;
  if (
    body.description !== undefined &&
    (!record(body.description) ||
      value.description?.fa !== body.description.fa ||
      value.description?.en !== body.description.en)
  )
    return false;
  if (body.categories !== undefined && !setsEqual(value.categories, body.categories)) return false;
  if (
    body.hardwareIds !== undefined &&
    (!value.hardwareIds || !setsEqual(value.hardwareIds, body.hardwareIds))
  )
    return false;
  if (body.status !== undefined && value.status !== body.status) return false;
  if (!selected && (value.price !== body.price || value.status !== 'inactive')) return false;
  if (
    (body.minKwh !== undefined && value.electricityLimits?.minKwh !== body.minKwh) ||
    (body.maxKwh !== undefined && value.electricityLimits?.maxKwh !== body.maxKwh)
  )
    return false;
  return true;
}
export function matchesPriceReceipt(body: unknown, value: unknown, selected: Detail): boolean {
  if (
    !record(body) ||
    !validDetail(value) ||
    value.id !== selected.id ||
    value.type !== selected.type ||
    value.systemKey !== selected.systemKey
  )
    return false;
  const open = value.priceHistory.find(
    (row) => row.effectiveUntil === null && row.price === body.price
  );
  if (!open) return false;
  const prior = selected.priceHistory.find((row) => row.id === open.id);
  if (prior)
    return (
      prior.price === open.price &&
      prior.effectiveUntil === null &&
      Date.parse(prior.effectiveFrom) === Date.parse(open.effectiveFrom)
    );
  return (
    body.effectiveFrom === undefined ||
    Date.parse(String(body.effectiveFrom)) === Date.parse(open.effectiveFrom)
  );
}

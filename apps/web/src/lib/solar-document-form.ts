export interface SolarReviewDraft {
  reason: string;
}
export type SolarReviewIntent = 'reject' | 'request_additional';
export type SolarGuidanceItem = { fa: string; en: string };
export interface SolarGuidanceDraft {
  fa: string;
  en: string;
  items: SolarGuidanceItem[];
}
export interface SolarGuidance {
  fa: string;
  en: string;
  suggestions: SolarGuidanceItem[];
}
export const emptySolarGuidance: SolarGuidanceDraft = {
  fa: '',
  en: '',
  items: [],
};
export const normalizeGuidanceItems = (items: SolarGuidanceItem[]) =>
  items.map(({ fa, en }) => ({ fa: fa.trim(), en: en.trim() }));

export function guidanceErrorPaths(
  fields: unknown[],
  kind: 'suggestions' | 'originals',
  hasItems: boolean
) {
  const owned: Record<string, string> = {
    fa: 'fa',
    en: 'en',
    [kind + 'Fa']: hasItems ? 'items.0.fa' : 'items',
    [kind + 'En']: hasItems ? 'items.0.en' : 'items',
    ...(kind === 'originals'
      ? { destinationAddress: 'destinationAddress', contactDetails: 'contactDetails' }
      : {}),
  };
  if (
    !fields.length ||
    !fields.every((field) => typeof field === 'string' && Object.hasOwn(owned, field))
  )
    return [];
  return fields.map((field) => owned[field as string]);
}
export function solarGuidanceBody(draft: SolarGuidanceDraft): SolarGuidance {
  return {
    fa: draft.fa.trim(),
    en: draft.en.trim(),
    suggestions: normalizeGuidanceItems(draft.items),
  };
}
export function solarGuidanceDraft(value: SolarGuidance): SolarGuidanceDraft {
  return {
    fa: value.fa,
    en: value.en,
    items: value.suggestions,
  };
}
export function validSolarGuidance(value: unknown): value is SolarGuidance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as SolarGuidance;
  return (
    typeof item.fa === 'string' &&
    !!item.fa.trim() &&
    item.fa.length <= 4000 &&
    typeof item.en === 'string' &&
    !!item.en.trim() &&
    item.en.length <= 4000 &&
    Array.isArray(item.suggestions) &&
    item.suggestions.length <= 30 &&
    item.suggestions.every(
      (line) =>
        line &&
        typeof line.fa === 'string' &&
        !!line.fa.trim() &&
        line.fa.length <= 200 &&
        typeof line.en === 'string' &&
        !!line.en.trim() &&
        line.en.length <= 200
    )
  );
}
export function confirmedSolarGuidance(value: unknown, expected: SolarGuidance): boolean {
  return (
    validSolarGuidance(value) &&
    value.fa === expected.fa &&
    value.en === expected.en &&
    value.suggestions.length === expected.suggestions.length &&
    value.suggestions.every(
      (item, index) =>
        item.fa === expected.suggestions[index]?.fa && item.en === expected.suggestions[index]?.en
    )
  );
}

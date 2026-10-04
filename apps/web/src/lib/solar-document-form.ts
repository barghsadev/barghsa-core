export interface SolarReviewDraft {
  reason: string;
}
export type SolarReviewIntent = 'reject' | 'request_additional';
export interface SolarGuidanceDraft {
  fa: string;
  en: string;
  faSuggestions: string;
  enSuggestions: string;
}
export interface SolarGuidance {
  fa: string;
  en: string;
  suggestions: Array<{ fa: string; en: string }>;
}
export const emptySolarGuidance: SolarGuidanceDraft = {
  fa: '',
  en: '',
  faSuggestions: '',
  enSuggestions: '',
};
export const suggestionLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
export function solarGuidanceBody(draft: SolarGuidanceDraft): SolarGuidance {
  const fa = suggestionLines(draft.faSuggestions),
    en = suggestionLines(draft.enSuggestions);
  return {
    fa: draft.fa.trim(),
    en: draft.en.trim(),
    suggestions: fa.map((text, index) => {
      const translation = en[index];
      if (translation === undefined) throw new Error('Unpaired suggestions');
      return { fa: text, en: translation };
    }),
  };
}
export function solarGuidanceDraft(value: SolarGuidance): SolarGuidanceDraft {
  return {
    fa: value.fa,
    en: value.en,
    faSuggestions: value.suggestions.map((item) => item.fa).join('\n'),
    enSuggestions: value.suggestions.map((item) => item.en).join('\n'),
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

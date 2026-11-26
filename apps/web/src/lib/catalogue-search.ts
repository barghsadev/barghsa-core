import { normalizeProfileDigits } from './profile-digits.js';

export function catalogueSearchText(value: string) {
  return normalizeProfileDigits(value)
    .trim()
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\s\u200c]+/g, ' ');
}

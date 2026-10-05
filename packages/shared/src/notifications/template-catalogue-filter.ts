/** A bounded, exact event key shared by catalogue URLs, controls and API validation. */
export function parseTemplateEventKey(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) return '';
  const key = value.trim();
  return /^\S+$/.test(key) ? key : '';
}

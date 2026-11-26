/** Parse a number input's numeric syntax, excluding JavaScript prefixes and blanks. */
export function parseRecordNumber(value: string): number {
  const text = value.trim();
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN;
}

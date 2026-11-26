/** Preserve identifier strings and leading zeros when converting localized digits. */
export function normalizeProfileDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

/** Remove grouping separators between digits without discarding other input. */
export function stripPostalCodeSeparators(value: string): string {
  return value.trim().replace(/([0-9۰-۹٠-٩])[\s\p{Pd}]+(?=[0-9۰-۹٠-٩])/gu, '$1');
}

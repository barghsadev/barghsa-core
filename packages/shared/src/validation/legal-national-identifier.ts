/**
 * Iranian national identifier (شناسه ملی اشخاص حقوقی) validation.
 *
 * The Iranian national identifier for legal entities is an 11-digit number.
 * Simple validation rules:
 * - Must be exactly 11 digits
 * - Must not be all zeros
 * - Must not be all same digit
 *
 * Note: The full checksum algorithm for the 11-digit legal national identifier
 * is more complex. This is a format-level validation. Deep checksum validation
 * can be added if the official algorithm is documented.
 *
 * @param value - The raw national identifier string.
 * @returns `true` if the national identifier passes format validation.
 */
export function validateLegalNationalIdentifier(value: string): boolean {
  // Must be exactly 11 digits
  if (!/^\d{11}$/.test(value)) return false

  // Must not be all zeros
  if (/^0{11}$/.test(value)) return false

  // All same digit is invalid
  const first = value[0]
  if (first !== undefined && [...value].every((d) => d === first)) return false

  return true
}
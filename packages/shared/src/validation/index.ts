/**
 * Iranian national ID (کد ملی) validation utilities (T-03.02.02).
 *
 * The Iranian national ID is a 10-digit number where the last digit is a
 * checksum computed from the first 9 digits using a weighted-sum algorithm.
 *
 * Algorithm:
 * 1. Multiply each of the first 9 digits by its position weight
 *    (10 through 2, descending).
 * 2. Sum the products.
 * 3. Compute remainder = sum % 11.
 * 4. If remainder < 2, checksum = remainder.
 *    If remainder >= 2, checksum = 11 - remainder.
 * 5. The last digit of the national ID must equal the checksum.
 */

/**
 * Validate an Iranian national ID (کد ملی).
 *
 * @param value - The raw national ID string (may include leading zeros).
 * @returns `true` if the national ID passes the checksum algorithm.
 */
export function validateNationalId(value: string): boolean {
  // Must be exactly 10 digits
  if (!/^\d{10}$/.test(value)) return false

  // Leading zeros are valid, but the algorithm only works on the digit
  // positions 0-9 of the 10-digit string.
  const digits = value.split('').map(Number)

  // All same digit is invalid (e.g., 1111111111, 2222222222)
  const first = digits[0]
  if (first !== undefined && digits.every((d) => d === first)) return false

  // Weighted sum: positions 0-9 have weights 10, 9, 8, ..., 2
  let sum = 0
  for (let i = 0; i < 9; i++) {
    const digit = digits[i]
    if (digit === undefined) return false
    sum += digit * (10 - i)
  }

  const remainder = sum % 11
  const checksum = remainder < 2 ? remainder : 11 - remainder

  const last = digits[9]
  return last !== undefined && checksum === last
}

/**
 * Iranian postal code validation.
 *
 * Iranian postal codes are 10 digits. The first digit is the region code
 * (1-9). The format is: `[1-9]\d{9}`.
 *
 * @param value - The raw postal code string.
 * @returns `true` if the postal code passes basic format validation.
 */
export function validatePostalCode(value: string): boolean {
  return /^[1-9]\d{9}$/.test(value)
}
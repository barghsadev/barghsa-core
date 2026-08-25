import { describe, it, expect } from 'vitest'
import { validateNationalId, validatePostalCode } from './index.js'

describe('validateNationalId', () => {
  it('accepts a valid Iranian national ID', () => {
    // Valid Iranian national ID with correct checksum
    // 0010350829 is a commonly used test code (valid checksum)
    expect(validateNationalId('0010350829')).toBe(true)
  })

  it('accepts a valid national ID with leading zeros', () => {
    // Leading zeros are part of the 10-digit format
    expect(validateNationalId('0000000000')).toBe(false) // all zeros is invalid
    expect(validateNationalId('0012345679')).toBe(true) // example valid one
  })

  it('rejects non-10-digit values', () => {
    expect(validateNationalId('')).toBe(false)
    expect(validateNationalId('123456789')).toBe(false) // 9 digits
    expect(validateNationalId('12345678901')).toBe(false) // 11 digits
    expect(validateNationalId('abc')).toBe(false)
  })

  it('rejects all-same-digit values', () => {
    expect(validateNationalId('1111111111')).toBe(false)
    expect(validateNationalId('2222222222')).toBe(false)
    expect(validateNationalId('9999999999')).toBe(false)
  })

  it('rejects values with invalid checksum', () => {
    // 0010350829 valid, changing the last digit
    expect(validateNationalId('0010350820')).toBe(false)
    expect(validateNationalId('0010350828')).toBe(false)
  })

  it('rejects non-numeric values', () => {
    expect(validateNationalId('abcdefghij')).toBe(false)
    expect(validateNationalId('12345abcde')).toBe(false)
  })

  it('rejects values with leading/trailing whitespace', () => {
    expect(validateNationalId(' 0010350829')).toBe(false)
    expect(validateNationalId('0010350829 ')).toBe(false)
  })
})

describe('validatePostalCode', () => {
  it('accepts a valid 10-digit Iranian postal code', () => {
    // Iranian postal codes start with 1-9 and are 10 digits
    expect(validatePostalCode('1234567890')).toBe(true)
    expect(validatePostalCode('9876543210')).toBe(true)
    expect(validatePostalCode('1134567890')).toBe(true)
  })

  it('rejects postal codes starting with 0', () => {
    expect(validatePostalCode('0123456789')).toBe(false)
    expect(validatePostalCode('0987654321')).toBe(false)
  })

  it('rejects non-10-digit values', () => {
    expect(validatePostalCode('')).toBe(false)
    expect(validatePostalCode('123456789')).toBe(false) // 9 digits
    expect(validatePostalCode('12345678901')).toBe(false) // 11 digits
  })

  it('rejects non-numeric values', () => {
    expect(validatePostalCode('abcdefghij')).toBe(false)
    expect(validatePostalCode('12345abcde')).toBe(false)
  })
})
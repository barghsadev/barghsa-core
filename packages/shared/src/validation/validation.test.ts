import { describe, it, expect } from 'vitest';
import {
  validateNationalId,
  validatePostalCode,
  validateLegalNationalIdentifier,
  normalizeUsername,
} from './index.js';
import { passwordSchema, replacementPasswordSchema } from './password.js';
import { meetsPasswordMinimum, meetsReplacementPasswordPolicy } from './password-policy.js';
import {
  canonicalizeAuthenticationUsername,
  isAuthenticationUsername,
} from './normalize-username.js';
import { isE164, isEmail, parseUsername, usernameSchema } from './username.js';

describe('password policy', () => {
  it('enforces length and ASCII character classes without rewriting the input', () => {
    for (const schema of [passwordSchema, replacementPasswordSchema]) {
      expect(schema.parse('Abcdefg1')).toBe('Abcdefg1');
      expect(schema.parse(' Abcdefg1 ')).toBe(' Abcdefg1 ');
      for (const invalid of ['Abcdef1', 'abcdefg1', 'ABCDEFG1', 'Abcdefgh', 'Abcdefg۱']) {
        const result = schema.safeParse(invalid);
        expect(result.error?.issues[0]?.message).toBe('AUTH:REGISTER:WEAK_PASSWORD');
      }
    }
  });

  it('retains the replacement-only upper bound', () => {
    const limit = 'Ab1' + 'x'.repeat(125);
    expect(replacementPasswordSchema.parse(limit)).toBe(limit);
    expect(replacementPasswordSchema.safeParse(limit + 'x').error?.issues[0]?.message).toBe(
      'AUTH:REGISTER:WEAK_PASSWORD'
    );
    expect(passwordSchema.parse(limit + 'x')).toBe(limit + 'x');
  });

  it('keeps the lightweight browser checks aligned with both schemas', () => {
    for (const value of [
      '',
      ' Abcdefg1 ',
      'Abcdef1',
      'abcdefg1',
      'ABCDEFG1',
      'Abcdefgh',
      'Abcdefg۱',
      'Ab1' + 'x'.repeat(125),
      'Ab1' + 'x'.repeat(126),
    ]) {
      expect(meetsPasswordMinimum(value)).toBe(passwordSchema.safeParse(value).success);
      expect(meetsReplacementPasswordPolicy(value)).toBe(
        replacementPasswordSchema.safeParse(value).success
      );
    }
  });
});

describe('normalizeUsername', () => {
  it('converts Iranian mobile 09xxxxxxxxx to E.164', () => {
    expect(normalizeUsername('09121234567')).toBe('+989121234567');
  });

  it('converts Iranian mobile 00989xxxxxxxxx to E.164', () => {
    expect(normalizeUsername('00989121234567')).toBe('+989121234567');
  });

  it('converts Iranian mobile 989xxxxxxxxx to E.164', () => {
    expect(normalizeUsername('989121234567')).toBe('+989121234567');
  });

  it('passes through already E.164 Iranian mobile', () => {
    expect(normalizeUsername('+989121234567')).toBe('+989121234567');
  });

  it('lowercases email', () => {
    expect(normalizeUsername('User@Example.COM')).toBe('user@example.com');
  });

  it('passes through already lowercase email', () => {
    expect(normalizeUsername('user@example.com')).toBe('user@example.com');
  });

  it('passes through international numbers starting with +', () => {
    expect(normalizeUsername('+447911123456')).toBe('+447911123456');
  });

  it('returns null for empty string', () => {
    expect(normalizeUsername('')).toBe(null);
  });

  it('returns null for whitespace-only string', () => {
    expect(normalizeUsername('   ')).toBe(null);
  });

  it('returns null for unrecognisable input', () => {
    expect(normalizeUsername('not-a-phone-or-email')).toBe(null);
    expect(normalizeUsername('@')).toBe(null);
    expect(normalizeUsername('123')).toBe(null);
  });

  it('trims whitespace before normalizing', () => {
    expect(normalizeUsername('  09121234567  ')).toBe('+989121234567');
    expect(normalizeUsername('  User@Example.COM  ')).toBe('user@example.com');
  });
});

describe('typed username validation', () => {
  it('classifies email and canonicalizes supported mobile forms', () => {
    expect(parseUsername(' Person@Example.TEST ')).toEqual({
      type: 'email',
      value: 'person@example.test',
    });
    for (const value of ['09121234567', '00989121234567', '989121234567', '+989121234567']) {
      expect(parseUsername(value)).toEqual({ type: 'mobile', value: '+989121234567' });
    }
    expect(parseUsername('+447911123456')).toEqual({ type: 'mobile', value: '+447911123456' });
  });

  it('requires a valid canonical identifier at the strict schema boundary', () => {
    expect(isEmail('person@example.test')).toBe(true);
    expect(isE164('+1234567')).toBe(true);
    expect(isE164('+123456789012345')).toBe(true);
    for (const value of ['+0234567', '+123456', '+1234567890123456', 'a..b@example.test']) {
      expect(usernameSchema.safeParse(value).success).toBe(false);
      expect(parseUsername(value)).toBeNull();
    }
    expect(normalizeUsername('+0234567')).toBeNull();
    expect(usernameSchema.safeParse('09121234567').success).toBe(false);
    expect(usernameSchema.parse('+989121234567')).toBe('+989121234567');
  });

  it('preserves the authentication boundary for existing clients and stored identifiers', () => {
    const legacyEmail = canonicalizeAuthenticationUsername(' A..B@EXAMPLE.TEST ');
    expect(legacyEmail).toBe('a..b@example.test');
    expect(isAuthenticationUsername(legacyEmail)).toBe(true);
    expect(isEmail(legacyEmail)).toBe(false);
    expect(canonicalizeAuthenticationUsername(' 09121234567 ')).toBe('+989121234567');
    expect(isAuthenticationUsername(canonicalizeAuthenticationUsername('989121234567'))).toBe(
      false
    );
  });
});

describe('validateNationalId', () => {
  it('accepts a valid Iranian national ID', () => {
    // Valid Iranian national ID with correct checksum
    // 0010350829 is a commonly used test code (valid checksum)
    expect(validateNationalId('0010350829')).toBe(true);
  });

  it('accepts a valid national ID with leading zeros', () => {
    // Leading zeros are part of the 10-digit format
    expect(validateNationalId('0000000000')).toBe(false); // all zeros is invalid
    expect(validateNationalId('0012345679')).toBe(true); // example valid one
  });

  it('rejects non-10-digit values', () => {
    expect(validateNationalId('')).toBe(false);
    expect(validateNationalId('123456789')).toBe(false); // 9 digits
    expect(validateNationalId('12345678901')).toBe(false); // 11 digits
    expect(validateNationalId('abc')).toBe(false);
  });

  it('rejects all-same-digit values', () => {
    expect(validateNationalId('1111111111')).toBe(false);
    expect(validateNationalId('2222222222')).toBe(false);
    expect(validateNationalId('9999999999')).toBe(false);
  });

  it('rejects values with invalid checksum', () => {
    // 0010350829 valid, changing the last digit
    expect(validateNationalId('0010350820')).toBe(false);
    expect(validateNationalId('0010350828')).toBe(false);
  });

  it('rejects non-numeric values', () => {
    expect(validateNationalId('abcdefghij')).toBe(false);
    expect(validateNationalId('12345abcde')).toBe(false);
  });

  it('rejects values with leading/trailing whitespace', () => {
    expect(validateNationalId(' 0010350829')).toBe(false);
    expect(validateNationalId('0010350829 ')).toBe(false);
  });
});

describe('validatePostalCode', () => {
  it('accepts a valid 10-digit Iranian postal code', () => {
    // Iranian postal codes start with 1-9 and are 10 digits
    expect(validatePostalCode('1234567890')).toBe(true);
    expect(validatePostalCode('9876543210')).toBe(true);
    expect(validatePostalCode('1134567890')).toBe(true);
  });

  it('rejects postal codes starting with 0', () => {
    expect(validatePostalCode('0123456789')).toBe(false);
    expect(validatePostalCode('0987654321')).toBe(false);
  });

  it('rejects non-10-digit values', () => {
    expect(validatePostalCode('')).toBe(false);
    expect(validatePostalCode('123456789')).toBe(false); // 9 digits
    expect(validatePostalCode('12345678901')).toBe(false); // 11 digits
  });

  it('rejects non-numeric values', () => {
    expect(validatePostalCode('abcdefghij')).toBe(false);
    expect(validatePostalCode('12345abcde')).toBe(false);
  });
});

describe('validateLegalNationalIdentifier', () => {
  it('accepts a valid 11-digit legal national identifier', () => {
    expect(validateLegalNationalIdentifier('12345678901')).toBe(true);
    expect(validateLegalNationalIdentifier('98765432101')).toBe(true);
  });

  it('rejects non-11-digit values', () => {
    expect(validateLegalNationalIdentifier('')).toBe(false);
    expect(validateLegalNationalIdentifier('1234567890')).toBe(false); // 10 digits
    expect(validateLegalNationalIdentifier('123456789012')).toBe(false); // 12 digits
  });

  it('rejects all-zeros', () => {
    expect(validateLegalNationalIdentifier('00000000000')).toBe(false);
  });

  it('rejects all-same-digit values', () => {
    expect(validateLegalNationalIdentifier('11111111111')).toBe(false);
    expect(validateLegalNationalIdentifier('22222222222')).toBe(false);
    expect(validateLegalNationalIdentifier('99999999999')).toBe(false);
  });

  it('rejects non-numeric values', () => {
    expect(validateLegalNationalIdentifier('abcdefghijk')).toBe(false);
    expect(validateLegalNationalIdentifier('12345abcde12')).toBe(false);
  });

  it('rejects values with leading/trailing whitespace', () => {
    expect(validateLegalNationalIdentifier(' 12345678901')).toBe(false);
    expect(validateLegalNationalIdentifier('12345678901 ')).toBe(false);
  });
});

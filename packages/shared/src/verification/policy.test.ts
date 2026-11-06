import { expect, it } from 'vitest';
import {
  DEFAULT_VERIFICATION_POLICY,
  isVerificationPolicy,
  verificationIsCurrent,
  verificationPolicyBasis,
} from './policy.js';
it('validates bounded, distinct document requirements without accepting unknown policy fields', () => {
  expect(isVerificationPolicy(DEFAULT_VERIFICATION_POLICY)).toBe(true);
  for (const days of [0, -1, 1.5, 3651, '30', NaN]) {
    const value = structuredClone(DEFAULT_VERIFICATION_POLICY);
    Object.assign(value.LEGAL, { expiryDays: days });
    expect(isVerificationPolicy(value)).toBe(false);
  }
  expect(isVerificationPolicy({ ...DEFAULT_VERIFICATION_POLICY, bypass: true })).toBe(false);
  for (const documents of [['national_id', 'national_id'], ['other']])
    expect(
      isVerificationPolicy({
        ...DEFAULT_VERIFICATION_POLICY,
        INDIVIDUAL: { required: true, expiryDays: null, documents },
      })
    ).toBe(false);
});
it('compares policies independently of object property and document order', () => {
  const value = structuredClone(DEFAULT_VERIFICATION_POLICY);
  value.LEGAL.documents = ['national_id', 'representative_authority'];
  const reordered = {
    allowManualOverride: value.allowManualOverride,
    autoVerifyStaff: value.autoVerifyStaff,
    LEGAL: { expiryDays: null, documents: [...value.LEGAL.documents].reverse(), required: true },
    INDIVIDUAL: { ...value.INDIVIDUAL },
  };
  expect(verificationPolicyBasis(reordered)).toBe(verificationPolicyBasis(value));
});
it('expires at the exact boundary and fails closed on missing, invalid or future timestamps', () => {
  const now = Date.parse('2026-11-06T12:00:00Z'),
    rule = { required: true, documents: [], expiryDays: 1 };
  expect(verificationIsCurrent('VERIFIED', new Date(now - 86400000 + 1), rule, now)).toBe(true);
  for (const stamp of [null, 'invalid', new Date(now + 1), new Date(now - 86400000)])
    expect(verificationIsCurrent('VERIFIED', stamp, rule, now)).toBe(false);
  expect(verificationIsCurrent('PENDING_VERIFICATION', new Date(now), rule, now)).toBe(false);
  expect(verificationIsCurrent('VERIFIED', null, { ...rule, expiryDays: null }, now)).toBe(true);
});

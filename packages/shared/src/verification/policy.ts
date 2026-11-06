export const VERIFICATION_DOCUMENT_TYPES = [
  'national_id',
  'birth_certificate',
  'registration_notice',
  'articles_of_association',
  'representative_authority',
] as const;
export type VerificationDocumentType = (typeof VERIFICATION_DOCUMENT_TYPES)[number];
export const VERIFICATION_PROFILE_TYPES = ['INDIVIDUAL', 'LEGAL'] as const;
export type VerificationProfileType = (typeof VERIFICATION_PROFILE_TYPES)[number];
export interface ProfileVerificationRequirement {
  required: boolean;
  documents: VerificationDocumentType[];
  expiryDays: number | null;
}
export interface VerificationPolicy {
  INDIVIDUAL: ProfileVerificationRequirement;
  LEGAL: ProfileVerificationRequirement;
  autoVerifyStaff: boolean;
  allowManualOverride: boolean;
}
export interface VerificationPolicyView {
  active: VerificationPolicy;
  draft: VerificationPolicy | null;
  version: number;
}
export const DEFAULT_VERIFICATION_POLICY: VerificationPolicy = {
  INDIVIDUAL: { required: true, documents: [], expiryDays: null },
  LEGAL: { required: true, documents: [], expiryDays: null },
  autoVerifyStaff: true,
  allowManualOverride: false,
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export function isVerificationPolicy(value: unknown): value is VerificationPolicy {
  return (
    record(value) &&
    Object.keys(value).length === 4 &&
    typeof value.autoVerifyStaff === 'boolean' &&
    typeof value.allowManualOverride === 'boolean' &&
    VERIFICATION_PROFILE_TYPES.every((type) => {
      const rule = value[type];
      return (
        record(rule) &&
        Object.keys(rule).length === 3 &&
        typeof rule.required === 'boolean' &&
        Array.isArray(rule.documents) &&
        rule.documents.every((doc) =>
          (VERIFICATION_DOCUMENT_TYPES as readonly unknown[]).includes(doc)
        ) &&
        new Set(rule.documents).size === rule.documents.length &&
        (rule.expiryDays === null ||
          (Number.isInteger(rule.expiryDays) &&
            Number(rule.expiryDays) >= 1 &&
            Number(rule.expiryDays) <= 3650))
      );
    })
  );
}
export function isVerificationPolicyView(value: unknown): value is VerificationPolicyView {
  return (
    record(value) &&
    isVerificationPolicy(value.active) &&
    (value.draft === null || isVerificationPolicy(value.draft)) &&
    Number.isSafeInteger(value.version) &&
    Number(value.version) >= 0
  );
}
export const verificationPolicyBasis = (policy: VerificationPolicy) =>
  JSON.stringify({
    INDIVIDUAL: {
      required: policy.INDIVIDUAL.required,
      expiryDays: policy.INDIVIDUAL.expiryDays,
      documents: [...policy.INDIVIDUAL.documents].sort(),
    },
    LEGAL: {
      required: policy.LEGAL.required,
      expiryDays: policy.LEGAL.expiryDays,
      documents: [...policy.LEGAL.documents].sort(),
    },
    autoVerifyStaff: policy.autoVerifyStaff,
    allowManualOverride: policy.allowManualOverride,
  });
export function verificationIsCurrent(
  status: string,
  verifiedAt: string | Date | null,
  rule: ProfileVerificationRequirement,
  now = Date.now()
): boolean {
  if (status !== 'VERIFIED') return false;
  if (rule.expiryDays === null) return true;
  const stamp = verifiedAt === null ? NaN : new Date(verifiedAt).getTime();
  return Number.isFinite(stamp) && stamp <= now && stamp + rule.expiryDays * 86400000 > now;
}

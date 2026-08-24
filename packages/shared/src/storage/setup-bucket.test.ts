import { describe, it, expect } from 'vitest';
import { getStandardLifecycleRules } from './setup-bucket.js';

// ---------------------------------------------------------------------------
// getStandardLifecycleRules
// ---------------------------------------------------------------------------

describe('getStandardLifecycleRules', () => {
  const rules = getStandardLifecycleRules();

  it('returns 6 rules (4 prefix + 1 multipart + 1 legal-hold)', () => {
    expect(rules).toHaveLength(6);
  });

  it('has all rules enabled', () => {
    for (const rule of rules) {
      expect(rule.Status).toBe('Enabled');
    }
  });

  // ── Prefix expiry rules ───────────────────────────────────────────────

  it('creates a tmp/ expiry rule at 1 day', () => {
    const rule = rules.find((r) => r.ID?.startsWith('expire-tmp-'));
    expect(rule).toBeDefined();
    expect(rule!.Filter?.Prefix).toBe('tmp/');
    expect(rule!.Expiration?.Days).toBe(1);
    expect(rule!.NoncurrentVersionExpiration?.NoncurrentDays).toBe(1);
    expect(rule!.NoncurrentVersionExpiration?.NewerNoncurrentVersions).toBe(5);
  });

  it('creates an uploads/ expiry rule at 1 day', () => {
    const rule = rules.find((r) => r.ID?.startsWith('expire-uploads-'));
    expect(rule).toBeDefined();
    expect(rule!.Filter?.Prefix).toBe('uploads/');
    expect(rule!.Expiration?.Days).toBe(1);
    expect(rule!.NoncurrentVersionExpiration?.NoncurrentDays).toBe(1);
    expect(rule!.NoncurrentVersionExpiration?.NewerNoncurrentVersions).toBe(5);
  });

  it('creates a previews/ expiry rule at 7 days', () => {
    const rule = rules.find((r) => r.ID?.startsWith('expire-previews-'));
    expect(rule).toBeDefined();
    expect(rule!.Filter?.Prefix).toBe('previews/');
    expect(rule!.Expiration?.Days).toBe(7);
    expect(rule!.NoncurrentVersionExpiration?.NoncurrentDays).toBe(7);
    expect(rule!.NoncurrentVersionExpiration?.NewerNoncurrentVersions).toBe(5);
  });

  it('creates a superseded/ expiry rule at 90 days', () => {
    const rule = rules.find((r) => r.ID?.startsWith('expire-superseded-'));
    expect(rule).toBeDefined();
    expect(rule!.Filter?.Prefix).toBe('superseded/');
    expect(rule!.Expiration?.Days).toBe(90);
    expect(rule!.NoncurrentVersionExpiration?.NoncurrentDays).toBe(90);
    expect(rule!.NoncurrentVersionExpiration?.NewerNoncurrentVersions).toBe(5);
  });

  // ── Incomplete multipart upload rule ──────────────────────────────────

  it('creates an incomplete multipart upload abort rule at 1 day', () => {
    const rule = rules.find((r) => r.ID === 'abort-incomplete-multipart-uploads-1d');
    expect(rule).toBeDefined();
    expect(rule!.Filter?.Prefix).toBe('');
    expect(rule!.AbortIncompleteMultipartUpload?.DaysAfterInitiation).toBe(1);
  });

  // ── Legal-hold preservation rule ──────────────────────────────────────

  it('creates a legal-hold preservation rule', () => {
    const rule = rules.find((r) => r.ID === 'legal-hold-preserve');
    expect(rule).toBeDefined();
    expect(rule!.Filter?.And?.Prefix).toBe('');
    expect(rule!.Filter?.And?.Tags).toHaveLength(1);
    expect(rule!.Filter?.And?.Tags![0]!.Key).toBe('legal-hold');
    expect(rule!.Filter?.And?.Tags![0]!.Value).toBe('true');
    expect(rule!.Transitions).toBeDefined();
    expect(rule!.Transitions).toHaveLength(1);
    expect(rule!.Transitions![0]!.Days).toBe(0);
    expect(rule!.Transitions![0]!.StorageClass).toBe('GLACIER');
    expect(rule!.NoncurrentVersionTransitions).toBeDefined();
    expect(rule!.NoncurrentVersionTransitions).toHaveLength(1);
    expect(rule!.NoncurrentVersionTransitions![0]!.NoncurrentDays).toBe(0);
    expect(rule!.NoncurrentVersionTransitions![0]!.StorageClass).toBe('GLACIER');
  });

  // ── Custom tag keys ───────────────────────────────────────────────────

  it('accepts custom legal-hold tag key and value', () => {
    const customRules = getStandardLifecycleRules('hold', 'active');
    const rule = customRules.find((r) => r.ID === 'legal-hold-preserve')!;
    expect(rule.Filter?.And?.Tags![0]!.Key).toBe('hold');
    expect(rule.Filter?.And?.Tags![0]!.Value).toBe('active');
  });
});
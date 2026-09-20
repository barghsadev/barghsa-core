import { describe, it, expect, vi } from 'vitest';
import { getStandardLifecycleRules, setupBucket } from './setup-bucket.js';
import { S3Client } from '@aws-sdk/client-s3';

// Match the prefix/tag filters used by these rules. Expiration rules apply
// independently; a separate transition rule cannot cancel an expiration.
function expirationsFor(key: string, tags: Record<string, string>) {
  return getStandardLifecycleRules().filter((rule) => {
    if (!rule.Expiration && !rule.NoncurrentVersionExpiration) return false;
    const filter = rule.Filter;
    const prefix = filter?.Prefix ?? filter?.And?.Prefix ?? '';
    const required = filter?.Tag ? [filter.Tag] : (filter?.And?.Tags ?? []);
    return key.startsWith(prefix) && required.every((tag) => tags[tag.Key!] === tag.Value);
  });
}

it.each(['tmp/', 'uploads/', 'previews/', 'superseded/'])(
  'never expires held or unclassified objects under %s',
  (prefix) => {
    expect(expirationsFor(prefix + 'record', { 'legal-hold': 'true' })).toEqual([]);
    expect(expirationsFor(prefix + 'record', {})).toEqual([]);
    expect(expirationsFor(prefix + 'record', { 'legal-hold': 'false' })).toHaveLength(1);
  }
);

// ---------------------------------------------------------------------------
// getStandardLifecycleRules
// ---------------------------------------------------------------------------

describe('getStandardLifecycleRules', () => {
  const rules = getStandardLifecycleRules();

  it('returns 5 rules (4 tagged prefixes + 1 multipart)', () => {
    expect(rules).toHaveLength(5);
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
    expect(rule!.Filter?.And?.Prefix).toBe('tmp/');
    expect(rule!.Expiration?.Days).toBe(1);
    expect(rule!.NoncurrentVersionExpiration?.NoncurrentDays).toBe(1);
    expect(rule!.NoncurrentVersionExpiration?.NewerNoncurrentVersions).toBe(5);
  });

  it('creates an uploads/ expiry rule at 1 day', () => {
    const rule = rules.find((r) => r.ID?.startsWith('expire-uploads-'));
    expect(rule).toBeDefined();
    expect(rule!.Filter?.And?.Prefix).toBe('uploads/');
    expect(rule!.Expiration?.Days).toBe(1);
    expect(rule!.NoncurrentVersionExpiration?.NoncurrentDays).toBe(1);
    expect(rule!.NoncurrentVersionExpiration?.NewerNoncurrentVersions).toBe(5);
  });

  it('creates a previews/ expiry rule at 7 days', () => {
    const rule = rules.find((r) => r.ID?.startsWith('expire-previews-'));
    expect(rule).toBeDefined();
    expect(rule!.Filter?.And?.Prefix).toBe('previews/');
    expect(rule!.Expiration?.Days).toBe(7);
    expect(rule!.NoncurrentVersionExpiration?.NoncurrentDays).toBe(7);
    expect(rule!.NoncurrentVersionExpiration?.NewerNoncurrentVersions).toBe(5);
  });

  it('creates a superseded/ expiry rule at 90 days', () => {
    const rule = rules.find((r) => r.ID?.startsWith('expire-superseded-'));
    expect(rule).toBeDefined();
    expect(rule!.Filter?.And?.Prefix).toBe('superseded/');
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

  it('does not transition held files to an offline storage class', () => {
    expect(rules.some((rule) => rule.Transitions || rule.NoncurrentVersionTransitions)).toBe(false);
  });

  it('requires an explicit non-held tag with a custom key', () => {
    const customRules = getStandardLifecycleRules('hold', 'active');
    for (const rule of customRules.filter((r) => r.Expiration)) {
      expect(rule.Filter?.And?.Tags).toEqual([{ Key: 'hold', Value: 'false' }]);
    }
  });

  it('rejects an ambiguous hold value before changing the bucket', async () => {
    const client = new S3Client({ region: 'us-east-1' });
    const send = vi.spyOn(client, 'send');
    await expect(
      setupBucket({ bucket: 'test', client, legalHoldTagValue: 'false' })
    ).rejects.toThrow('distinct from expiration');
    expect(send).not.toHaveBeenCalled();
    client.destroy();
  });
});

it('matches the exact physical provider prefix without changing policy ages', () => {
  const rules = getStandardLifecycleRules('legal-hold', 'true', 'tenant/');
  expect(rules.filter((r) => r.Expiration).map((r) => r.Filter?.And?.Prefix)).toEqual([
    'tenant/tmp/',
    'tenant/uploads/',
    'tenant/previews/',
    'tenant/superseded/',
  ]);
});

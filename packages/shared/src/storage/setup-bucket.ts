/**
 * @barghsa/storage — Bucket versioning & lifecycle setup.
 *
 * Idempotent bucket initialisation that enables versioning and applies the
 * standard set of lifecycle policies required by the platform.
 *
 * ## Lifecycle rules
 *
 * | Prefix / trigger             | Action                  | Age / limit      |
 * |------------------------------|-------------------------|------------------|
 * | `tmp/`                       | Permanent deletion      | 1 day            |
 * | `uploads/`                   | Permanent deletion      | 1 day            |
 * | `previews/`                  | Permanent deletion      | 7 days           |
 * | `superseded/`                | Permanent deletion      | 90 days          |
 * | Incomplete multipart uploads | Abort                   | 1 day            |
 * | Noncurrent versions          | Keep latest 5           | —                |
 *
 * ## Legal hold
 *
 * Objects tagged with `legal-hold: true` are **never** placed under the
 * expiration-prefix paths listed above — the application layer is responsible
 * for ensuring that legal-hold objects live outside those prefixes (e.g.
 * under `legal-hold/` or using S3 Object Lock legal hold at the object
 * level).  S3 Lifecycle rules do **not** support negative tag matching, so
 * prefix-based isolation is the enforcement mechanism.
 *
 * A preservation lifecycle rule matches objects tagged `legal-hold: true`
 * (any prefix) and transitions noncurrent versions to `GLACIER` for cheap
 * retention but never expires them.
 *
 * @module
 */

import {
  S3Client,
  PutBucketVersioningCommand,
  PutBucketLifecycleConfigurationCommand,
  type LifecycleRule,
} from '@aws-sdk/client-s3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BucketSetupConfig {
  /** Bucket name to configure. */
  bucket: string;

  /**
   * Pre-configured S3 client.  Omit to use the standard credential chain
   * (env vars / IAM / `~/.aws/credentials`).
   */
  client?: S3Client;

  /** Skip enabling bucket versioning (default `false`). */
  skipVersioning?: boolean;

  /** Skip applying lifecycle rules (default `false`). */
  skipLifecycle?: boolean;

  /**
   * Tag key that marks an object under legal hold.
   * A preservation rule is added so these objects are never expired.
   * Default `"legal-hold"`.
   */
  legalHoldTagKey?: string;

  /**
   * Tag value that activates legal hold protection.
   * Default `"true"`.
   */
  legalHoldTagValue?: string;
}

export interface BucketSetupResult {
  versioningConfigured: boolean;
  lifecycleConfigured: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_LEGAL_HOLD_KEY = 'legal-hold';
const DEFAULT_LEGAL_HOLD_VALUE = 'true';

// ---------------------------------------------------------------------------
// Lifecycle rules builder
// ---------------------------------------------------------------------------

function buildLifecycleRules(
  legalHoldKey: string,
  legalHoldValue: string,
): LifecycleRule[] {
  const rules: LifecycleRule[] = [];

  // ── Prefix-based expiry rules ──────────────────────────────────────────
  //
  // Each rule matches ALL objects under the prefix.  Legal-hold objects
  // MUST NOT live under these prefixes — the application layer ensures
  // isolation via a separate path (e.g. `legal-hold/`) or S3 Object Lock.
  //
  // `NoncurrentVersionExpiration.NewerNoncurrentVersions: 5` keeps the
  // latest 5 versions of each object; older versions expire after the same
  // number of days as the current version.

  const expiryRules: { prefix: string; days: number }[] = [
    { prefix: 'tmp/', days: 1 },
    { prefix: 'uploads/', days: 1 },
    { prefix: 'previews/', days: 7 },
    { prefix: 'superseded/', days: 90 },
  ];

  for (const { prefix, days } of expiryRules) {
    const safeId = prefix.replace(/[/_]/g, '-').replace(/-$/, '');
    rules.push({
      ID: `expire-${safeId}-${days}d`,
      Status: 'Enabled',
      Filter: { Prefix: prefix },
      Expiration: { Days: days },
      NoncurrentVersionExpiration: {
        NoncurrentDays: days,
        NewerNoncurrentVersions: 5,
      },
    });
  }

  // ── Incomplete multipart upload cleanup ────────────────────────────────
  //
  // Bucket-wide: any incomplete multipart upload older than 1 day is aborted.

  rules.push({
    ID: 'abort-incomplete-multipart-uploads-1d',
    Status: 'Enabled',
    Filter: { Prefix: '' },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
  });

  // ── Legal-hold preservation rule ───────────────────────────────────────
  //
  // Objects tagged `legal-hold: true` are transitioned to GLACIER for cheap
  // long-term storage and never expire.  This rule runs alongside the
  // prefix rules above, but because legal-hold objects logically live
  // outside the expiry prefixes, the only effect is the transition.
  //
  // Noncurrent versions are also transitioned to GLACIER (not deleted).

  rules.push({
    ID: 'legal-hold-preserve',
    Status: 'Enabled',
    Filter: {
      And: {
        Prefix: '',
        Tags: [{ Key: legalHoldKey, Value: legalHoldValue }],
      },
    },
    Transitions: [{ Days: 0, StorageClass: 'GLACIER' }],
    NoncurrentVersionTransitions: [
      { NoncurrentDays: 0, StorageClass: 'GLACIER' },
    ],
  });

  return rules;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Configure a bucket with versioning and lifecycle policies.
 *
 * This is an **idempotent** operation — applying it to an already-configured
 * bucket is safe.  The lifecycle configuration is fully replaced each call.
 *
 * @returns A summary of what was configured.
 *
 * @example
 * ```ts
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { setupBucket } from '@barghsa/shared/storage';
 *
 * const client = new S3Client({ region: 'us-east-1' });
 * const result = await setupBucket({ bucket: 'my-bucket', client });
 * ```
 */
export async function setupBucket(
  config: BucketSetupConfig,
): Promise<BucketSetupResult> {
  const {
    bucket,
    client,
    skipVersioning = false,
    skipLifecycle = false,
    legalHoldTagKey = DEFAULT_LEGAL_HOLD_KEY,
    legalHoldTagValue = DEFAULT_LEGAL_HOLD_VALUE,
  } = config;

  const s3 = client ?? new S3Client({});

  const result: BucketSetupResult = {
    versioningConfigured: false,
    lifecycleConfigured: false,
  };

  // ── Versioning ─────────────────────────────────────────────────────────

  if (!skipVersioning) {
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
    result.versioningConfigured = true;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  if (!skipLifecycle) {
    const rules = buildLifecycleRules(legalHoldTagKey, legalHoldTagValue);

    await s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: { Rules: rules },
      }),
    );
    result.lifecycleConfigured = true;
  }

  return result;
}

/**
 * Build and return the lifecycle rules that `setupBucket` applies.
 *
 * Useful for inspection, documentation, or unit testing without making an S3
 * API call.
 *
 * @example
 * ```ts
 * const rules = getStandardLifecycleRules();
 * expect(rules).toHaveLength(6); // 4 prefix rules + 1 multipart + 1 legal-hold
 * ```
 */
export function getStandardLifecycleRules(
  legalHoldKey: string = DEFAULT_LEGAL_HOLD_KEY,
  legalHoldValue: string = DEFAULT_LEGAL_HOLD_VALUE,
): LifecycleRule[] {
  return buildLifecycleRules(legalHoldKey, legalHoldValue);
}
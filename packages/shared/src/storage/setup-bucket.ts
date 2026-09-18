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
 * Expiration requires an explicit `legal-hold=false` tag. Held and unclassified
 * versions are retained, including objects inside the temporary prefixes.
 * An independent transition rule cannot override an expiration rule.
 * Only a trusted retention workflow may classify a version as disposable.
 * This setup does not classify existing files or protect against direct deletes.
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

  /** Exact physical key prefix used by StorageProvider; no normalization. */
  prefix?: string;

  /** MinIO configures stale multipart cleanup at server level, not lifecycle. */
  backend?: 's3' | 'minio';

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
   * Expiration requires this tag to equal `"false"`. Other values are retained.
   * Default `"legal-hold"`.
   */
  legalHoldTagKey?: string;

  /**
   * Tag value that activates legal hold protection.
   * Default `"true"`. Must not equal the expiration opt-in value `"false"`.
   */
  legalHoldTagValue?: string;
}

export interface BucketSetupResult {
  versioningConfigured: boolean;
  lifecycleConfigured: boolean;
  multipartCleanup: 'bucket-lifecycle' | 'server-config-required' | 'not-configured';
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
  keyPrefix = ''
): LifecycleRule[] {
  if (!legalHoldKey.trim() || !legalHoldValue.trim() || legalHoldValue === 'false') {
    throw new Error('Legal hold tag must be nonempty and distinct from expiration value "false"');
  }
  const rules: LifecycleRule[] = [];
  // S3 only supports positive tag matching. Unknown versions stay retained.
  // Keep the five newest noncurrent versions even after the age threshold.
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
      Filter: {
        And: { Prefix: keyPrefix + prefix, Tags: [{ Key: legalHoldKey, Value: 'false' }] },
      },
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
export async function setupBucket(config: BucketSetupConfig): Promise<BucketSetupResult> {
  const {
    bucket,
    backend = 's3',
    prefix = '',
    client,
    skipVersioning = false,
    skipLifecycle = false,
    legalHoldTagKey = DEFAULT_LEGAL_HOLD_KEY,
    legalHoldTagValue = DEFAULT_LEGAL_HOLD_VALUE,
  } = config;

  // Validate before any external mutation, including enabling versioning.
  const rules = skipLifecycle
    ? undefined
    : buildLifecycleRules(legalHoldTagKey, legalHoldTagValue, prefix).filter(
        (rule) => backend !== 'minio' || !rule.AbortIncompleteMultipartUpload
      );
  const s3 = client ?? new S3Client({});

  const result: BucketSetupResult = {
    versioningConfigured: false,
    lifecycleConfigured: false,
    multipartCleanup: 'not-configured',
  };

  try {
    // ── Versioning ─────────────────────────────────────────────────────────

    if (!skipVersioning) {
      await s3.send(
        new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: 'Enabled' },
        })
      );
      result.versioningConfigured = true;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    if (!skipLifecycle) {
      await s3.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: bucket,
          LifecycleConfiguration: { Rules: rules },
        })
      );
      result.lifecycleConfigured = true;
      result.multipartCleanup = backend === 'minio' ? 'server-config-required' : 'bucket-lifecycle';
    }

    return result;
  } finally {
    if (!client) s3.destroy();
  }
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
 * expect(rules).toHaveLength(5); // 4 tagged prefix rules + 1 multipart
 * ```
 */
export function getStandardLifecycleRules(
  legalHoldKey: string = DEFAULT_LEGAL_HOLD_KEY,
  legalHoldValue: string = DEFAULT_LEGAL_HOLD_VALUE,
  prefix = ''
): LifecycleRule[] {
  return buildLifecycleRules(legalHoldKey, legalHoldValue, prefix);
}

import { Injectable, Logger } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  getDeploymentAllowedExtensions,
  getDeploymentAllowedMimeTypes,
  getDeploymentMaxSizeBytes,
} from './upload.config.js';

/**
 * Effective upload policy resolution (T-09.12.05).
 *
 * The upload path must enforce BOTH the admin-configured DB policy
 * (`upload_policies`, administered via `api/admin/upload-policies`) AND
 * the deployment-level limits in `upload.config.ts`:
 *
 *   effective = min(DB policy, deployment config)
 *
 * - `allowedExtensions` — the DB policy's whitelist intersected with the
 *   deployment extension set (defense in depth: even a direct-DB write
 *   cannot widen what the deployment permits). `null` means "any
 *   extension" (the deployment `general` category has no extension
 *   restriction).
 * - `allowedMimeTypes` — ALWAYS the deployment MIME set. Content types
 *   are a deployment trust boundary (serving/scanning); the DB policy
 *   configures extensions and size only.
 * - `maxSizeBytes` — `min(DB max, deployment cap)`. An admin cannot
 *   raise a category's limit beyond the deployment cap.
 *
 * Degraded mode: when no DB policy is active for the category (or the DB
 * is unavailable), the deployment config alone applies — the pre-existing
 * baseline. This is a documented fail-open-to-baseline: the deployment
 * limits are the hard floor, and a DB outage must not freeze all uploads.
 * The DB lookup error is logged for observability.
 *
 * Categories without an admin-configurable policy (`contract`, `general`)
 * always resolve to the deployment config (the admin API only writes
 * `document` | `image` | `video`).
 */

export interface EffectiveUploadPolicy {
  /**
   * Lowercase `.ext` whitelist, or `null` when any extension is allowed
   * (deployment `general` semantics). An EMPTY array means "no extension
   * is allowed" (fails closed when the deployment set changed under a DB
   * policy — see `resolveEffective`).
   */
  allowedExtensions: string[] | null;
  /** Deployment-level MIME whitelist (never widened by DB config). */
  allowedMimeTypes: string[];
  /** Effective maximum file size in bytes (min of DB and deployment). */
  maxSizeBytes: number;
  /** Which layer(s) produced the effective policy. */
  source: 'db' | 'deployment';
  /** The applied DB policy id, when one was active; else null. */
  policyId: string | null;
}

interface UploadPolicyRow {
  id: string;
  allowed_extensions: string[];
  max_size_bytes: number;
}

@Injectable()
export class UploadPolicyResolver {
  private readonly logger = new Logger(UploadPolicyResolver.name);

  /**
   * Resolve the effective upload policy for a category (see module docs).
   * Never throws for a missing policy or a DB outage — deployment limits
   * always stand.
   */
  async resolveEffective(category: string): Promise<EffectiveUploadPolicy> {
    const deploymentExtensions = getDeploymentAllowedExtensions(category);
    const deploymentMimeTypes = getDeploymentAllowedMimeTypes(category);
    const deploymentMax = getDeploymentMaxSizeBytes(category);

    const base = {
      allowedMimeTypes: deploymentMimeTypes as string[],
      maxSizeBytes: deploymentMax,
    };

    let dbPolicy: UploadPolicyRow | null = null;
    try {
      dbPolicy = await this.findActivePolicy(category);
    } catch (error) {
      // DB outage → deployment baseline. Logged; uploads must not freeze
      // because the admin config store is temporarily unreachable.
      this.logger.warn(
        `Upload policy lookup failed for category "${category}"; falling back to deployment limits: ${String(error)}`,
      );
    }

    if (dbPolicy === null) {
      return {
        ...base,
        allowedExtensions:
          deploymentExtensions.length === 0 ? null : [...deploymentExtensions],
        source: 'deployment',
        policyId: null,
      };
    }

    // Intersect the DB whitelist with the deployment extension set. A
    // policy whose entries all disappeared from the deployment set (e.g.
    // the deployment dropped a format after the policy was written)
    // yields an EMPTY list — which denies every extension (fails closed).
    const intersected = dbPolicy.allowed_extensions.filter((ext) =>
      deploymentExtensions.length === 0 || deploymentExtensions.includes(ext),
    );

    return {
      ...base,
      allowedExtensions: intersected,
      maxSizeBytes: Math.min(dbPolicy.max_size_bytes, deploymentMax),
      source: 'db',
      policyId: dbPolicy.id,
    };
  }

  private async findActivePolicy(category: string): Promise<UploadPolicyRow | null> {
    const pool = getDbPool();
    const result = await pool.query<UploadPolicyRow>(
      `SELECT id, allowed_extensions, max_size_bytes
         FROM upload_policies
        WHERE category = $1
          AND effective_from <= $2
          AND (effective_until IS NULL OR effective_until > $2)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [category, new Date()],
    );
    return result.rows[0] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Pure check helpers (shared by the controller and tests)
// ---------------------------------------------------------------------------

/** Whether a file name's extension is allowed by an effective policy. */
export function effectiveAllowsExtension(
  policy: EffectiveUploadPolicy,
  fileName: string,
): boolean {
  if (policy.allowedExtensions === null) return true;
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = fileName.slice(dot).toLowerCase();
  return policy.allowedExtensions.includes(ext);
}

/** Whether a (client-claimed) content type is allowed by an effective policy. */
export function effectiveAllowsMime(policy: EffectiveUploadPolicy, contentType: string): boolean {
  return policy.allowedMimeTypes.includes(contentType);
}

/** Whether a file size is within the effective limit. */
export function effectiveAllowsSize(policy: EffectiveUploadPolicy, fileSize: number): boolean {
  return fileSize <= policy.maxSizeBytes;
}
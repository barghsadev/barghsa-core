import { ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  VerifiedAttachmentsService,
  type PreparedAttachmentCopies,
} from '../storage/verified-attachments.service.js';
import type { DualApprovalQueryClient } from '../admin/dual-approval-resolution.js';

const SEALED_PREFIX = 'verification-evidence/';

@Injectable()
export class VerificationEvidenceService {
  constructor(
    private readonly attachments: VerifiedAttachmentsService = new VerifiedAttachmentsService()
  ) {}

  plan(client: DualApprovalQueryClient, keys: string[], actorId: string, profileId: string) {
    return this.attachments.plan(client, keys, actorId, profileId, 'verification_evidence');
  }

  copy(plan: Awaited<ReturnType<VerificationEvidenceService['plan']>>, directClient?: PoolClient) {
    return this.attachments.copy(plan, directClient);
  }

  publish(client: DualApprovalQueryClient, prepared: PreparedAttachmentCopies) {
    return this.attachments.publish(client, prepared);
  }

  async validate(
    client: DualApprovalQueryClient,
    keys: string[],
    profileId: string
  ): Promise<void> {
    if (!keys.length)
      throw new ConflictException(
        'Legacy correction has no sealed evidence; recreate it for review'
      );
    for (const key of keys) {
      if (!key.startsWith(SEALED_PREFIX))
        throw new ConflictException('Legacy correction evidence must be resubmitted');
      const row = (
        await client.query(
          'SELECT status,metadata FROM storage_records WHERE storage_key=$1 FOR SHARE',
          [key]
        )
      ).rows[0] as { status: string; metadata: Record<string, unknown> } | undefined;
      if (
        row?.status !== 'immutable' ||
        row.metadata.profileId !== profileId ||
        row.metadata.purpose !== 'verification_evidence' ||
        typeof row.metadata.sha256 !== 'string'
      )
        throw new ConflictException('Correction evidence is unavailable or unbound');
    }
  }
  downloadUrls(keys: string[]): Promise<string[]> {
    return this.attachments.downloadUrls(keys, 'verification_evidence');
  }
}

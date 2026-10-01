import {
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Redirect,
  Req,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { StorageProvider } from '@barghsa/shared/storage';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { activeProfileSql } from '../profiles/profile-context.js';
import { ensureDocumentPreview, readPreviewObject } from '../documents/document-preview.js';
import { withCustomerWalletAccess } from './customer-wallet-access.js';

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/wallet/:profileId/bank-receipt-top-ups')
export class CustomerWalletReceiptController {
  constructor(@Optional() @Inject(STORAGE_PROVIDER) private readonly storage?: StorageProvider) {}

  @Get(':receiptId/preview')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit({
    namespace: 'wallet:receipt-preview:user',
    scope: 'user',
    limit: 30,
    windowMs: 60_000,
  })
  @ApiOperation({
    summary: 'Preview a wallet receipt image or first PDF page on the active profile',
  })
  @ApiParam({ name: 'profileId', format: 'uuid' })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Bounded private PNG preview.',
    content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 400, description: 'Invalid profile or receipt ID.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Receipt unavailable on the active profile.' })
  @ApiResponse({ status: 503, description: 'Preview cannot be generated.' })
  async preview(
    @Req() req: AuthenticatedRequest,
    @Param('profileId') profileId: string,
    @Param('receiptId') receiptId: string
  ) {
    const bytes = await this.readEvidence(req, profileId, receiptId, async (storage, key, mime) => {
      if (!mime) throw new ServiceUnavailableException('Receipt preview is unavailable');
      try {
        const preview = await ensureDocumentPreview(
          storage,
          `wallet-receipt-${receiptId.toLowerCase()}`,
          key,
          mime
        );
        return await readPreviewObject(storage, preview, 5 * 1024 * 1024);
      } catch {
        throw new ServiceUnavailableException('Receipt preview is unavailable');
      }
    });
    return new StreamableFile(bytes, {
      type: 'image/png',
      disposition: 'inline',
      length: bytes.length,
    });
  }

  @Get(':receiptId/attachment')
  @Redirect('', 302)
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit({
    namespace: 'wallet:receipt-attachment:user',
    scope: 'user',
    limit: 30,
    windowMs: 60_000,
  })
  @ApiOperation({ summary: 'Open the sealed original wallet receipt on the active profile' })
  @ApiParam({ name: 'profileId', format: 'uuid' })
  @ApiParam({ name: 'receiptId', format: 'uuid' })
  @ApiResponse({ status: 302, description: 'Redirects to a short-lived attachment URL.' })
  @ApiResponse({ status: 400, description: 'Invalid profile or receipt ID.' })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 404, description: 'Receipt unavailable on the active profile.' })
  @ApiResponse({ status: 503, description: 'Receipt storage is unavailable.' })
  async attachment(
    @Req() req: AuthenticatedRequest,
    @Param('profileId') profileId: string,
    @Param('receiptId') receiptId: string
  ): Promise<{ url: string }> {
    return {
      url: await this.readEvidence(req, profileId, receiptId, async (storage, key) => {
        try {
          return await storage.presignedGetUrl(key, 300);
        } catch {
          throw new ServiceUnavailableException('Receipt attachment is unavailable');
        }
      }),
    };
  }

  /** Keep the live wallet grant through storage access and the final session check. */
  private async readEvidence<T>(
    req: AuthenticatedRequest,
    profileId: string,
    receiptId: string,
    read: (storage: StorageProvider, key: string, mime: string | null) => Promise<T>
  ): Promise<T> {
    if (
      !z.string().uuid().safeParse(profileId).success ||
      !z.string().uuid().safeParse(receiptId).success
    )
      throw new HttpException(
        { error: ErrorCodes.VALIDATION_PARSE_ZOD.code, message: 'Invalid profile or receipt ID' },
        400
      );
    profileId = profileId.toLowerCase();
    receiptId = receiptId.toLowerCase();
    return withCustomerWalletAccess(req.session, profileId, 'wallet:view', async (client) => {
      const active = await client.query(activeProfileSql('wallet:view'), [req.session.userId]);
      if (active.rows[0]?.id !== profileId) throw new NotFoundException('No active profile');
      const receipt = (
        await client.query<{ key: string | null; mime: string | null }>(
          `SELECT s.storage_key AS key, s.content_type AS mime
         FROM wallet_transactions t
         LEFT JOIN storage_records s ON s.storage_key=COALESCE(t.receipt_attachment_key,t.metadata#>>'{receipt,attachmentKey}') AND s.status='immutable'
         WHERE t.id=$1::uuid AND t.wallet_id=$2::uuid AND t.type='topup'
           AND t.state<>'Completed' AND t.metadata->>'channel'='bank_receipt'
           AND NOT (t.metadata ? 'pendingTransactionId')`,
          [receiptId, profileId]
        )
      ).rows[0];
      if (!receipt) throw new NotFoundException('Bank receipt not found');
      const storage = this.storage;
      if (!storage || !receipt.key)
        throw new ServiceUnavailableException('Receipt attachment is unavailable');
      return read(storage, receipt.key, receipt.mime);
    });
  }
}

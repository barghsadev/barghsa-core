import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { getDbPool, loadStoredStorageConfiguration } from '@barghsa/db';
import { SecretCipher } from '@barghsa/shared/auth-delivery';
import {
  STORAGE_UPLOAD_WEBHOOK_BODY_LIMIT,
  STORAGE_UPLOAD_WEBHOOK_PATH,
  storageUploadWebhookEvent,
  storageWebhookBucket,
  storageWebhookReceiptContext,
} from '@barghsa/shared/storage';
import { verifyWebhookHmac, WEBHOOK_REPLAY_WINDOW_SECONDS } from '../common/webhook-signature.js';
import { SkipCsrf } from '../session/csrf.guard.js';

async function signingKey(): Promise<Buffer> {
  const path = process.env.STORAGE_WEBHOOK_SIGNING_KEY_FILE;
  if (path) {
    try {
      const file = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(129);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        const configured = buffer.subarray(0, bytesRead).toString('utf8').trim();
        if (bytesRead < buffer.length && /^[0-9a-f]{64}$/i.test(configured))
          return Buffer.from(configured, 'hex');
      } finally {
        await file.close();
      }
    } catch {
      // Filesystem details and secret paths stay out of responses and logs.
    }
  }
  throw new ServiceUnavailableException('Storage webhook unavailable');
}

@ApiExcludeController()
@Controller(STORAGE_UPLOAD_WEBHOOK_PATH)
export class StorageWebhookController {
  @Post()
  @SkipCsrf()
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(@Req() request: IncomingMessage & { rawBody?: Buffer }) {
    const key = await signingKey();
    const id = request.headers['x-barghsa-webhook-id'];
    const timestamp = request.headers['x-barghsa-webhook-timestamp'];
    const signature = request.headers['x-barghsa-webhook-signature'];
    const raw = request.rawBody;
    if (
      typeof id !== 'string' ||
      typeof timestamp !== 'string' ||
      typeof signature !== 'string' ||
      !/^[0-9a-f]{64}$/.test(id) ||
      !/^[A-Za-z0-9+/]{43}=$/.test(signature) ||
      !raw?.length ||
      raw.length > STORAGE_UPLOAD_WEBHOOK_BODY_LIMIT ||
      createHash('sha256').update(raw).digest('hex') !== id
    )
      throw new UnauthorizedException('Invalid storage webhook signature');

    let body: string;
    try {
      body = new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(raw);
    } catch {
      throw new BadRequestException('Invalid storage webhook payload');
    }
    if (
      !verifyWebhookHmac(
        { eventId: id, timestamp, rawPayload: body, key, candidates: [signature] },
        Math.floor(Date.now() / 1000),
        WEBHOOK_REPLAY_WINDOW_SECONDS
      ).ok
    )
      throw new UnauthorizedException('Invalid storage webhook signature');

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new BadRequestException('Invalid storage webhook payload');
    }
    const event = storageUploadWebhookEvent.safeParse(payload);
    if (!event.success) throw new BadRequestException('Invalid storage webhook payload');
    const bucket = storageWebhookBucket(await loadStoredStorageConfiguration());
    if (event.data.bucket !== bucket)
      throw new UnauthorizedException('Invalid storage webhook bucket');

    const cipher = new SecretCipher('STORAGE_CONFIG_ENCRYPTION_KEY');
    if (!cipher.available) throw new ServiceUnavailableException('Storage webhook unavailable');
    const encrypted = cipher.encrypt(body, storageWebhookReceiptContext(id));
    await getDbPool().query(
      `INSERT INTO storage_webhook_events (event_id, encrypted_payload)
       VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING`,
      [id, encrypted]
    );
    return { received: true };
  }
}

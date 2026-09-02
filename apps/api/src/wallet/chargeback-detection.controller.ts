import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { IncomingMessage } from 'node:http'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import { SkipCsrf } from '../session/csrf.guard.js'
import { ChargebackDetectionService } from './chargeback-detection.service.js'

interface ChargebackRequest extends IncomingMessage {
  rawBody?: Buffer
}

/**
 * Provider chargeback receiver (T-04.2.04.02).
 *
 * POST /api/wallet/top-ups/chargeback is the HMAC-authenticated
 * server-to-server path. Query params and unsigned bodies are never
 * proof of a chargeback; the handler verifies the signature, maps the
 * payload to the original Completed top-up, and reverseTransaction
 * posts the compensating ledger row when the original is unique.
 */
@ApiTags('Wallet')
@Controller('api/wallet/top-ups')
export class ChargebackDetectionController {
  constructor(private readonly chargebackService: ChargebackDetectionService) {}

  @Post('chargeback')
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ namespace: 'wallet:top-up:chargeback', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Authenticated payment-provider chargeback for an online wallet top-up',
  })
  @ApiResponse({ status: 200, description: 'Chargeback accepted (reversed, unmatched, or duplicate).' })
  @ApiResponse({ status: 401, description: 'Invalid signature, replay window, or merchant context' })
  @ApiResponse({ status: 503, description: 'Callback signing secret is not configured' })
  async receive(@Req() req: ChargebackRequest) {
    const headers = {
      eventId: headerValue(req.headers['x-barghsa-event-id']),
      timestamp: headerValue(req.headers['x-barghsa-timestamp']),
      signature: headerValue(req.headers['x-barghsa-signature']),
    }
    const rawBody = req.rawBody?.toString('utf8') ?? ''
    return this.chargebackService.handle({ headers, rawBody })
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

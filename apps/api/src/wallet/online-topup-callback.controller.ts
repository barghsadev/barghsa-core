import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { IncomingMessage } from 'node:http'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import { SkipCsrf } from '../session/csrf.guard.js'
import { OnlineTopUpCallbackService } from './online-topup-callback.service.js'

interface CallbackRequest extends IncomingMessage {
  rawBody?: Buffer
}

/**
 * Provider callback receiver (T-04.2.02.02).
 *
 * POST /api/wallet/top-ups/callback is the authenticated server-to-server
 * path. GET on the same path is the browser return URL and never credits
 * the wallet.
 */
@ApiTags('Wallet')
@Controller('api/wallet/top-ups')
export class OnlineTopUpCallbackController {
  constructor(private readonly callbackService: OnlineTopUpCallbackService) {}

  @Get('callback')
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Browser return from the payment gateway (not proof of payment)' })
  @ApiResponse({ status: 200, description: 'Acknowledged; wallet is not credited from a redirect.' })
  browserReturn(): { ok: true; credited: false; reason: 'browser_redirect_ignored' } {
    return { ok: true, credited: false, reason: 'browser_redirect_ignored' }
  }

  @Post('callback')
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ namespace: 'wallet:top-up:callback', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Authenticated payment-provider callback for an online wallet top-up' })
  @ApiResponse({ status: 200, description: 'Callback accepted (credited or duplicate/unpaid).' })
  @ApiResponse({ status: 401, description: 'Invalid signature, replay window, or merchant context' })
  @ApiResponse({ status: 503, description: 'Callback signing secret is not configured' })
  async receive(@Req() req: CallbackRequest) {
    const headers = {
      eventId: headerValue(req.headers['x-barghsa-event-id']),
      timestamp: headerValue(req.headers['x-barghsa-timestamp']),
      signature: headerValue(req.headers['x-barghsa-signature']),
    }
    const rawBody = req.rawBody?.toString('utf8') ?? ''
    return this.callbackService.handle({ headers, rawBody })
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

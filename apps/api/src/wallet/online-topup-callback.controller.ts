import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
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

export interface ZarinpalReturnQuery {
  orderId: string
  authority: string
  status: string
}

/**
 * Reads ZarinPal's browser-return query (`orderId` we appended, plus
 * `Authority` / `Status`). Matching is case-insensitive so Express
 * query-key casing cannot drop a real return.
 */
export function readZarinpalReturnQuery(
  query: Record<string, unknown>,
): ZarinpalReturnQuery | null {
  const orderId = firstQueryValue(query, 'orderId')
  const authority = firstQueryValue(query, 'Authority')
  const status = firstQueryValue(query, 'Status')
  if (!orderId || !authority || !status) return null
  return { orderId, authority, status }
}

function firstQueryValue(query: Record<string, unknown>, name: string): string {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(query)) {
    if (key.toLowerCase() !== wanted) continue
    if (typeof value === 'string') return value.trim()
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim()
  }
  return ''
}

/**
 * Provider callback receiver (T-04.2.02.02).
 *
 * POST /api/wallet/top-ups/callback is the HMAC-authenticated
 * server-to-server path (http adapter / signed webhooks).
 *
 * GET on the same path is the ZarinPal browser return URL
 * (`callback_url` with `orderId`, `Authority`, `Status`). Query params
 * are never proof of payment; the handler binds them to the Pending
 * top-up and credits only after `PaymentGateway.verifyPayment()`.
 */
@ApiTags('Wallet')
@Controller('api/wallet/top-ups')
export class OnlineTopUpCallbackController {
  constructor(private readonly callbackService: OnlineTopUpCallbackService) {}

  @Get('callback')
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ namespace: 'wallet:top-up:callback', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'ZarinPal browser return; credits only after server-side verify',
  })
  @ApiResponse({ status: 200, description: 'Return accepted (credited, unpaid, duplicate, or ignored).' })
  @ApiResponse({ status: 401, description: 'orderId/Authority did not match a pending top-up' })
  async browserReturn(@Query() query: Record<string, unknown>) {
    const zarinpal = readZarinpalReturnQuery(query)
    if (!zarinpal) {
      return { ok: true, credited: false, reason: 'browser_redirect_ignored' as const }
    }
    return this.callbackService.handleZarinpalReturn(zarinpal)
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

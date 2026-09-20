import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SkipCsrf } from '../session/csrf.guard.js';
import { OnlineTopUpCallbackService } from './online-topup-callback.service.js';

interface CallbackRequest extends IncomingMessage {
  rawBody?: Buffer;
}

export interface ZarinpalReturnQuery {
  orderId: string;
  authority: string;
  status: string;
}

/**
 * Reads ZarinPal's browser-return query (`orderId` we appended, plus
 * `Authority` / `Status`). Matching is case-insensitive so Express
 * query-key casing cannot drop a real return.
 */
export function readZarinpalReturnQuery(
  query: Record<string, unknown>
): ZarinpalReturnQuery | null {
  const orderId = firstQueryValue(query, 'orderId');
  const authority = firstQueryValue(query, 'Authority');
  const status = firstQueryValue(query, 'Status');
  if (!orderId || !authority || !status) return null;
  return { orderId, authority, status };
}

function firstQueryValue(query: Record<string, unknown>, name: string): string {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(query)) {
    if (key.toLowerCase() !== wanted) continue;
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  }
  return '';
}

/**
 * Provider callback receiver (T-04.2.02.02).
 *
 * POST /api/wallet/top-ups/callback is the HMAC-authenticated
 * server-to-server path (http adapter / signed webhooks).
 *
 * GET on the same path is the ZarinPal browser return URL
 * (`callback_url` with `orderId`, `Authority`, `Status`). Query params
 * are never proof of payment. GET only redirects to the wallet; an explicit
 * session/CSRF-protected POST binds current profile access and verifies payment.
 */
@ApiTags('Wallet')
@Controller('api/wallet/top-ups')
export class OnlineTopUpCallbackController {
  constructor(private readonly callbackService: OnlineTopUpCallbackService) {}

  @Get('callback')
  @Redirect(undefined, HttpStatus.SEE_OTHER)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @RateLimit({ namespace: 'wallet:top-up:callback', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Read-only payment return to the wallet confirmation screen' })
  @ApiResponse({ status: 303, description: 'Redirect to wallet; no payment state changes.' })
  browserReturn(@Query() query: Record<string, unknown>) {
    const raw =
      process.env.APP_PUBLIC_URL?.trim() ||
      (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
    const origin = new URL(raw);
    if (
      origin.username ||
      origin.password ||
      (origin.protocol !== 'https:' &&
        !(process.env.NODE_ENV !== 'production' && origin.protocol === 'http:'))
    ) {
      throw new Error('APP_PUBLIC_URL must be a trusted application origin');
    }
    const url = new URL('/wallet', origin.origin);
    const returned = readZarinpalReturnQuery(query);
    if (
      returned &&
      z.string().uuid().safeParse(returned.orderId).success &&
      returned.authority.length <= 512
    ) {
      url.searchParams.set('paymentOrderId', returned.orderId);
      url.searchParams.set('paymentAuthority', returned.authority);
    }
    return { url: url.href };
  }

  @Post('return')
  @UseGuards(SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @RateLimit({ namespace: 'wallet:top-up:return', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Check a returned payment using the current session and CSRF token' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['orderId', 'authority'],
      additionalProperties: false,
      properties: {
        orderId: { type: 'string', format: 'uuid' },
        authority: { type: 'string', minLength: 1, maxLength: 512 },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Server-verified payment result.' })
  @ApiResponse({ status: 401, description: 'Authentication or payment context invalid.' })
  @ApiResponse({ status: 403, description: 'Invalid CSRF token.' })
  async confirmReturn(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = z
      .object({ orderId: z.string().uuid(), authority: z.string().trim().min(1).max(512) })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code });
    // The browser's Status field is not payment evidence. Always ask the provider.
    return this.callbackService.handleZarinpalReturn({ ...parsed.data, status: 'OK' }, req.session);
  }

  @Post('callback')
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ namespace: 'wallet:top-up:callback', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Authenticated payment-provider callback for an online wallet top-up' })
  @ApiResponse({ status: 200, description: 'Callback accepted (credited or duplicate/unpaid).' })
  @ApiResponse({
    status: 401,
    description: 'Invalid signature, replay window, or merchant context',
  })
  @ApiResponse({ status: 503, description: 'Callback signing secret is not configured' })
  async receive(@Req() req: CallbackRequest) {
    const headers = {
      eventId: headerValue(req.headers['x-barghsa-event-id']),
      timestamp: headerValue(req.headers['x-barghsa-timestamp']),
      signature: headerValue(req.headers['x-barghsa-signature']),
    };
    const rawBody = req.rawBody?.toString('utf8') ?? '';
    return this.callbackService.handle({ headers, rawBody });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

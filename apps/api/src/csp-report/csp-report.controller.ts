import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SkipCsrf } from '../session/csrf.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

const directive = z.enum([
  'default-src',
  'script-src',
  'script-src-elem',
  'script-src-attr',
  'style-src',
  'style-src-elem',
  'style-src-attr',
  'img-src',
  'font-src',
  'connect-src',
  'media-src',
  'object-src',
  'frame-src',
  'child-src',
  'worker-src',
  'frame-ancestors',
  'base-uri',
  'form-action',
  'manifest-src',
  'navigate-to',
  'sandbox',
  'trusted-types',
  'require-trusted-types-for',
  'upgrade-insecure-requests',
  'block-all-mixed-content',
]);
const detailSchema = z
  .object({
    'blocked-uri': z.string().max(2048).optional(),
    disposition: z.enum(['enforce', 'report']).optional(),
    'document-uri': z.string().max(2048).optional(),
    'effective-directive': directive.optional(),
    'violated-directive': z.string().max(2048).optional(),
    'original-policy': z.string().max(8192).optional(),
    referrer: z.string().max(2048).optional(),
    'script-sample': z.string().max(2048).optional(),
    'source-file': z.string().max(2048).optional(),
    'line-number': z.number().int().min(0).max(2147483647).optional(),
    'column-number': z.number().int().min(0).max(2147483647).optional(),
  })
  .refine((value) => Boolean(value['effective-directive'] || value['violated-directive']));
const reportSchema = z.object({ 'csp-report': detailSchema });

/** Keep credentials, route names, queries, fragments and inline script contents out of logs. */
function safeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (['inline', 'eval', 'self', 'none', 'data', 'blob'].includes(value)) return value;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

@Controller('api/csp-report')
export class CspReportController {
  private readonly logger = new Logger(CspReportController.name);

  /** Owner-approved native telemetry exception; never changes business state. */
  @Post()
  @SkipCsrf()
  @RateLimit({ namespace: 'csp:report', limit: 60, windowMs: 60_000, security: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  report(@Body() body: unknown, @Req() request: Request): void {
    const trusted = process.env.APP_PUBLIC_URL;
    let origin: string | undefined;
    try {
      const url = trusted ? new URL(trusted) : null;
      if (
        url &&
        !url.username &&
        !url.password &&
        (url.protocol === 'https:' ||
          (process.env.NODE_ENV !== 'production' && url.protocol === 'http:'))
      )
        origin = url.origin;
    } catch {
      // Missing or invalid public topology must fail closed.
    }
    const supplied = request.headers.origin;
    const site = request.headers['sec-fetch-site'];
    let referrerOrigin: string | undefined;
    try {
      referrerOrigin = request.headers.referer
        ? new URL(request.headers.referer).origin
        : undefined;
    } catch {
      // Malformed referrers are not origin evidence.
    }
    if (
      !origin ||
      (supplied !== origin &&
        !(
          (supplied === undefined || supplied === 'null') &&
          site === 'same-origin' &&
          (referrerOrigin === origin || request.headers['sec-fetch-mode'] === 'no-cors')
        )) ||
      (site !== undefined && site !== 'same-origin') ||
      !/^application\/csp-report(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
    ) {
      throw new ForbiddenException({ error: ErrorCodes.AUTHZ_CSRF_INVALID.code });
    }
    const parsed = reportSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const report = parsed.data['csp-report'];
    this.logger.warn({
      msg: 'CSP violation',
      correlationId: correlationIdStorage.getStore(),
      'blocked-uri': safeOrigin(report['blocked-uri']),
      disposition: report.disposition,
      'document-uri': safeOrigin(report['document-uri']),
      'effective-directive':
        report['effective-directive'] ??
        directive.safeParse(report['violated-directive']?.split(' ')[0]).data,
      'source-file': safeOrigin(report['source-file']),
      'line-number': report['line-number'],
      'column-number': report['column-number'],
    });
  }
}

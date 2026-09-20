import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
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

  /** Report-only diagnostics. Global session CSRF protection still applies. */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  report(@Body() body: unknown): void {
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

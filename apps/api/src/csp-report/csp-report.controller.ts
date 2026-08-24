import { Controller, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import type { CspReportDetail, CspReportPayload } from './csp-report.types.js';

@Controller('api/csp-report')
export class CspReportController {
  private readonly logger = new Logger(CspReportController.name);

  /**
   * Receive Content Security Policy violation reports from the browser.
   *
   * Runs in Report-Only mode — violations are logged for monitoring but never
   * block the page. Once all known violations are resolved, the policy can be
   * switched to enforce mode by changing `Content-Security-Policy-Report-Only`
   * to `Content-Security-Policy` in the reverse proxy.
   *
   * Excluded from rate limiting and authentication.
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  report(@Body() body: CspReportPayload): void {
    const report: CspReportDetail = body?.['csp-report'] ?? (body as CspReportDetail);
    this.logger.warn({
      msg: 'CSP violation',
      'blocked-uri': report['blocked-uri'],
      disposition: report.disposition,
      'document-uri': report['document-uri'],
      'effective-directive': report['effective-directive'],
      'original-policy': report['original-policy']?.slice(0, 120),
      referrer: report.referrer,
      'script-sample': report['script-sample']?.slice(0, 200),
      'source-file': report['source-file'],
      'line-number': report['line-number'],
      'column-number': report['column-number'],
      'violated-directive': report['violated-directive'],
    });
  }
}
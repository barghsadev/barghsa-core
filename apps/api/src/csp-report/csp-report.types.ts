/**
 * Single CSP violation report from the browser.
 *
 * Matches the CSP Level 2 `csp-report` object structure that browsers POST
 * to the `report-uri` endpoint. The outer key is `csp-report` in the JSON body.
 */
export interface CspReportDetail {
  'blocked-uri'?: string;
  disposition?: 'enforce' | 'report';
  'document-uri'?: string;
  'effective-directive'?: string;
  'original-policy'?: string;
  referrer?: string;
  'script-sample'?: string;
  'source-file'?: string;
  'line-number'?: number;
  'column-number'?: number;
  'violated-directive'?: string;
}

export interface CspReportPayload {
  'csp-report'?: CspReportDetail;
  [key: string]: unknown;
}
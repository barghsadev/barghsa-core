import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { OperatingContext } from './session.service.js';

/** Routes that act on staff authority or on an active customer profile. */
const staffRoute = /^\/api\/(?:admin|staff|crm)(?:\/|$)|^\/api\/v1\/admin(?:\/|$)/;
const customerRoute =
  /^\/api\/(?:dashboard|tickets|consultations|solar|invoices|contracts|documents|user|wallet|saving|electricity|profiles|onboarding|invitations|orders|gift-codes)(?:\/|$)/;
const customerAiRoute = /^\/api\/ai\/knowledge(?:\/|$)/;

export function requireRouteOperatingContext(path: string, context: OperatingContext): void {
  // Self-owned display preferences and conversation identity are shared by both contexts.
  // Other /api/user routes retain their customer-profile boundary.
  if (/^\/api\/user\/settings\/(?:conversation-identity|timezone|theme)\/?$/.test(path)) return;
  if (
    (staffRoute.test(path) && context !== 'staff') ||
    ((customerRoute.test(path) || customerAiRoute.test(path)) && context !== 'customer')
  )
    throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
}

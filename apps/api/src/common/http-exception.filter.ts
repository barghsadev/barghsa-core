import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { DomainErrorCodes } from '@barghsa/shared/errors/domain';
import { ErrorCodes, defaultErrorCode, errorCodeForHttpStatus } from '@barghsa/shared/errors';
import type { ErrorCodeDef } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n';
import { t as crmMessage } from '@barghsa/i18n/crm';
import { readOnlineTopUpLimitFromErrorBody } from '@barghsa/shared/finance';
import { correlationIdStorage } from './correlation-id.middleware.js';

/**
 * Look up the ErrorCodeDef for a given error code string, or fall back to the
 * definition for the given HTTP status.
 */
const publicErrorDefinitions = new Map(
  [...Object.values(ErrorCodes), ...Object.values(DomainErrorCodes)].map((definition) => [
    definition.code,
    definition,
  ])
);
function resolveErrorCodeDef(errorCode: string, httpStatus: number): ErrorCodeDef {
  return publicErrorDefinitions.get(errorCode) ?? errorCodeForHttpStatus(httpStatus);
}

/**
 * Global exception filter that catches all unhandled exceptions and maps them to
 * a stable, machine-readable error response shape.
 *
 * Response shape:  { error: { code, message, correlationId } }
 *
 * Over-limit online top-up 400s also include `onlineTopUpLimit` and
 * `configVersion` on `error` so the customer form can retry with a reduced
 * amount against the ceiling that was actually enforced.
 *
 * Never exposes stack traces, raw database errors, or internal provider details.
 * Messages always come from the localized catalogue, including client errors.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Determine HTTP status and error code
    const { httpStatus, errorCode } = this.resolveError(exception);

    // Resolve localized message
    const locale = this.resolveLocale(request);
    const errorCodeDef = resolveErrorCodeDef(errorCode, httpStatus);
    const message = t(errorCodeDef.messageKey, locale);

    // Get correlation ID from AsyncLocalStorage
    const correlationId = correlationIdStorage.getStore() ?? uuidv7();
    // Guards and body-parser failures can bypass response interceptors and
    // request middleware. Error responses still require private caching and
    // an identifier shared by the response header, body and log record.
    response.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    response.setHeader('X-Correlation-ID', correlationId);

    // Log at appropriate severity
    this.logError(httpStatus, errorCode, correlationId, request);

    // Send the safe response — never expose stack traces or internals
    const body: Record<string, unknown> = {
      error: {
        code: errorCode,
        message,
        correlationId,
      },
    };

    if (
      httpStatus === HttpStatus.FORBIDDEN &&
      errorCode === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
    ) {
      body.requiresStepUp = true;
    }

    if (exception instanceof HttpException) {
      const snapshot = readOnlineTopUpLimitFromErrorBody(exception.getResponse());
      if (snapshot) {
        const error = body.error as Record<string, unknown>;
        error.onlineTopUpLimit = snapshot.onlineTopUpLimit;
        error.configVersion = snapshot.configVersion;
      }
    }

    if (errorCode === ErrorCodes.MAINTENANCE_ACTIVE.code && exception instanceof HttpException) {
      const details = exception.getResponse();
      if (typeof details === 'object' && details !== null) {
        const payload = details as Record<string, unknown>;
        const allowed = new Set([
          'electricity_checkout',
          'saving_orders',
          'solar_requests',
          'wallet_topup',
          'ai_chat',
        ]);
        if (typeof payload.capability === 'string' && allowed.has(payload.capability)) {
          const error = body.error as Record<string, unknown>;
          error.capability = payload.capability;
          error.supportUrl = '/tickets';
          const reason = payload.reason;
          if (
            reason &&
            typeof reason === 'object' &&
            'fa' in reason &&
            'en' in reason &&
            typeof reason.fa === 'string' &&
            typeof reason.en === 'string'
          )
            error.reason = reason[locale];
          if (typeof payload.estimatedUntil === 'string')
            error.estimatedUntil = payload.estimatedUntil;
        }
      }
    }

    if (httpStatus === 409 && exception instanceof HttpException) {
      const details = exception.getResponse();
      if (errorCode === 'AI_MODEL_IN_USE' && typeof details === 'object' && details !== null) {
        const agents = 'agents' in details ? details.agents : null;
        if (
          Array.isArray(agents) &&
          agents.length <= 10 &&
          agents.every(
            (agent) =>
              agent &&
              typeof agent.id === 'string' &&
              /^[0-9a-f-]{36}$/i.test(agent.id) &&
              typeof agent.title === 'string' &&
              agent.title.length <= 120
          )
        )
          (body.error as Record<string, unknown>).agents = agents;
      }
      if (typeof details === 'object' && details !== null && 'blocker' in details) {
        const blocker = details.blocker;
        const allowed =
          errorCode === 'CRM:PROFILE:DELETION_BLOCKED'
            ? ['orders', 'contracts', 'invoices', 'wallet', 'pendingPayments', 'corrections']
            : errorCode === 'CRM:PROFILE:LAST_OWNER'
              ? ['lastOwner']
              : [];
        const count = 'count' in details ? details.count : undefined;
        const counted = ['orders', 'contracts', 'invoices'].includes(String(blocker));
        if (
          typeof blocker === 'string' &&
          allowed.includes(blocker) &&
          (!counted || (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0))
        ) {
          const error = body.error as Record<string, unknown>;
          error.message = crmMessage(`crm.profile.archive.blocked.${blocker}`, locale).replace(
            '{count}',
            new Intl.NumberFormat(locale).format(typeof count === 'number' ? count : 0)
          );
        }
      }
    }

    if (httpStatus === 429 && exception instanceof HttpException) {
      const details = exception.getResponse();
      const error = body.error as Record<string, unknown>;
      if (
        typeof details === 'object' &&
        details !== null &&
        'retryAfterMs' in details &&
        typeof details.retryAfterMs === 'number' &&
        Number.isFinite(details.retryAfterMs) &&
        details.retryAfterMs >= 0
      ) {
        const seconds = Math.max(1, Math.ceil(details.retryAfterMs / 1000));
        response.setHeader('Retry-After', String(seconds));
        error.retryAfterMs = seconds * 1000;
        error.retryAfterSeconds = seconds;
        error.message = t('error.rate_limit.retry_after', locale).replace(
          '{seconds}',
          new Intl.NumberFormat(locale, { useGrouping: false }).format(seconds)
        );
      }
    }

    response.status(httpStatus).json(body);
  }

  /** Resolve HTTP status and a registered public code from the exception. */
  private resolveError(exception: unknown): {
    httpStatus: number;
    errorCode: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const responseBody = exception.getResponse();

      const candidate =
        typeof responseBody === 'object' && responseBody !== null
          ? (responseBody as Record<string, unknown>).error
          : undefined;
      const publicCode = typeof candidate === 'string' && publicErrorDefinitions.has(candidate);
      return { httpStatus: status, errorCode: publicCode ? candidate : defaultErrorCode(status) };
    }

    if (
      exception instanceof Error &&
      'type' in exception &&
      exception.type === 'entity.too.large' &&
      'status' in exception &&
      exception.status === 413
    ) {
      return { httpStatus: 413, errorCode: defaultErrorCode(413) };
    }

    // Zod validation errors — return 400
    if (exception instanceof ZodError) {
      return {
        httpStatus: HttpStatus.BAD_REQUEST,
        errorCode: ErrorCodes.VALIDATION_PARSE_ZOD.code,
      };
    }

    // Everything else — internal server error
    return {
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: ErrorCodes.INTERNAL_UNEXPECTED.code,
    };
  }

  /** Extract the user's preferred locale from the request */
  private resolveLocale(request: Request): 'fa' | 'en' {
    const acceptLanguage = request.headers['accept-language'];
    if (acceptLanguage?.toLowerCase().startsWith('fa')) {
      return 'fa';
    }
    return 'en';
  }

  /** Log the error with appropriate severity */
  private logError(
    httpStatus: number,
    errorCode: string,
    correlationId: string | undefined,
    request: Request
  ): void {
    // URLs and exception stacks can include passwords, reset tokens or session IDs.
    const route = typeof request.route?.path === 'string' ? request.route.path : 'unmatched';
    if (httpStatus < 500 || errorCode === ErrorCodes.MAINTENANCE_ACTIVE.code) {
      // 4xx — debug level (client errors, not actionable)
      this.logger.debug(
        `Client error: ${errorCode} — ${httpStatus} ${request.method} ${route} | correlationId=${correlationId ?? 'none'} | ip=${request.ip}`
      );
    } else {
      // 5xx — error level (actionable)
      this.logger.error(
        `Server error: ${errorCode} — ${httpStatus} ${request.method} ${route} | correlationId=${correlationId ?? 'none'} | ip=${request.ip}`
      );
    }
  }
}

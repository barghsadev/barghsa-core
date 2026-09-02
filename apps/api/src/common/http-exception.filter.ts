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
import { ErrorCodes, defaultErrorCode, errorCodeForHttpStatus } from '@barghsa/shared/errors';
import type { ErrorCodeDef } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n';
import { readOnlineTopUpLimitFromErrorBody } from '@barghsa/shared/finance';
import { correlationIdStorage } from './correlation-id.middleware.js';

/**
 * Look up the ErrorCodeDef for a given error code string, or fall back to the
 * definition for the given HTTP status.
 */
function resolveErrorCodeDef(errorCode: string, httpStatus: number): ErrorCodeDef {
  const matched = Object.values(ErrorCodes).find((def) => def.code === errorCode);
  return matched ?? errorCodeForHttpStatus(httpStatus);
}

/**
 * Global exception filter that catches all unhandled exceptions and maps them to
 * a stable, machine-readable error response shape.
 *
 * Response shape:  { error: { code, message, correlationId? } }
 *
 * Over-limit online top-up 400s also include `onlineTopUpLimit` and
 * `configVersion` on `error` so the customer form can retry with a reduced
 * amount against the ceiling that was actually enforced.
 *
 * Never exposes stack traces, raw database errors, or internal provider details.
 * 5xx errors always use localized messages from the error code key — never
 * forward raw exception messages to clients.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Determine HTTP status and error code
    const { httpStatus, errorCode, rawMessage } = this.resolveError(exception);

    // Resolve localized message
    const locale = this.resolveLocale(request);
    const errorCodeDef = resolveErrorCodeDef(errorCode, httpStatus);
    // For 5xx errors, always use the localized error-code message (never leak internals)
    // For 4xx errors, use rawMessage if available, otherwise localized message
    const message =
      httpStatus < 500
        ? rawMessage ?? t(errorCodeDef.messageKey, locale)
        : t(errorCodeDef.messageKey, locale);

    // Get correlation ID from AsyncLocalStorage
    const correlationId = correlationIdStorage.getStore();

    // Log at appropriate severity
    this.logError(exception, httpStatus, errorCode, correlationId, request);

    // Send the safe response — never expose stack traces or internals
    const body: Record<string, unknown> = {
      error: {
        code: errorCode,
        message,
      },
    };

    if (correlationId) {
      (body.error as Record<string, unknown>).correlationId = correlationId;
    }

    if (exception instanceof HttpException) {
      const snapshot = readOnlineTopUpLimitFromErrorBody(exception.getResponse());
      if (snapshot) {
        const error = body.error as Record<string, unknown>;
        error.onlineTopUpLimit = snapshot.onlineTopUpLimit;
        error.configVersion = snapshot.configVersion;
      }
    }

    response.status(httpStatus).json(body);
  }

  /** Resolve HTTP status, error code, and optional raw message from the exception */
  private resolveError(exception: unknown): {
    httpStatus: number;
    errorCode: string;
    rawMessage: string | undefined;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const responseBody = exception.getResponse();

      // Extract the raw message and error code from the exception response
      let rawMessage: string | undefined;
      let customErrorCode: string | undefined;
      if (typeof responseBody === 'string') {
        rawMessage = responseBody;
      } else if (typeof responseBody === 'object' && responseBody !== null) {
        const body = responseBody as Record<string, unknown>;
        if (typeof body.message === 'string') {
          rawMessage = body.message;
        } else if (Array.isArray(body.message)) {
          rawMessage = (body.message as string[]).join('; ');
        }
        // Extract a custom error code from the body if present
        if (typeof body.error === 'string') {
          customErrorCode = body.error;
        }
      }

      return {
        httpStatus: status,
        errorCode: customErrorCode ?? defaultErrorCode(status),
        rawMessage,
      };
    }

    // Zod validation errors — return 400
    if (exception instanceof ZodError) {
      return {
        httpStatus: HttpStatus.BAD_REQUEST,
        errorCode: ErrorCodes.VALIDATION_PARSE_ZOD.code,
        rawMessage: undefined,
      };
    }

    // Everything else — internal server error
    return {
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: ErrorCodes.INTERNAL_UNEXPECTED.code,
      rawMessage: undefined,
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
    exception: unknown,
    httpStatus: number,
    errorCode: string,
    correlationId: string | undefined,
    request: Request,
  ): void {
    if (httpStatus < 500) {
      // 4xx — debug level (client errors, not actionable)
      this.logger.debug(
        `Client error: ${errorCode} — ${httpStatus} ${request.method} ${request.url} | correlationId=${correlationId ?? 'none'} | ip=${request.ip}`,
      );
    } else {
      // 5xx — error level (actionable)
      this.logger.error(
        `Server error: ${errorCode} — ${httpStatus} ${request.method} ${request.url} | correlationId=${correlationId ?? 'none'} | ip=${request.ip}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }
  }
}
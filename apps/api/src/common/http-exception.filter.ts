import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCodes, defaultErrorCode } from '@barghsa/shared/errors';
import { t } from '@barghsa/i18n';
import { correlationIdStorage } from './correlation-id.middleware.js';

/**
 * Global exception filter that catches all unhandled exceptions and maps them to
 * a stable, machine-readable error response shape.
 *
 * Response shape:  { error: { code, message, correlationId? } }
 *
 * Never exposes stack traces, raw database errors, or internal provider details.
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

    // Resolve localized message — fall back to raw message, then error code's default
    const locale = this.resolveLocale(request);
    const message = rawMessage ?? t(errorCode, locale);

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

      // Extract the raw message from the exception response if it's a string
      let rawMessage: string | undefined;
      if (typeof responseBody === 'string') {
        rawMessage = responseBody;
      } else if (typeof responseBody === 'object' && responseBody !== null) {
        const body = responseBody as Record<string, unknown>;
        if (typeof body.message === 'string') {
          rawMessage = body.message;
        } else if (Array.isArray(body.message)) {
          rawMessage = (body.message as string[]).join('; ');
        }
      }

      return {
        httpStatus: status,
        errorCode: defaultErrorCode(status),
        rawMessage,
      };
    }

    // Zod validation errors from `zod` — return 400
    if (
      exception !== null &&
      typeof exception === 'object' &&
      'name' in exception &&
      (exception as Record<string, unknown>).name === 'ZodError'
    ) {
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
    if (acceptLanguage?.startsWith('fa') || acceptLanguage?.startsWith('fa-IR')) {
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
    const metadata = {
      correlationId,
      errorCode,
      method: request.method,
      path: request.url,
      ip: request.ip,
    };

    if (httpStatus < 500) {
      // 4xx — debug level (client errors, not actionable)
      this.logger.debug(
        `Client error: ${errorCode} — ${httpStatus} ${request.method} ${request.url}`,
        metadata,
      );
    } else {
      // 5xx — error level (actionable)
      this.logger.error(
        `Server error: ${errorCode} — ${httpStatus} ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : exception,
        metadata,
      );
    }
  }
}
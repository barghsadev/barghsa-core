import type { LoggerService } from '@nestjs/common';
import { createOperatorLogger } from '@barghsa/shared/operator-logging';

const diagnosticFields = [
  'event',
  'actorRef',
  'resource',
  'action',
  'reason',
  'correlationId',
  'createdAt',
  'blocked-uri',
  'disposition',
  'document-uri',
  'effective-directive',
  'source-file',
  'line-number',
  'column-number',
] as const;

export class CorrelationLogger implements LoggerService {
  constructor(private readonly write = createOperatorLogger('api')) {}

  private emit(level: Parameters<typeof this.write>[0], message: unknown, params: unknown[]) {
    const context = params.at(-1);
    const fields: Record<string, unknown> = {};
    if (typeof context === 'string' && /^[\w.-]{1,80}$/.test(context)) fields.context = context;

    if (typeof message === 'string') {
      this.write(level, message, fields);
      return;
    }

    if (message && typeof message === 'object') {
      const event = message as Record<string, unknown>;
      if (
        event.event === 'authorization.denial.persistence_failed' ||
        event.msg === 'CSP violation'
      ) {
        for (const key of diagnosticFields) {
          const value = event[key];
          if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
            fields[key] = value;
          }
        }
        this.write(level, event.msg === 'CSP violation' ? event.msg : String(event.event), fields);
        return;
      }
    }

    this.write(level, 'Unstructured API diagnostic', fields);
  }

  log(message: unknown, ...params: unknown[]): void {
    this.emit('info', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }
  fatal(message: unknown, ...params: unknown[]): void {
    this.emit('fatal', message, params);
  }
}

import { ConsoleLogger } from '@nestjs/common';
import { correlationIdStorage } from './correlation-id.middleware.js';

export class CorrelationLogger extends ConsoleLogger {
  private withCorrelation(message: unknown): unknown {
    const correlationId = correlationIdStorage.getStore();
    return correlationId ? { message, correlationId } : message;
  }
  override log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(this.withCorrelation(message), ...optionalParams);
  }
  override warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(this.withCorrelation(message), ...optionalParams);
  }
  override error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(this.withCorrelation(message), ...optionalParams);
  }
  override debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(this.withCorrelation(message), ...optionalParams);
  }
  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(this.withCorrelation(message), ...optionalParams);
  }
  override fatal(message: unknown, ...optionalParams: unknown[]): void {
    super.fatal(this.withCorrelation(message), ...optionalParams);
  }
}

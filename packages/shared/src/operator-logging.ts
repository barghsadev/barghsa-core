import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { pino, type DestinationStream } from 'pino';

export const operatorLogCorrelation = new AsyncLocalStorage<string>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && UUID.test(value);
}

export function deploymentEnvironment() {
  const configured = process.env.BARGHSA_DEPLOYMENT_ENV ?? process.env.NODE_ENV;
  if (configured === 'staging' || configured === 'development' || configured === 'test') {
    return configured;
  }
  return configured === undefined ? 'development' : 'production';
}

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type Attributes = Record<string, unknown>;

/** Accept only the privacy-minimized fields and messages selected by the producer. */
export function createOperatorLogger(
  service: 'api' | 'worker' | 'ai-inference' | 'database',
  destination: DestinationStream = pino.multistream(
    [
      { level: 'debug', stream: { write: (line: string) => process.stdout.write(line) } },
      { level: 'error', stream: { write: (line: string) => process.stderr.write(line) } },
    ],
    { dedupe: true }
  )
) {
  const environment = deploymentEnvironment();
  const logger = pino(
    {
      base: { service, environment },
      level:
        environment === 'production' ? 'warn' : environment === 'development' ? 'debug' : 'info',
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      messageKey: 'message',
      formatters: { level: (level) => ({ level }) },
    },
    destination
  );

  return (level: Level, message: string, attributes: Attributes = {}) => {
    if (!logger.isLevelEnabled(level)) return;
    const { correlationId, ...fields } = attributes;
    logger[level](
      {
        ...fields,
        correlationId: isCorrelationId(correlationId)
          ? correlationId
          : (operatorLogCorrelation.getStore() ?? randomUUID()),
      },
      message
    );
  };
}

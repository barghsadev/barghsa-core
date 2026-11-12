import { createOperatorLogger } from '@barghsa/shared/operator-logging';

export const workerLog = createOperatorLogger('worker');

export function createWorkerLogger(job?: string) {
  const fields = job ? { job } : undefined;
  return {
    info: (message: string) => workerLog('info', message, fields),
    warn: (message: string) => workerLog('warn', message, fields),
    error: (message: string) => workerLog('error', message, fields),
  };
}

export const workerLogger = createWorkerLogger();

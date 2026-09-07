import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';

let activeParsers = 0;
const MAX_PARSERS = 2;
const PARSER_TIMEOUT_MS = 3000;

/** Bound parser concurrency and lifetime without blocking the API event loop. */
export async function detectDocumentContentType(
  bytes: Uint8Array,
  format: 'office' | 'csv' = 'office'
): Promise<string | null> {
  if (activeParsers >= MAX_PARSERS)
    throw new ServiceUnavailableException('Document inspection is busy; retry shortly');
  activeParsers++;
  let worker: Worker;
  try {
    worker = new Worker(resolve(__dirname, 'document-parser.cjs'), {
      workerData: { bytes, format },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 },
    });
  } catch (error) {
    activeParsers--;
    throw new ServiceUnavailableException('Document inspection is unavailable', { cause: error });
  }
  return new Promise((resolveResult, reject) => {
    let settled = false;
    const finish = async (mime: string | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await worker.terminate();
      } catch (terminationError) {
        error ??= new ServiceUnavailableException('Document inspection cleanup failed', {
          cause: terminationError,
        });
      } finally {
        activeParsers--;
        if (error) reject(error);
        else resolveResult(mime);
      }
    };
    const unavailable = () => new ServiceUnavailableException('Document inspection is unavailable');
    const timer = setTimeout(() => void finish(null, unavailable()), PARSER_TIMEOUT_MS);
    worker.once('message', (mime: unknown) => {
      if (mime === null || typeof mime === 'string') void finish(mime);
      else void finish(null, unavailable());
    });
    worker.once('error', () => void finish(null, unavailable()));
    worker.once('exit', () => void finish(null, unavailable()));
  });
}

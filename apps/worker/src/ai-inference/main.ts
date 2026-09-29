import { closeDbPools, createDbPool } from '@barghsa/db';
import { createAiInferenceServer } from './server.js';

async function main(): Promise<void> {
  const secret = process.env.AI_INFERENCE_SHARED_SECRET ?? '';
  const port = Number(process.env.AI_INFERENCE_PORT ?? '9091');
  const maxConcurrency = Number(process.env.AI_INFERENCE_MAX_CONCURRENCY ?? '10');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid AI inference port');
  const server = createAiInferenceServer({
    pool: createDbPool(),
    secret,
    maxConcurrency,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, process.env.AI_INFERENCE_HOST ?? '127.0.0.1', resolve);
  });
  process.stdout.write(`AI inference server listening on port ${port}\n`);

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 30_000);
    void new Promise<void>((resolve) => server.close(() => resolve()))
      .then(() => closeDbPools())
      .then(() => {
        clearTimeout(deadline);
        process.exit(0);
      })
      .catch(() => process.exit(1));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main().catch((error: unknown) => {
  process.stderr.write(`AI inference process failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});

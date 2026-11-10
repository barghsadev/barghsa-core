import { createApplication } from './app.factory.js';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const port = process.env['PORT'] ?? 4000;
  await app.listen(port);
}

void bootstrap().catch(() => {
  console.error('Failed to start API server');
  process.exitCode = 1;
});

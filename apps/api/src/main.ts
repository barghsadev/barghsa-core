import { reportServerError } from '@barghsa/shared/error-reporting';
import { createApplication } from './app.factory.js';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const port = process.env['PORT'] ?? 4000;
  await app.listen(port);
}

void bootstrap().catch(async () => {
  console.error('Failed to start API server');
  process.exitCode = 1;
  await reportServerError('API_STARTUP_FAILED');
});

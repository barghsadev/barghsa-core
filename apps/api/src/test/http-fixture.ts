import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { runMigrations } from '../../../../packages/db/src/migrate';

/** Each fixture owns its database and a child running the compiled AppModule. */
export async function startHttpFixture(
  testDatabaseUrl: string,
  localStorageEndpoint?: string,
  trustedProxyAddresses = '',
  poolMax = 10,
  aiModelAllowedHosts = '',
  startAiModelWorker = false,
  telemetry?: { endpoint: string; intervalMs: number; timeoutMs: number }
) {
  const database = `test_http_${randomUUID().replaceAll('-', '')}`;
  const management = new Pool({ connectionString: testDatabaseUrl });
  let created = false;
  let child: ChildProcess | undefined;
  let aiWorker: ChildProcess | undefined;
  let pool: Pool | undefined;
  let output = '';

  async function close() {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((done) => {
        const timeout = setTimeout(() => child!.kill('SIGKILL'), 5000);
        child!.once('exit', () => {
          clearTimeout(timeout);
          done();
        });
        if (child!.connected) child!.send('stop');
        else child!.kill('SIGTERM');
      });
    }
    if (aiWorker && aiWorker.exitCode === null && aiWorker.signalCode === null) {
      await new Promise<void>((done) => {
        const timeout = setTimeout(() => aiWorker!.kill('SIGKILL'), 5000);
        aiWorker!.once('exit', () => {
          clearTimeout(timeout);
          done();
        });
        if (aiWorker!.connected) aiWorker!.send('stop');
        else aiWorker!.kill('SIGTERM');
      });
    }
    await pool?.end();
    try {
      // PostgreSQL waits for closing connections. FORCE can terminate a socket
      // whose Pool.end() has returned before its TCP close event is delivered.
      if (created) await management.query(`DROP DATABASE "${database}"`);
    } finally {
      await management.end();
    }
  }

  try {
    await management.query(`CREATE DATABASE "${database}"`);
    created = true;
    const url = new URL(testDatabaseUrl);
    url.pathname = `/${database}`;
    const migration = await runMigrations({ connection: { pgdirectUrl: url.toString() } });
    if (!migration.ok) throw new Error(`Production migration failed: ${JSON.stringify(migration)}`);
    pool = new Pool({ connectionString: url.toString(), max: poolMax });
    child = fork(resolve(__dirname, '../../scripts/http-test-server.cjs'), [], {
      silent: true,
      env: {
        ...process.env,
        ...(process.env.BARGHSA_HTTP_COVERAGE_DIR
          ? { NODE_V8_COVERAGE: process.env.BARGHSA_HTTP_COVERAGE_DIR }
          : {}),
        DATABASE_URL: url.toString(),
        PGDIRECT_URL: url.toString(),
        NODE_ENV: 'test',
        API_TRUSTED_PROXY_IPS: trustedProxyAddresses,
        APP_PUBLIC_URL: 'https://app.example.test',
        AUTH_DELIVERY_ENCRYPTION_KEY: 'http-fixture-delivery-key-only',
        STORAGE_CONFIG_ENCRYPTION_KEY: 'http-fixture-storage-key-only',
        AI_MODEL_ENCRYPTION_KEY: 'http-fixture-ai-key-only',
        AI_MODEL_BASE_URL_ALLOWLIST: aiModelAllowedHosts,
        AI_MODEL_TEST_WAIT_MS: startAiModelWorker ? '10000' : '1000',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: telemetry?.endpoint ?? '',
        OTEL_EXPORTER_OTLP_METRICS_HEADERS: '',
        OTEL_EXPORTER_OTLP_HEADERS: '',
        ...(telemetry
          ? {
              OTEL_METRIC_EXPORT_INTERVAL: String(telemetry.intervalMs),
              OTEL_METRIC_EXPORT_TIMEOUT: String(telemetry.timeoutMs),
            }
          : {}),
        REDIS_URL: '',
        REDIS_HOST: '',
        S3_BUCKET: localStorageEndpoint ? 'test-evidence' : '',
        S3_REGION: localStorageEndpoint ? 'us-east-1' : '',
        S3_PRIVATE_ENDPOINT: '',
        S3_PUBLIC_ENDPOINT: '',
        ...(localStorageEndpoint
          ? {
              S3_ENDPOINT: localStorageEndpoint,
              S3_FORCE_PATH_STYLE: 'true',
              S3_ACCESS_KEY_ID: 'test-only-key',
              S3_SECRET_ACCESS_KEY: 'test-only-secret',
            }
          : {}),
      },
    });
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (data) => {
        output = (output + String(data)).slice(-20000);
      });
    const base = await new Promise<string>((resolvePort, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`HTTP server startup timed out: ${output}`)),
        20000
      );
      child!.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child!.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`HTTP server exited ${code}: ${output}`));
      });
      child!.once('message', (message: { port: number }) => {
        clearTimeout(timeout);
        resolvePort(`http://127.0.0.1:${message.port}`);
      });
    });
    if (startAiModelWorker) {
      aiWorker = fork(resolve(__dirname, '../../../worker/scripts/ai-model-http-worker.cjs'), [], {
        silent: true,
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          PGDIRECT_URL: url.toString(),
          NODE_ENV: 'test',
          AI_MODEL_ENCRYPTION_KEY: 'http-fixture-ai-key-only',
          AI_MODEL_BASE_URL_ALLOWLIST: aiModelAllowedHosts,
        },
      });
      for (const stream of [aiWorker.stdout, aiWorker.stderr])
        stream?.on('data', (data) => {
          output = (output + String(data)).slice(-20000);
        });
      await new Promise<void>((done, reject) => {
        const timeout = setTimeout(() => reject(new Error('AI worker startup timed out')), 10000);
        aiWorker!.once('message', () => {
          clearTimeout(timeout);
          done();
        });
        aiWorker!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        aiWorker!.once('exit', () => {
          clearTimeout(timeout);
          reject(new Error('AI worker exited'));
        });
      });
    }
    return { base, pool, close, logs: () => output };
  } catch (error) {
    await close();
    throw error;
  }
}

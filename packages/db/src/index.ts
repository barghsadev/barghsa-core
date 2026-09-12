import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, Client, type PoolConfig } from 'pg';
import * as fs from 'node:fs';
import { X509Certificate } from 'node:crypto';

let pool: Pool | null = null;
let directPool: Pool | null = null;

export interface DbPoolConfig {
  databaseUrl?: string;
  pgbouncerUrl?: string;
  pgdirectUrl?: string;
  poolMin?: number;
  poolMax?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  statementTimeout?: string;
  lockTimeout?: string;
  idleTransactionTimeout?: string;
  queryTimeout?: number;
  /** Per-statement defaults. Explicit statementTimeout/queryTimeout keep uniform overrides. */
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  /** Enable TLS for the PostgreSQL connection. Overrides any sslmode in the URL. */
  ssl?: boolean | { rejectUnauthorized: boolean; ca?: string };
}

const DEFAULT_STATEMENT_TIMEOUT = '30s';
const DEFAULT_LOCK_TIMEOUT = '5s';
const DEFAULT_IDLE_TX_TIMEOUT = '60s';
const SLOW_QUERY_THRESHOLD_MS = 200;
const DEFAULT_QUERY_TIMEOUT = 30_000;
const DEFAULT_READ_TIMEOUT = 10_000;

type QueryTimeoutPolicy = number | { read: number; write: number };

/** Classify SQL commands conservatively. Unknown commands and write CTEs get the write budget. */
function isReadQuery(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  // Remove quoted content and comments before examining command words. Multi-
  // statement batches use the write budget; this is timeout selection, not authorization.
  const commands = text
    .replace(
      /'(?:''|[^'])*'|"(?:""|[^"])*"|\$([a-zA-Z_][a-zA-Z_0-9]*|)\$[\s\S]*?\$\1\$|--[^\n]*|\/\*[\s\S]*?\*\//g,
      ' '
    )
    .trim()
    .replace(/;\s*$/, '');
  return (
    /^(SELECT|SHOW|VALUES|TABLE|WITH)\b/i.test(commands) &&
    !/;|\b(INSERT|UPDATE|DELETE|MERGE|INTO|CALL|CREATE|ALTER|DROP|TRUNCATE|LOCK)\b/i.test(commands)
  );
}

function poolTimeoutPolicy(config: DbPoolConfig): QueryTimeoutPolicy {
  if (config.queryTimeout !== undefined || config.statementTimeout !== undefined)
    return config.queryTimeout ?? DEFAULT_QUERY_TIMEOUT;
  const policy = {
    read: config.readTimeoutMs ?? DEFAULT_READ_TIMEOUT,
    write: config.writeTimeoutMs ?? DEFAULT_QUERY_TIMEOUT,
  };
  if (
    Object.values(policy).some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 2147483647
    )
  )
    throw new Error('Database read/write timeouts must be positive integer milliseconds');
  return policy;
}

/**
 * Emit a structured (single-line JSON) log entry. Development keeps plain
 * logging; production writes structured JSON only.
 */
function structuredLog(
  level: 'warn' | 'error',
  event: string,
  details: Record<string, unknown>
): void {
  if (process.env.NODE_ENV !== 'production') return;
  // Structured JSON only in production; single line per entry for log aggregation.

  console.log(JSON.stringify({ level, event, ...details }));
}

/**
 * Build a PostgreSQL connection string with GUC parameters encoded in the
 * `options` query parameter. These are applied at session startup before
 * any user query runs, which avoids the race condition of using the async
 * pool `connect` event for SET statements.
 */
export function buildConnectionString(
  baseUrl: string | undefined,
  overrides: {
    statementTimeout?: string;
    lockTimeout?: string;
    idleTransactionTimeout?: string;
  }
): string {
  const url = baseUrl ?? process.env.DATABASE_URL;
  if (!url) return ''; // Pool will fail with a clear error

  const st = overrides.statementTimeout ?? DEFAULT_STATEMENT_TIMEOUT;
  const lt = overrides.lockTimeout ?? DEFAULT_LOCK_TIMEOUT;
  const itt = overrides.idleTransactionTimeout ?? DEFAULT_IDLE_TX_TIMEOUT;

  const gucOptions = `-c statement_timeout=${st} -c lock_timeout=${lt} -c idle_in_transaction_session_timeout=${itt}`;
  const connection = new URL(url);
  // pg uses the last occurrence of a repeated connection-string parameter.
  // Keep its effective startup options, then apply our timeout guards last.
  const existing = connection.searchParams.getAll('options').at(-1);
  connection.searchParams.set('options', existing ? `${existing} ${gucOptions}` : gucOptions);
  return connection.toString();
}

type PendingQuery = { handleError(error: Error, connection: unknown): void };
type QueryClient = Client & {
  _activeQuery?: PendingQuery | null;
  _queryQueue?: PendingQuery[];
  processID: number;
  secretKey: number;
};

/** Send PostgreSQL CancelRequest on a separate socket, never the query socket. */
function cancelRunningQuery(client: QueryClient, query: PendingQuery): () => void {
  const connection = new Client({ host: client.host, port: client.port })
    .connection as Client['connection'] & {
    connect(portOrPath: number | string, host?: string): void;
    cancel(processId: number, secretKey: number): void;
  };
  const deadline = setTimeout(() => connection.stream.destroy(), 5000);
  const dispose = () => {
    clearTimeout(deadline);
    connection.stream.destroy();
  };
  connection.once('end', () => clearTimeout(deadline));
  connection.once('error', () => {
    structuredLog('error', 'query_cancel_transport_failed', {});
    dispose();
  });
  connection.once('connect', () => {
    // The queued cancellation may connect after the original query completed.
    if (client._activeQuery !== query) {
      dispose();
      return;
    }
    connection.cancel(client.processID, client.secretKey);
  });
  if (client.host.startsWith('/')) connection.connect(`${client.host}/.s.PGSQL.${client.port}`);
  else connection.connect(client.port, client.host);
  return dispose;
}

/**
 * Wrap a client's query method so that in production we measure execution
 * duration and emit a structured JSON warning for slow queries, and in any
 * environment enforce a client-side query timeout that cancels the query
 * server-side via the PostgreSQL cancel protocol.
 *
 * Identity strategy: pg's `client.query()` returns the raw `Query` object
 * when a callback is passed, and a Promise when no callback is passed
 * (the Promise path used by Drizzle ORM).  For callback calls we capture
 * the Query directly from the return value.  For Promise calls we peek at
 * the client's internal `_activeQuery` or `_queryQueue` right after the
 * call, which is where pg stores the just-created Query.
 */

export function wrapClientQuery(
  client: Client,
  timeoutPolicy: QueryTimeoutPolicy
): typeof client.query {
  if (
    typeof timeoutPolicy !== 'number' &&
    Object.values(timeoutPolicy).some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 2147483647
    )
  )
    throw new Error('Database read/write timeouts must be positive integer milliseconds');
  const originalQuery = client.query.bind(client);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapped: any = (...args: any[]) => {
    const startedAt = Date.now();
    const first = args[0];
    const text = typeof first === 'string' ? first : first?.text;
    const queryTimeoutMs =
      typeof timeoutPolicy === 'number'
        ? timeoutPolicy
        : isReadQuery(text)
          ? timeoutPolicy.read
          : timeoutPolicy.write;

    // Detect callback-passing usage (last arg is a function).
    const cbIndex = args.findIndex((a: unknown) => typeof a === 'function');
    const hasCallback = cbIndex !== -1;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let disposeCancellation: (() => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedQuery: any = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const captureQuery = (c: any): void => {
      // Peek at the client's internal state right after the call to find
      // the pg Query object just submitted. pg queues it synchronously
      // behind any running query before client.query() returns.
      // A newly submitted query is last in the queue when another is active.
      capturedQuery = c._queryQueue?.[c._queryQueue.length - 1] ?? c._activeQuery;
    };

    const scheduleTimeout = (): void => {
      if (queryTimeoutMs <= 0 || !capturedQuery) return;
      timeoutId = setTimeout(() => {
        structuredLog('warn', 'query_timeout', { query: text, timeoutMs: queryTimeoutMs });
        const target = client as QueryClient;
        const queuedIndex = target._queryQueue?.indexOf(capturedQuery) ?? -1;
        if (queuedIndex >= 0) {
          target._queryQueue!.splice(queuedIndex, 1);
          capturedQuery.handleError(
            Object.assign(new Error('Query timed out before execution'), { code: '57014' }),
            client.connection
          );
        } else if (target._activeQuery === capturedQuery && typeof timeoutPolicy === 'number') {
          // Automatic policies already install the server deadline. Sending a
          // second CancelRequest at that same deadline can arrive after PostgreSQL
          // has timed out this query and accidentally cancel its successor.
          disposeCancellation = cancelRunningQuery(target, capturedQuery);
        }
      }, queryTimeoutMs);
    };

    const cleanup = (): void => {
      disposeCancellation?.();
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    if (typeof timeoutPolicy !== 'number') {
      // Queue SET and its query synchronously as one adjacent pair. Awaiting SET
      // here would allow another caller's SET to change this query's timeout.
      // Transaction-control commands must remain usable in an aborted transaction.
      originalQuery(`SET statement_timeout = ${queryTimeoutMs}`, (error) => {
        // Let ROLLBACK, including commented SQL, recover an aborted transaction.
        // Every other statement will itself fail with 25P02 until recovery.
        if (!error || ('code' in error && error.code === '25P02') || !capturedQuery) return;
        const target = client as QueryClient;
        const index = target._queryQueue?.indexOf(capturedQuery) ?? -1;
        if (index >= 0) {
          target._queryQueue!.splice(index, 1);
          capturedQuery.handleError(error, client.connection);
        }
      });
    }

    if (hasCallback) {
      const originalCb = args[cbIndex];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrappedCb: typeof originalCb = (err: any, res: any) => {
        cleanup();
        const durationMs = Date.now() - startedAt;
        if (!err && process.env.NODE_ENV === 'production' && durationMs > SLOW_QUERY_THRESHOLD_MS) {
          structuredLog('warn', 'slow_query', { query: text, durationMs });
        }
        originalCb(err, res);
      };
      const instrumentedArgs = [...args.slice(0, cbIndex), wrappedCb, ...args.slice(cbIndex + 1)];
      const result = Reflect.apply(originalQuery, client, instrumentedArgs);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      captureQuery(client as any);
      scheduleTimeout();
      return result;
    }

    // Promise-based invocation.
    const result = Reflect.apply(originalQuery, client, args);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    captureQuery(client as any);
    scheduleTimeout();
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        cleanup();
        const durationMs = Date.now() - startedAt;
        if (process.env.NODE_ENV === 'production' && durationMs > SLOW_QUERY_THRESHOLD_MS) {
          structuredLog('warn', 'slow_query', { query: text, durationMs });
        }
      });
    }
    return result;
  };

  return wrapped;
}

/**
 * Attach the slow-query logging and query-timeout guard to a pool. Registered
 * per-client via the pool's `connect` event.
 */
function attachClientQueryHooks(pool: Pool, timeoutPolicy: QueryTimeoutPolicy): void {
  if (
    process.env.NODE_ENV !== 'production' &&
    typeof timeoutPolicy === 'number' &&
    timeoutPolicy <= 0
  )
    return;

  pool.on('connect', (client: Client) => {
    client.query = wrapClientQuery(client, timeoutPolicy);
  });
}

/**
 * Resolve the SSL configuration for a PostgreSQL connection.
 *
 * Priority:
 * 1. Explicit `ssl` config parameter (highest precedence).
 * 2. `DATABASE_SSL_ENABLED=true` env var.
 * 3. `DATABASE_CA_PATH` env var — read the CA bundle file.
 * 4. `DATABASE_SSL_REJECT_UNAUTHORIZED` env var (default true).
 *
 * Returns `undefined` when TLS is not explicitly requested, letting the
 * `pg` library fall back to its own connection-string parsing (e.g.,
 * `?sslmode=require` in the URL).
 */
function resolveSslConfig(
  sslOverride: DbPoolConfig['ssl']
): boolean | { rejectUnauthorized: boolean; ca?: string } | undefined {
  if (sslOverride !== undefined) return sslOverride;

  const sslEnabled =
    process.env['DATABASE_SSL_ENABLED'] === 'true' || process.env['DATABASE_SSL_ENABLED'] === '1';

  if (!sslEnabled) return undefined;

  const rejectUnauthorized =
    process.env['DATABASE_SSL_REJECT_UNAUTHORIZED'] !== 'false' &&
    process.env['DATABASE_SSL_REJECT_UNAUTHORIZED'] !== '0';

  const caPath = process.env['DATABASE_CA_PATH'];
  if (caPath) {
    try {
      const ca = fs.readFileSync(caPath, 'utf-8');
      // Reject empty/malformed bundles before a connection can fall back to an
      // unintended trust store. Node accepts PEM bundles with multiple certs.
      new X509Certificate(ca);
      return { rejectUnauthorized, ca };
    } catch (cause) {
      throw new Error('Unable to load configured database CA certificate', { cause });
    }
  }

  return { rejectUnauthorized };
}

function poolConnectionConfig(url: string | undefined, config: DbPoolConfig): PoolConfig {
  const ssl = resolveSslConfig(config.ssl);
  let connectionString = buildConnectionString(url, config);
  if (ssl !== undefined && connectionString) {
    const parsed = new URL(connectionString);
    // pg parses URL TLS parameters after the object options. Remove competing
    // URL settings only when application/environment TLS is explicitly selected.
    for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslnegotiation'])
      parsed.searchParams.delete(key);
    connectionString = parsed.toString();
  }
  return { connectionString, ssl };
}

export function createDbPool(config: DbPoolConfig = {}): Pool {
  if (pool) return pool;

  // Connection URL priority: PgBouncer first, then direct PostgreSQL.
  // PgBouncer is the preferred target for production deployments with
  // multiple API replicas.  When PgBouncer is not configured (local dev,
  // single-server), DATABASE_URL is used directly.
  const connectionUrl =
    config.pgbouncerUrl ??
    config.databaseUrl ??
    process.env['PGBOUNCER_URL'] ??
    process.env['DATABASE_URL'];

  const timeoutPolicy = poolTimeoutPolicy(config);

  pool = new Pool({
    ...poolConnectionConfig(connectionUrl, config),
    min: config.poolMin ?? (Number(process.env.DB_POOL_MIN) || 2),
    max: config.poolMax ?? (Number(process.env.DB_POOL_MAX) || 20),
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis:
      config.connectionTimeoutMillis ?? (Number(process.env.DB_CONNECTION_TIMEOUT) || 5_000),
  } satisfies PoolConfig);

  pool.on('error', (err) => {
    structuredLog('error', 'pool_error', { message: err.message });
  });

  attachClientQueryHooks(pool, timeoutPolicy);

  return pool;
}

export function getDbPool(): Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createDbPool() first.');
  }
  return pool;
}

/**
 * Create a direct database connection pool that bypasses PgBouncer.
 * Use this for admin operations, migrations, and any operation that
 * requires session-level features (prepared statements, LISTEN/NOTIFY).
 *
 * The default pool is shared. Call with `{ shared: false }` for an owned
 * migration/admin pool that the caller must close after its operation.
 *
 * Falls back to DATABASE_URL when PGDIRECT_URL is not configured.
 */
export function createDirectDbPool(
  config: DbPoolConfig = {},
  options: { shared?: boolean } = {}
): Pool {
  const shared = options.shared ?? true;
  if (shared && directPool) return directPool;

  const directUrl =
    config.pgdirectUrl ?? process.env['PGDIRECT_URL'] ?? process.env['DATABASE_URL'];

  const timeoutPolicy = poolTimeoutPolicy(config);

  const created = new Pool({
    ...poolConnectionConfig(directUrl, config),
    min: config.poolMin ?? 1,
    max: config.poolMax ?? 5,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis:
      config.connectionTimeoutMillis ?? (Number(process.env.DB_CONNECTION_TIMEOUT) || 5_000),
  } satisfies PoolConfig);

  attachClientQueryHooks(created, timeoutPolicy);
  if (shared) directPool = created;
  return created;
}

export function createDbInstance(config: DbPoolConfig = {}, schema?: Record<string, unknown>) {
  const p = createDbPool(config);
  const logger = process.env.NODE_ENV !== 'production'; // dev/non-prod logs all queries
  return drizzle(p, schema ? { schema, logger } : { logger });
}

export type DbInstance = ReturnType<typeof createDbInstance>;

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  poolStats: {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  };
}

const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Run a database health check that executes `SELECT 1` with a 5-second
 * timeout and returns connection status, latency, and pool statistics.
 *
 * Used by the NestJS health controller for liveness/readiness probes.
 * Never throws — returns `{ ok: false }` on any error or timeout.
 */
let healthProbe: Promise<HealthCheckResult> | null = null;

export async function dbHealth(): Promise<HealthCheckResult> {
  if (healthProbe) return healthProbe;
  const startedAt = Date.now();
  let p: Pool;
  try {
    p = getDbPool();
  } catch {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      poolStats: { totalCount: 0, idleCount: 0, waitingCount: 0 },
    };
  }
  const result = (ok: boolean): HealthCheckResult => ({
    ok,
    latencyMs: Date.now() - startedAt,
    poolStats: { totalCount: p.totalCount, idleCount: p.idleCount, waitingCount: p.waitingCount },
  });
  // A readiness probe must not join a queue behind business transactions.
  if (p.totalCount >= p.options.max && p.idleCount === 0) return result(false);

  let expired = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      expired = true;
      reject(new Error('Health check query timed out'));
    }, HEALTH_CHECK_TIMEOUT_MS);
  });
  const work = p.connect().then(async (client) => {
    try {
      // Acquisition can finish after the caller's deadline. Release it without
      // starting a query the caller no longer needs.
      if (expired) return;
      const remaining = Math.max(1, HEALTH_CHECK_TIMEOUT_MS - (Date.now() - startedAt));
      const query = wrapClientQuery(client, remaining);
      await query('SELECT 1');
    } finally {
      client.release();
    }
  });
  const probe = (async () => {
    try {
      await Promise.race([work, deadline]);
      return result(true);
    } catch {
      return result(false);
    } finally {
      expired = true;
      clearTimeout(timeoutId);
    }
  })();
  healthProbe = probe;
  // Share the result until the underlying acquisition/query actually settles,
  // including after a timeout. Repeated probes cannot accumulate more work.
  const settled = () => {
    if (healthProbe === probe) healthProbe = null;
  };
  void work.then(settled, settled);
  return probe;
}

export * from 'drizzle-orm';
export * from './types';
export * from './base-table';
export * from './metrics';
export * from './schema/rate-limit';
export * from './schema/config';
export * from './schema/storage-record';
export * from './schema/otp-challenge';
export * from './schema/users';
export * from './schema/sessions';
export * from './schema/products';
export * from './schema/password-history';
export * from './schema/profiles';
export * from './schema/device-trust';
export * from './schema/refresh-tokens';
export * from './schema/audit-log';
export * from './schema/addresses';
export * from './schema/orders';
export * from './schema/gift-codes';
export * from './schema/contract-templates';
export * from './schema/geography';
export * from './schema/invoices';
export * from './schema/invoice-lines';
export * from './schema/invoice-items';
export * from './schema/verification-cases';
export * from './schema/legal-profiles';
export * from './schema/tos-versions';
export * from './schema/tos-acceptances';
export * from './schema/staff-roles';
export * from './schema/profile-agents';
export * from './schema/profile-invitations';
export * from './schema/profile-ownership-transfers';
export * from './schema/tickets';
export * from './schema/ticket-comments';
export * from './schema/product-price-versions';
export * from './schema/product-categories';
export * from './schema/electricity-product-limits';
export * from './schema/wallets';
export * from './schema/wallet-topup-callback-events';
export * from './schema/wallet-chargeback-events';
export * from './schema/idempotency-keys';
export * from './schema/notifications';
export * from './schema/notification-templates';
export * from './schema/notification-outbox';
export * from './schema/notification-send-receipts';
export * from './schema/notification-delivery-log';
export * from './schema/notification-dead-letter';
export * from './schema/in-app-notifications';
export * from './schema/notification-preferences';
export * from './schema/email-provider-configs';
export * from './schema/email-webhook-events';
export * from './schema/email-suppressions';
export * from './schema/approval-requests';
export * from './schema/service-breach-alerts';
export * from './schema/staff-teams';
export * from './schema/reconciliation-exceptions';
export * from './schema/background-jobs';
export * from './schema/ai-models';
export * from './schema/knowledge-bases';
export * from './schema/kb-groups';
export * from './schema/ai-policies';
export * from './schema/ai-policy-groups';
export * from './schema/ai-agents';
export * from './schema/ai-agent-groups';
export * from './schema/ai-agent-slots';
export * from './schema/vat-configurations';
export * from './schema/upload-policies';
export * from './schema/service-due-periods';
export * from './schema/invoice-reminder-schedule';
export * from './schema/invoice-reminder-offset-toggles';
export * from './schema/bank-receipts';
export * from './schema/bank-receipt-attachment-claims';

export * from './schema/auth-delivery-outbox';
export * from './schema/user-profile-contexts';

export * from './schema/onboarding-drafts';

export * from './schema/account-login-identifiers';

/** Read runtime storage settings without consuming a slot held by a business transaction. */
export async function loadStoredStorageConfiguration(): Promise<unknown | null> {
  const connection = createDirectDbPool({ poolMax: 1, poolMin: 0 }, { shared: false });
  try {
    const row = (
      await connection.query<{ value: unknown }>(
        "SELECT value FROM app_config WHERE key='storage.active'"
      )
    ).rows[0];
    return row?.value ?? null;
  } finally {
    await connection.end();
  }
}

export * from './schema/ai-model-test-jobs.js';

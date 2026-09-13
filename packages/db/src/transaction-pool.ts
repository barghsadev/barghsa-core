import type { Client } from 'pg';

type TransactionClient = Client & { _txStatus?: string };

interface TransactionSettings {
  statementTimeout: string;
  lockTimeout: string;
  idleTransactionTimeout: string;
  connectionTimeout: number;
  queueTimeout: (text: unknown) => number;
}

/** Keep timeout settings and their SQL on one backend in transaction pooling. */
export function wrapTransactionPoolClient(
  client: Client,
  query: Client['query'],
  settings: TransactionSettings
): Client['query'] {
  const original = client.query.bind(client);
  let queue = Promise.resolve();
  const state = () => (client as TransactionClient)._txStatus ?? 'I';
  const invoke = (method: Client['query'], args: unknown[]): Promise<unknown> =>
    Reflect.apply(method, client, args);

  // BEGIN may wait for a pooled backend. Cleanup must also have a deadline.
  async function control(
    method: Client['query'],
    args: unknown[],
    timeout = settings.connectionTimeout
  ) {
    const timer =
      timeout > 0
        ? setTimeout(() => {
            void client.end().catch(() => {});
          }, timeout)
        : undefined;
    try {
      return await invoke(method, args);
    } finally {
      clearTimeout(timer);
    }
  }
  async function configure() {
    await control(original, [
      "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $3, true)",
      [settings.statementTimeout, settings.lockTimeout, settings.idleTransactionTimeout],
    ]);
  }
  async function execute(args: unknown[]) {
    const first = args[0];
    const text = typeof first === 'string' ? first : (first as { text?: unknown } | null)?.text;
    if (typeof text !== 'string') throw new TypeError('Transaction pool queries require SQL text');
    const command = text
      .replace(
        /'(?:''|[^'])*'|"(?:""|[^"])*"|\$([a-zA-Z_][a-zA-Z_0-9]*|)\$[\s\S]*?\$\1\$|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,
        ' '
      )
      .trim()
      .replace(/;\s*$/, '');
    if (
      command.includes(';') &&
      /(?:^|;)\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|END|ABORT|SAVEPOINT|RELEASE)\b/i.test(
        command
      )
    )
      throw new Error('Send transaction commands separately when using PgBouncer');
    const transactionControl =
      /^(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|END|ABORT|SAVEPOINT|RELEASE)\b/i.test(command);
    const wasIdle = state() === 'I';
    try {
      if (transactionControl) {
        const result = await control(
          query,
          args,
          wasIdle ? settings.connectionTimeout : settings.queueTimeout(text)
        );
        if (state() === 'T' && (wasIdle || /\bAND\s+CHAIN\b/i.test(command))) await configure();
        return result;
      }
      if (wasIdle) {
        await control(original, ['BEGIN']);
        await configure();
      }
      const result = await invoke(query, args);
      if (wasIdle) await control(query, ['COMMIT'], settings.queueTimeout('COMMIT'));
      return result;
    } catch (error) {
      // Leave caller-owned transactions aborted until their own ROLLBACK.
      if (wasIdle && state() !== 'I') {
        try {
          await control(original, ['ROLLBACK']);
        } catch {
          await client.end().catch(() => {});
        }
      }
      throw error;
    }
  }

  return ((...args: unknown[]) => {
    const callbackIndex = args.findIndex((value) => typeof value === 'function');
    const callback =
      callbackIndex < 0
        ? undefined
        : (args[callbackIndex] as (error: unknown, result?: unknown) => void);
    const parameters = callbackIndex < 0 ? args : args.slice(0, callbackIndex);
    const first = parameters[0];
    const text = typeof first === 'string' ? first : (first as { text?: unknown } | null)?.text;
    const timeout = settings.queueTimeout(text);
    let expired = false;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer =
        timeout > 0
          ? setTimeout(() => {
              expired = true;
              reject(
                Object.assign(new Error('Query timed out before execution'), { code: '57014' })
              );
            }, timeout)
          : undefined;
      queue = queue.then(async () => {
        clearTimeout(timer);
        if (expired) return;
        try {
          resolve(await execute(parameters));
        } catch (error) {
          reject(error);
        }
      });
    });
    if (!callback) return result;
    void result.then(
      (value) => callback(null, value),
      (error) => callback(error)
    );
    return undefined;
  }) as Client['query'];
}

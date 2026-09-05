import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { runMigrations } from '../../../../packages/db/src/migrate'

/** Each fixture owns its database and a child running the compiled AppModule. */
export async function startHttpFixture(testDatabaseUrl: string) {
  const database = `test_http_${randomUUID().replaceAll('-', '')}`
  const management = new Pool({ connectionString: testDatabaseUrl })
  let created = false
  let child: ChildProcess | undefined
  let pool: Pool | undefined
  let output = ''

  async function close() {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((done) => {
        const timeout = setTimeout(() => child!.kill('SIGKILL'), 5000)
        child!.once('exit', () => { clearTimeout(timeout); done() })
        if (child!.connected) child!.send('stop')
        else child!.kill('SIGTERM')
      })
    }
    await pool?.end()
    try {
      // PostgreSQL waits for closing connections. FORCE can terminate a socket
      // whose Pool.end() has returned before its TCP close event is delivered.
      if (created) await management.query(`DROP DATABASE "${database}"`)
    } finally { await management.end() }
  }

  try {
    await management.query(`CREATE DATABASE "${database}"`)
    created = true
    const url = new URL(testDatabaseUrl)
    url.pathname = `/${database}`
    const migration = await runMigrations({ connection: { pgdirectUrl: url.toString() } })
    if (!migration.ok) throw new Error(`Production migration failed: ${JSON.stringify(migration)}`)
    pool = new Pool({ connectionString: url.toString() })
    child = fork(resolve(__dirname, '../../scripts/http-test-server.cjs'), [], {
      silent: true,
      env: { ...process.env, DATABASE_URL: url.toString(), PGDIRECT_URL: url.toString(),
        NODE_ENV: 'test', AUTH_DELIVERY_ENCRYPTION_KEY: 'http-fixture-delivery-key-only', REDIS_URL: '', REDIS_HOST: '', S3_BUCKET: '', S3_REGION: '' },
    })
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', (data) => { output = (output + String(data)).slice(-20000) })
    const base = await new Promise<string>((resolvePort, reject) => {
      const timeout = setTimeout(() => reject(new Error(`HTTP server startup timed out: ${output}`)), 20000)
      child!.once('error', (error) => { clearTimeout(timeout); reject(error) })
      child!.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`HTTP server exited ${code}: ${output}`)) })
      child!.once('message', (message: { port: number }) => {
        clearTimeout(timeout)
        resolvePort(`http://127.0.0.1:${message.port}`)
      })
    })
    return { base, pool, close, logs: () => output }
  } catch (error) {
    await close()
    throw error
  }
}

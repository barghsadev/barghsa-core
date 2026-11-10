import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHttpFixture } from '../test/http-fixture.js';

let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
const sessionId = randomUUID();
const csrf = randomUUID();
const body = { code: 'CHUNK_LOAD_FAILED', reference: randomUUID() };

beforeAll(async () => {
  vi.stubEnv('ROUTE_ERROR_SENTRY_DSN', '');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('route-reporter','route-reporter@example.test','fixture-only')"
  );
  await fixture.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'route-reporter',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour')",
    [sessionId, csrf, randomUUID()]
  );
}, 30000);

afterAll(async () => {
  await fixture?.close();
  vi.unstubAllEnvs();
});

function report(
  payload: unknown = body,
  headers: Record<string, string> = {},
  base = fixture.base
) {
  return fetch(base + '/api/route-errors', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

it('enforces session CSRF and allows an anonymous same-origin report to reach configuration', async () => {
  const cookie = `barghsa_session=${sessionId}`;
  expect((await report(body, { cookie })).status).toBe(403);
  expect((await report(body, { cookie, 'x-csrf-token': 'wrong-token' })).status).toBe(403);
  expect((await report(body, { cookie, 'x-csrf-token': csrf })).status).toBe(503);
  expect((await report()).status).toBe(503);
});

it('rejects origin changes, private data and oversized request bodies', async () => {
  const privateText = 'PRIVATE-FORM-VALUE';
  expect((await report(body, { origin: 'https://attacker.example.test' })).status).toBe(403);
  expect((await report({ ...body, form: privateText })).status).toBe(400);
  expect((await report({ ...body, form: privateText.repeat(100) })).status).toBe(413);
  expect(fixture.logs()).not.toContain(privateText);
});

it('rate limits repeated diagnostics even when the receiver is unavailable', async () => {
  let status = 503;
  let attempts = 0;
  while (status === 503 && attempts < 21) {
    attempts++;
    status = (await report()).status;
  }
  expect(attempts).toBeGreaterThan(1);
  expect(status).toBe(429);
});

it('reports only safe diagnostics and the deployed revision to the Sentry envelope endpoint', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'barghsa-sentry-proof-'));
  const certPath = join(directory, 'cert.pem');
  const keyPath = join(directory, 'key.pem');
  const release = 'a1b2c3d4'.repeat(5);
  const eventId = body.reference.replaceAll('-', '');
  const originalCa = process.env.NODE_EXTRA_CA_CERTS;
  const originalRelease = process.env.BARGHSA_RELEASE_SHA;
  const originalDsn = process.env.ROUTE_ERROR_SENTRY_DSN;
  const deliveries: {
    method: string | undefined;
    url: string | undefined;
    contentType: string | undefined;
    envelope: string;
  }[] = [];
  let receiver: Server | undefined;
  let reportingApi: Awaited<ReturnType<typeof startHttpFixture>> | undefined;

  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-keyout',
        keyPath,
        '-out',
        certPath,
      ],
      { stdio: 'ignore', timeout: 10_000 }
    );
    const server = createServer(
      { cert: readFileSync(certPath), key: readFileSync(keyPath) },
      (req, res) => {
        let envelope = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          envelope += chunk;
        });
        req.once('end', () => {
          deliveries.push({
            method: req.method,
            url: req.url,
            contentType: req.headers['content-type'],
            envelope,
          });
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ id: eventId }));
        });
      }
    );
    receiver = server;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');

    vi.stubEnv('NODE_EXTRA_CA_CERTS', certPath);
    vi.stubEnv('BARGHSA_RELEASE_SHA', release);
    vi.stubEnv('ROUTE_ERROR_SENTRY_DSN', `https://fixturekey@127.0.0.1:${address.port}/17`);
    reportingApi = await startHttpFixture(process.env.TEST_DATABASE_URL!);
    const privateText = 'PRIVATE-ROUTE-CONTEXT';
    const response = await report(
      body,
      { referer: `https://app.example.test/${privateText}` },
      reportingApi.base
    );
    expect(response.status).toBe(204);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      method: 'POST',
      url: '/api/17/envelope/',
      contentType: 'application/x-sentry-envelope',
    });
    const envelope = deliveries[0]!.envelope;
    expect(envelope).not.toContain(privateText);
    expect(JSON.parse(envelope.split('\n')[2]!)).toEqual({
      event_id: eventId,
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      platform: 'javascript',
      level: 'error',
      message: body.code,
      fingerprint: [body.code],
      release,
      tags: { support_reference: body.reference },
    });
  } finally {
    vi.stubEnv('NODE_EXTRA_CA_CERTS', originalCa);
    vi.stubEnv('BARGHSA_RELEASE_SHA', originalRelease);
    vi.stubEnv('ROUTE_ERROR_SENTRY_DSN', originalDsn);
    try {
      await reportingApi?.close();
    } finally {
      receiver?.closeAllConnections();
      if (receiver?.listening)
        await new Promise<void>((resolve) => receiver?.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  }
}, 30_000);

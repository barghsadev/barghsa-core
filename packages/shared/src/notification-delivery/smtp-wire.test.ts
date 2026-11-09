import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createServer, type Server } from 'node:tls';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createEmailSender } from './email.js';
import { classifyProviderError, requiresProviderConfigurationFix } from './email-errors.js';

let certificate: Buffer;

vi.mock('nodemailer', async (importOriginal) => {
  const { default: nodemailer } = await importOriginal<typeof import('nodemailer')>();
  return {
    default: {
      createTransport: (options: SMTPTransport.Options) =>
        nodemailer.createTransport({ ...options, tls: { ...options.tls, ca: certificate } }),
    },
  };
});

type Outcome = 'accept' | 'auth' | 'sender' | 'temporary' | 'recipient' | 'timeout' | 'disconnect';
let outcome: Outcome;
let server: Server | undefined;
let port: number;
const connections = new Set<Socket>();
const messages: string[] = [];
const message = {
  destination: 'customer@example.test',
  subject: 'Invoice receipt',
  text: 'Your invoice is paid.',
  idempotencyKey: 'smtp-wire-invoice-occurrence',
};

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'barghsa-smtp-wire-'));
  try {
    const keyPath = join(directory, 'key.pem');
    const certificatePath = join(directory, 'cert.pem');
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
        '-keyout',
        keyPath,
        '-out',
        certificatePath,
      ],
      { stdio: 'ignore', timeout: 10_000 }
    );
    certificate = readFileSync(certificatePath);
    server = createServer({ key: readFileSync(keyPath), cert: certificate }, (socket) => {
      const result = outcome;
      let data: string[] | undefined;
      const lines = createInterface({ input: socket });
      socket.on('error', () => lines.close());
      socket.write('220 localhost ready\r\n');
      lines.on('line', (line) => {
        if (data) {
          if (line !== '.') {
            data.push(line);
            return;
          }
          messages.push(data.join('\n'));
          data = undefined;
          if (result === 'disconnect') socket.destroy();
          else socket.write('250 2.0.0 Accepted\r\n');
        } else if (line.startsWith('EHLO ')) {
          socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        } else if (line.startsWith('AUTH PLAIN ')) {
          const credentials = Buffer.from(line.slice('AUTH PLAIN '.length), 'base64').toString();
          socket.write(
            result === 'auth' || credentials !== '\0test-smtp\0fixture-only'
              ? '535 5.7.8 Authentication failed\r\n'
              : '235 2.7.0 Authenticated\r\n'
          );
        } else if (line.startsWith('MAIL FROM:')) {
          socket.write(
            result === 'sender' ? '550 5.7.1 Sender rejected\r\n' : '250 2.1.0 Sender accepted\r\n'
          );
        } else if (line.startsWith('RCPT TO:')) {
          if (result === 'temporary') socket.write('450 4.2.0 Mailbox busy\r\n');
          else if (result === 'recipient') socket.write('550 5.1.1 Recipient rejected\r\n');
          else if (result !== 'timeout') socket.write('250 2.1.5 Recipient accepted\r\n');
        } else if (line === 'DATA') {
          data = [];
          socket.write('354 End with a dot\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else {
          socket.write('502 Unexpected command\r\n');
        }
      });
    });
    server.on('connection', (socket) => {
      connections.add(socket);
      socket.once('close', () => connections.delete(socket));
    });
    const address = (await lookup('localhost')).address;
    expect(['127.0.0.1', '::1']).toContain(address);
    server.listen(0, address);
    await once(server, 'listening');
    port = (server.address() as AddressInfo).port;
    vi.stubEnv('SMTP_HOST_ALLOWLIST', 'localhost');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  for (const socket of connections) socket.destroy();
  if (server?.listening) await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(() => {
  outcome = 'accept';
  messages.length = 0;
});

const send = createEmailSender({
  query: async (sql) => {
    if (sql.startsWith('SELECT degraded,')) return { rows: [{ degraded: false }] };
    if (sql === 'SELECT clock_timestamp() AS now') return { rows: [{ now: new Date() }] };
    if (!sql.startsWith('SELECT id,transport,config')) return { rows: [] };
    return {
      rows: [
        {
          id: 'test-smtp',
          transport: 'smtp',
          config: {
            host: 'localhost',
            port,
            security: 'TLS',
            from_email: 'sender@example.test',
            username: 'test-smtp',
            password: 'fixture-only',
            command_timeout: outcome === 'timeout' ? 1 : 10,
          },
        },
      ],
    };
  },
});

it('returns the accepted wire receipt with the stable message ID', async () => {
  const id = `<${createHash('sha256').update(message.idempotencyKey).digest('hex')}@example.test>`;
  await expect(send(message)).resolves.toBe(id);
  expect(messages).toHaveLength(1);
  const headers = messages[0]!.split('\n\n', 1)[0]!.replace(/\n[ \t]+/g, ' ');
  expect(headers.split('\n')).toContain(`Message-ID: ${id}`);
  expect(messages[0]).toContain(message.text);
});

it.each([
  ['auth', 535, 'permanent', true],
  ['sender', 550, 'permanent', true],
  ['temporary', 450, 'transient', false],
  ['recipient', 550, 'permanent', false],
] as const)(
  'classifies %s rejection without transmitting DATA',
  async (scenario, responseCode, kind, configFix) => {
    outcome = scenario;
    const error = await send(message).then(
      () => undefined,
      (failure: unknown) => failure
    );
    expect(error).toMatchObject({ responseCode });
    expect(classifyProviderError(error)).toBe(kind);
    expect(requiresProviderConfigurationFix(error)).toBe(configFix);
    expect(messages).toEqual([]);
  }
);

it('surfaces an SMTP command timeout without transmitting DATA', async () => {
  outcome = 'timeout';
  await expect(send(message)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  expect(messages).toEqual([]);
});

it('returns no receipt when the provider disconnects after receiving DATA', async () => {
  outcome = 'disconnect';
  await expect(send(message)).rejects.not.toHaveProperty('responseCode');
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain(message.text);
});

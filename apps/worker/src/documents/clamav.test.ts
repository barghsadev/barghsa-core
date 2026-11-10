import { createServer, type Server, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import { GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES } from '@barghsa/shared/admin';
import {
  scanUploadWithClamAv,
  scanWithClamAv,
  type StorageProvider,
} from '@barghsa/shared/storage';
import { runDocumentScans } from './scan-runner.js';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

async function fakeScanner(reply: string) {
  let received = Buffer.alloc(0);
  server = createServer((socket) => {
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      if (received.subarray(0, 10).toString() !== 'zINSTREAM\0') return;
      let offset = 10;
      while (offset + 4 <= received.length) {
        const length = received.readUInt32BE(offset);
        if (length === 0) {
          socket.end(`${reply}\0`);
          return;
        }
        if (offset + 4 + length > received.length) return;
        offset += 4 + length;
      }
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fake scanner has no port');
  return {
    endpoint: { host: '127.0.0.1', port: address.port },
    uploaded: () => received,
  };
}

it('sends bounded INSTREAM frames and accepts a clean verdict', async () => {
  const fake = await fakeScanner('stream: OK');
  const bytes = Buffer.from('test file');
  await expect(scanWithClamAv(bytes, fake.endpoint)).resolves.toBe('clean');
  expect(fake.uploaded().subarray(10, 14).readUInt32BE()).toBe(bytes.length);
  expect(fake.uploaded().subarray(14, 14 + bytes.length)).toEqual(bytes);
});

it('distinguishes malware from scanner failures', async () => {
  const fake = await fakeScanner('stream: Eicar-Test-Signature FOUND');
  await expect(scanWithClamAv(Buffer.from('infected'), fake.endpoint)).resolves.toBe('infected');
  expect(() => scanWithClamAv(Buffer.alloc(0), fake.endpoint)).toThrow('size');
});

it('binds a streamed verdict to the complete bytes across socket frames', async () => {
  const fake = await fakeScanner('stream: OK');
  const chunks = [Buffer.alloc(64 * 1024 + 1, 'x'), Buffer.from('last')];
  const bytes = Buffer.concat(chunks);
  await expect(
    scanUploadWithClamAv(ReadableStream.from(chunks), bytes.length, fake.endpoint)
  ).resolves.toEqual({
    verdict: 'clean',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  expect(fake.uploaded().readUInt32BE(10)).toBe(64 * 1024);
  expect(fake.uploaded().readUInt32BE(10 + 4 + 64 * 1024)).toBe(1);
});

it('rejects a short stream before claiming a verdict', async () => {
  const fake = await fakeScanner('stream: OK');
  const bytes = Buffer.from('partial');
  await expect(
    scanUploadWithClamAv(ReadableStream.from([bytes]), bytes.length + 1, fake.endpoint)
  ).rejects.toThrow('size changed');
});

function sealedScanJob(size: number, checksum: string, body: ReadableStream<Uint8Array>) {
  const row = {
    document_id: 'sealed-document',
    attempts: 0,
    storage_key: 'sealed-object',
    checksum,
    size_bytes: String(size),
    supersedes_document_id: null,
    uploaded_by: 'customer',
    original_name: 'fixture.pdf',
  };
  const query = vi.fn(async (sql: string, _values?: unknown[]) => ({
    rows: sql.includes('FOR UPDATE OF j,d') ? [row] : [{ revision: 1 }],
    rowCount: 1,
  }));
  return {
    query,
    pool: {
      query: async () => ({ rows: [{ document_id: row.document_id }] }),
      connect: async () => ({ query, release() {} }),
    } as unknown as Pool,
    storage: {
      getObject: async () => ({ body, contentLength: undefined }),
    } as unknown as StorageProvider,
  };
}

it('streams a sealed document at the full upload ceiling without buffering the object', async () => {
  const chunk = Buffer.alloc(64 * 1024, 'x');
  const size = GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES;
  const frames = size / chunk.length;
  const digest = createHash('sha256');
  for (let index = 0; index < frames; index++) digest.update(chunk);
  let emitted = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted === frames) controller.close();
      else {
        emitted++;
        controller.enqueue(chunk);
      }
    },
  });
  let wireSize = 0;
  server = createServer({ allowHalfOpen: true }, (socket) => {
    socket.on('data', (data) => {
      wireSize += data.length;
    });
    socket.on('end', () => socket.end('stream: OK\0'));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fake scanner has no port');
  const job = sealedScanJob(size, digest.digest('hex'), body);
  await expect(
    runDocumentScans(job.pool, job.storage, { host: '127.0.0.1', port: address.port })
  ).resolves.toEqual({ clean: 1, infected: 0, retrying: 0 });
  expect(wireSize).toBe(10 + size + 4 * frames + 4);
  expect(job.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE documents SET state'), [
    'sealed-document',
    'Available',
    'Available',
  ]);
});

it('retries a clean scanner result whose full stream differs from the sealed checksum', async () => {
  const fake = await fakeScanner('stream: OK');
  const bytes = Buffer.from('substituted bytes');
  const job = sealedScanJob(bytes.length, 'a'.repeat(64), ReadableStream.from([bytes]));
  await expect(runDocumentScans(job.pool, job.storage, fake.endpoint)).resolves.toEqual({
    clean: 0,
    infected: 0,
    retrying: 1,
  });
  expect(job.query.mock.calls.some(([sql]) => sql.includes('UPDATE documents SET state'))).toBe(
    false
  );
  expect(job.query).toHaveBeenCalledWith(expect.stringContaining('next_attempt_at=NOW()'), [
    'sealed-document',
    'scan_processing_failed',
    30,
    0,
  ]);
});

it('bounds an unresponsive scanner by a wall-clock timeout', async () => {
  const sockets: Socket[] = [];
  server = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fake scanner has no port');
  await expect(
    scanWithClamAv(Buffer.from('pending'), {
      host: '127.0.0.1',
      port: address.port,
      timeoutMs: 20,
    })
  ).rejects.toThrow('timed out');
  sockets.forEach((socket) => socket.destroy());
});

import { createServer, type Server, type Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { scanUploadWithClamAv, scanWithClamAv } from '@barghsa/shared/storage';

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

import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { once } from 'node:events';

export type ScanVerdict = 'clean' | 'infected';
export type ScannerEndpoint = { host: string; port: number; timeoutMs?: number };

/** Scan a bounded object with ClamAV's INSTREAM protocol. Transport errors are retryable. */
export function scanWithClamAv(bytes: Uint8Array, endpoint: ScannerEndpoint): Promise<ScanVerdict> {
  if (!bytes.length || bytes.byteLength > 50 * 1024 * 1024)
    throw new Error('Document scan size is invalid');
  return scanUploadWithClamAv(ReadableStream.from([bytes]), bytes.byteLength, endpoint).then(
    ({ verdict }) => verdict
  );
}

/** Scan stored bytes with backpressure and bind the verdict to their SHA-256. */
export function scanUploadWithClamAv(
  body: ReadableStream<Uint8Array>,
  size: number,
  endpoint: ScannerEndpoint
): Promise<{ verdict: ScanVerdict; sha256: string }> {
  if (
    !endpoint.host ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535
  )
    throw new Error('Invalid document scanner endpoint');
  if (!Number.isSafeInteger(size) || size < 1 || size > 100 * 1024 * 1024)
    throw new Error('Document scan size is invalid');
  const timeoutMs = endpoint.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid document scanner timeout');
  return new Promise((resolve, reject) => {
    const reader = body.getReader();
    const digest = createHash('sha256');
    const stop = new AbortController();
    const socket = connect({ host: endpoint.host, port: endpoint.port });
    socket.setTimeout(timeoutMs);
    let settled = false;
    let sha256: string | undefined;
    let response = Buffer.alloc(0);
    const finish = (error?: Error, verdict?: ScanVerdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      stop.abort();
      socket.destroy();
      void reader
        .cancel()
        .catch(() => undefined)
        .finally(() => reader.releaseLock());
      if (error) reject(error);
      else if (verdict && sha256) resolve({ verdict, sha256 });
      else reject(new Error('Document scanner replied before the full object was sent'));
    };
    const deadline = setTimeout(() => finish(new Error('Document scanner timed out')), timeoutMs);
    socket.on('error', (error) => finish(error));
    socket.on('timeout', () => finish(new Error('Document scanner timed out')));
    socket.on('close', () => finish(new Error('Document scanner closed without a verdict')));
    socket.on('data', (chunk: Buffer) => {
      response = Buffer.concat([response, chunk]);
      if (response.length > 4096) return finish(new Error('Document scanner reply is too large'));
      const end = response.indexOf(0);
      if (end < 0) return;
      const reply = response.subarray(0, end).toString('utf8');
      if (reply === 'stream: OK') finish(undefined, 'clean');
      else if (/^stream: .+ FOUND$/.test(reply)) finish(undefined, 'infected');
      else finish(new Error('Document scanner returned an invalid verdict'));
    });
    async function send() {
      socket.write('zINSTREAM\0');
      let total = 0;
      while (!settled) {
        const { done, value } = await reader.read();
        if (done || settled) break;
        total += value.byteLength;
        if (total > size) throw new Error('Document scan size changed');
        digest.update(value);
        for (let offset = 0; offset < value.byteLength; offset += 64 * 1024) {
          const chunk = value.subarray(offset, offset + 64 * 1024);
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.byteLength);
          socket.write(length);
          if (!socket.write(chunk)) await once(socket, 'drain', { signal: stop.signal });
        }
      }
      if (settled) return;
      if (total !== size) throw new Error('Document scan size changed');
      sha256 = digest.digest('hex');
      socket.end(Buffer.alloc(4));
    }
    socket.once('connect', () => void send().catch((error: Error) => finish(error)));
  });
}

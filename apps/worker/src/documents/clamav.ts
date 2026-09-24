import { connect } from 'node:net';

export type ScanVerdict = 'clean' | 'infected';
export type ScannerEndpoint = { host: string; port: number; timeoutMs?: number };

/** Scan a bounded object with ClamAV's INSTREAM protocol. Transport errors are retryable. */
export function scanWithClamAv(bytes: Uint8Array, endpoint: ScannerEndpoint): Promise<ScanVerdict> {
  if (
    !endpoint.host ||
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65535
  )
    throw new Error('Invalid document scanner endpoint');
  if (!bytes.length || bytes.byteLength > 50 * 1024 * 1024)
    throw new Error('Document scan size is invalid');
  const timeoutMs = endpoint.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid document scanner timeout');
  return new Promise((resolve, reject) => {
    const socket = connect({ host: endpoint.host, port: endpoint.port });
    socket.setTimeout(timeoutMs);
    let settled = false;
    let response = Buffer.alloc(0);
    const finish = (error?: Error, verdict?: ScanVerdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (error) reject(error);
      else resolve(verdict!);
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
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
        const chunk = bytes.subarray(offset, offset + 64 * 1024);
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.byteLength);
        socket.write(length);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}

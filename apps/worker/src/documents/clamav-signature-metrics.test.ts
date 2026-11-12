import { createServer, type Socket } from 'node:net';
import { expect, it } from 'vitest';
import { exportWorkerMetrics } from '../notifications/worker-metrics.js';
import { collectClamAvSignatureBuildTime } from './clamav-signature-metrics.js';

const valid = 'ClamAV 1.5.4/28181/Tue Nov 12 06:27:14 2024\0';
const metric = 'barghsa_clamav_signature_build_timestamp_seconds';
const validSample = `${metric} ${Date.UTC(2024, 10, 12, 6, 27, 14) / 1000}`;

async function readProbe(send: (socket: Socket) => void) {
  let command = '';
  const server = createServer((socket) => {
    socket.on('data', (chunk) => {
      command += chunk.toString('ascii');
      if (command.includes('\0')) send(socket);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing scanner fixture port');
    await collectClamAvSignatureBuildTime({ host: '127.0.0.1', port: address.port });
    expect(command).toBe('zVERSION\0');
    return (await exportWorkerMetrics()).split('\n').find((line) => line.startsWith(`${metric} `));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

it('exports the UTC build time after reading one complete ClamD version reply', async () => {
  const value = await readProbe((socket) => {
    socket.write(valid.slice(0, 9));
    setImmediate(() => socket.end(valid.slice(9)));
  });
  expect(value).toBe(validSample);
});

it.each([
  ['missing timestamp', 'ClamAV 1.5.4\0'],
  ['impossible date', 'ClamAV 1.5.4/28181/Tue Nov 31 06:27:14 2024\0'],
  ['future date', 'ClamAV 1.5.4/28181/Fri Jan 01 00:00:00 2100\0'],
  ['incomplete reply', valid.slice(0, -1)],
  ['oversized reply', 'x'.repeat(257)],
])('replaces a prior timestamp with zero for a %s', async (_label, reply) => {
  expect(await readProbe((socket) => socket.end(valid))).toBe(validSample);
  expect(await readProbe((socket) => socket.end(reply))).toBe(`${metric} 0`);
});

it('closes an unresponsive scanner connection and exports zero', async () => {
  expect(await readProbe(() => {})).toBe(`${metric} 0`);
});

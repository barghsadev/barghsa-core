import { createConnection } from 'node:net';
import { Gauge } from 'prom-client';
import { registry } from '../notifications/worker-metrics.js';

const signatureBuildTime = new Gauge({
  name: 'barghsa_clamav_signature_build_timestamp_seconds',
  help: 'Build time of the loaded ClamAV signature database, or zero when unverified',
  registers: [registry],
});

function parseBuildTime(reply: string): number {
  const match =
    /^ClamAV [\w.+-]+\/[1-9]\d{0,9}\/(\w{3}) (\w{3}) {1,2}(\d{1,2}) (\d{2}:\d{2}:\d{2}) (\d{4})\0$/.exec(
      reply
    );
  if (!match) return 0;
  const [, weekday, month, day, clock, year] = match;
  // ClamD runs in UTC and reports the timestamp of the loaded database.
  const formatted = `${weekday}, ${day!.padStart(2, '0')} ${month} ${year} ${clock} GMT`;
  const date = new Date(formatted);
  const milliseconds = date.getTime();
  if (date.toUTCString() !== formatted || milliseconds <= 0 || milliseconds > Date.now() + 300_000)
    return 0;
  return milliseconds / 1000;
}

export async function collectClamAvSignatureBuildTime(scanner: { host: string; port: number }) {
  const timestamp = await new Promise<number>((resolve) => {
    const socket = createConnection(scanner);
    const finish = (value = 0) => {
      clearTimeout(deadline);
      socket.destroy();
      resolve(value);
    };
    const deadline = setTimeout(finish, 1500);
    let reply = '';
    socket.once('connect', () => socket.write('zVERSION\0'));
    socket.on('data', (chunk: Buffer) => {
      if (reply.length + chunk.length > 256) return finish();
      reply += chunk.toString('latin1');
      if (reply.includes('\0')) finish(parseBuildTime(reply));
    });
    socket.once('error', () => finish());
    socket.once('close', () => finish());
  }).catch(() => 0);
  signatureBuildTime.set(timestamp);
}

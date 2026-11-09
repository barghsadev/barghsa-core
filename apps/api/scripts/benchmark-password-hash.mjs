import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { PASSWORD_HASH_OPTIONS } from '@barghsa/shared/password-hash';
import { hash, verify } from 'argon2';

// Synthetic input only. This script runs outside the API process and database.
const password = 'Synthetic Argon2 benchmark input';
const samples = 12;
const verificationHash = await hash(password, PASSWORD_HASH_OPTIONS);

async function timed(operation) {
  const start = performance.now();
  await operation();
  return Math.round(performance.now() - start);
}

function percentiles(times) {
  const sorted = times.toSorted((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

async function verifyPassword() {
  if (!(await verify(verificationHash, password))) throw new Error('Benchmark verification failed');
}

const hashTimes = [];
const verifyTimes = [];
for (let i = 0; i < samples; i++) {
  hashTimes.push(await timed(() => hash(password, PASSWORD_HASH_OPTIONS)));
  verifyTimes.push(await timed(verifyPassword));
}
const concurrentVerifyWallMs = await timed(() =>
  Promise.all(Array.from({ length: 4 }, () => verifyPassword()))
);

console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      availableParallelism: availableParallelism(),
      options: PASSWORD_HASH_OPTIONS,
      samples,
      hashMs: percentiles(hashTimes),
      verifyMs: percentiles(verifyTimes),
      fourConcurrentVerifiesWallMs: concurrentVerifyWallMs,
      peakRssKiB: process.resourceUsage().maxRSS,
    },
    null,
    2
  )
);

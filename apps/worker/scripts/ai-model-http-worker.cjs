// Isolated HTTP-test worker: two slots exercise competing production claims.
const { Pool } = require('pg');
const { runAiModelTest } = require('../dist/ai-models/test-runner.js');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: 'ai-model-http-worker',
});
const pending = new Set();
const timer = setInterval(() => {
  if (pending.size >= 2) return;
  const work = runAiModelTest(pool)
    .catch(() => {
      console.error('AI model test worker failed');
      process.exitCode = 1;
    })
    .finally(() => {
      pending.delete(work);
    });
  pending.add(work);
}, 100);
process.once('message', async (message) => {
  if (message !== 'stop') return;
  clearInterval(timer);
  await Promise.allSettled(pending);
  await pool.end();
  process.exit(process.exitCode || 0);
});
process.send({ ready: true });

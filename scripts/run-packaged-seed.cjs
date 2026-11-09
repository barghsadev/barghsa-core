// Run the initial production seed from the packaged DB workspace.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const required = [
  'PGDIRECT_URL',
  'ADMIN_BOOTSTRAP_SECRET',
  'ADMIN_BOOTSTRAP_KEY',
  'ADMIN_BOOTSTRAP_EMAIL',
  'ADMIN_BOOTSTRAP_PASSWORD',
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`Initial database seed requires ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  const entry = path.join(path.dirname(require.resolve('@barghsa/db')), 'seed', 'index.js');
  const result = spawnSync(process.execPath, [entry], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}

// Run the canonical production migrations shipped in the API/worker image.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const entry = path.join(path.dirname(require.resolve('@barghsa/db')), 'migrate.js');
const result = spawnSync(process.execPath, [entry], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;

// Docker launches Node as PID 1. Select readiness from its actual command,
// including a docker run/Compose command override; never fall back to liveness.
const fs = require('node:fs');
const path = require('node:path');

try {
  const args = fs.readFileSync('/proc/1/cmdline', 'utf8').split('\0');
  const entry = path.resolve('/app', args[1] || '');
  if (entry === '/app/worker/dist/main.js') {
    require('/app/worker/healthcheck.js');
  } else if (entry === '/app/dist/src/main.js') {
    require('/app/healthcheck.js');
  } else {
    process.exit(1);
  }
} catch {
  process.exit(1);
}

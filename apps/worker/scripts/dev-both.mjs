import { spawn } from 'node:child_process';

const processes = [
  spawn(process.execPath, ['dist/main.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['dist/ai-inference/main.js'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of processes) child.kill('SIGTERM');
}
for (const child of processes) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

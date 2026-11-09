import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const counts = report.metadata?.vulnerabilities;
if (
  !report.advisories ||
  typeof report.advisories !== 'object' ||
  Array.isArray(report.advisories) ||
  !Number.isInteger(counts?.high) ||
  !Number.isInteger(counts?.critical) ||
  counts.high < 0 ||
  counts.critical < 0
) {
  throw new Error('Dependency audit did not return a valid report');
}

console.log(`Dependency audit: ${counts.high} high, ${counts.critical} critical`);
if (counts.high + counts.critical > 0) process.exitCode = 1;

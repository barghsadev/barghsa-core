import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const excludedDirectories = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '__tests__',
  'test',
  'tests',
  'e2e',
  'playwright-report',
  'migrations',
]);
const testFile = /\.(?:test|spec)(?:-d)?\.[cm]?tsx?$/;
const sourceFile = /\.[cm]?tsx?$/;

/** Conservative text scan: suppression tokens in strings also require removal. */
export async function checkSuppressedErrors(root) {
  const findings = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excludedDirectories.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Cannot inspect symbolic link: ${path}`);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (sourceFile.test(entry.name) && !testFile.test(entry.name)) {
        const name = relative(root, path).replaceAll('\\', '/');
        const text = await readFile(path, 'utf8');
        for (const [index, line] of text.split(/\r?\n/).entries()) {
          for (const match of line.matchAll(/@ts-(?:expect-error|ignore|nocheck)\b/g)) {
            // TanStack owns this exact generated file; handwritten sources get no exemption.
            if (name === 'apps/web/src/routeTree.gen.ts' && match[0] === '@ts-nocheck') continue;
            findings.push(`${name}:${index + 1}: ${match[0]}`);
          }
        }
      }
    }
  }
  // Missing roots and unreadable files are errors, never successful empty scans.
  for (const name of ['apps', 'packages']) await visit(resolve(root, name));
  return findings.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const findings = await checkSuppressedErrors(fileURLToPath(new URL('../', import.meta.url)));
    if (findings.length) {
      console.error(`FAIL: TypeScript suppressions in production source:\n${findings.join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log('PASS: No unapproved TypeScript suppressions in production source.');
    }
  } catch (error) {
    console.error('FAIL: Could not complete TypeScript suppression scan.', error.message);
    process.exitCode = 1;
  }
}

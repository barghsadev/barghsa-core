import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function relatedTestPlan(changes) {
  const plan = new Map();
  for (const [status, path] of changes) {
    if (status !== 'A' && status !== 'M') return null;
    if (
      (path.startsWith('docs/') && path.endsWith('.md')) ||
      path === 'kanban/board.json' ||
      path === 'kanban/BOARD.md'
    )
      continue;

    const test = /^apps\/(api|web|worker)\/(src\/.+\.(?:test|spec)\.tsx?)$/.exec(path);
    if (!test) return null;
    const [, app, file] = test;
    if (!plan.has(app)) plan.set(app, []);
    plan.get(app).push(file);
  }
  return plan.size ? plan : null;
}

export function verifyChangedTestsRan(report, root, files) {
  const passed = new Set(
    report.testResults
      .filter((result) => result.assertionResults.some((test) => test.status === 'passed'))
      .map((result) => resolve(root, result.name))
  );
  for (const file of files) {
    if (!passed.has(resolve(root, file)))
      throw new Error(`No passing test ran in changed file ${file}`);
  }
}

function selectBase(ref) {
  if (!ref) return undefined;
  const result = spawnSync(
    'git',
    ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
    {
      encoding: 'utf8',
    }
  );
  if (result.status !== 0) return undefined;
  const base = result.stdout.trim();
  if (spawnSync('git', ['merge-base', '--is-ancestor', base, 'HEAD']).status !== 0)
    return undefined;
  return base;
}

function changedPaths(base) {
  const fields = execFileSync(
    'git',
    ['diff', '--name-status', '--no-renames', '-z', base, 'HEAD'],
    {
      encoding: 'utf8',
    }
  ).split('\0');
  if (fields.pop() !== '' || fields.length % 2 !== 0) throw new Error('Invalid Git diff record');
  const changes = [];
  for (let i = 0; i < fields.length; i += 2) changes.push([fields[i], fields[i + 1]]);
  return changes;
}

function runRelated(plan) {
  const directory = mkdtempSync(join(tmpdir(), 'barghsa-related-tests-'));
  try {
    for (const [app, files] of plan) {
      const output = join(directory, `${app}.json`);
      console.log(
        `Running related Vitest cases for @barghsa/${app} (${files.length} changed files).`
      );
      execFileSync(
        'pnpm',
        [
          '--filter',
          `@barghsa/${app}`,
          'exec',
          'vitest',
          'related',
          '--run',
          '--reporter=default',
          '--reporter=json',
          `--outputFile=${output}`,
          ...files,
        ],
        { stdio: 'inherit' }
      );
      verifyChangedTestsRan(JSON.parse(readFileSync(output, 'utf8')), `apps/${app}`, files);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const base = selectBase(process.argv[2]);
  const plan = base && relatedTestPlan(changedPaths(base));
  if (plan) {
    runRelated(plan);
  } else {
    const filters = base ? [`--filter=...[${base}]`] : [];
    execFileSync(
      'pnpm',
      ['turbo', 'run', 'test', '--only', '--force', '--concurrency=2', ...filters],
      {
        stdio: 'inherit',
      }
    );
  }
}

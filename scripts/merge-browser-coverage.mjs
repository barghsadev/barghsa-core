import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import coverageLibrary from 'istanbul-lib-coverage';

export async function mergeBrowserCoverage({ root, report, headSha }) {
  if (
    report.schema_version !== 1 ||
    report.status !== 'mapped' ||
    report.head_sha !== headSha ||
    report.working_tree_dirty !== false ||
    !report.coverage ||
    typeof report.coverage !== 'object' ||
    !Object.keys(report.coverage).length
  )
    throw new Error('Browser coverage is missing, dirty or belongs to a different revision');
  const packages = new Map();
  for (const [filename, entry] of Object.entries(report.coverage)) {
    const path = resolve(filename);
    if (!path.startsWith(resolve(root) + sep)) throw new Error('Coverage source outside checkout');
    const relative = path.slice(resolve(root).length + 1);
    if (!/^(apps\/web|packages\/(ui|shared|i18n))\/src\//.test(relative) || entry.path !== path)
      throw new Error('Invalid browser source path');
    const packagePath = relative.split('/').slice(0, 2).join('/');
    if (!packages.has(packagePath)) {
      const target = resolve(root, packagePath, 'coverage/coverage-final.json');
      const unit = JSON.parse(await readFile(target, 'utf8'));
      if (!unit || Array.isArray(unit) || typeof unit !== 'object' || !Object.keys(unit).length)
        throw new Error('Missing package unit coverage');
      packages.set(packagePath, { target, coverage: coverageLibrary.createCoverageMap(unit) });
    }
    packages.get(packagePath).coverage.merge({ [path]: entry });
  }
  // Validate all inputs before replacing any package report.
  for (const { target, coverage } of packages.values()) {
    await writeFile(target, JSON.stringify(coverage.toJSON()) + '\n');
  }
  return [...packages.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Browser coverage report path required');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const headSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  console.log('Merged browser coverage:', await mergeBrowserCoverage({ root, report, headSha }));
}

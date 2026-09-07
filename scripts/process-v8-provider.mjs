import { createCoverageMap } from 'istanbul-lib-coverage';
import { alignProcessBranches } from './align-process-coverage.mjs';
import { V8CoverageProvider } from '@vitest/coverage-v8/dist/provider.js';
import { mergeProcessCovs } from '@bcoe/v8-coverage';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export class ProcessV8CoverageProvider extends V8CoverageProvider {
  environmentKey = 'BARGHSA_HTTP_COVERAGE_DIR';
  compiledDirectory = 'dist/src';
  processLabel = 'HTTP';

  initialize(ctx) {
    super.initialize(ctx);
    this.processDirectory = resolve(this.options.reportsDirectory, 'process-v8');
    process.env[this.environmentKey] = this.processDirectory;
    ctx.config.env = { ...ctx.config.env, [this.environmentKey]: this.processDirectory };
  }

  async clean(clean = true) {
    await super.clean(clean);
    await rm(this.processDirectory, { recursive: true, force: true });
    await mkdir(this.processDirectory, { recursive: true });
  }

  async generateCoverage(options) {
    const coverage = await super.generateCoverage(options);
    const files = (await readdir(this.processDirectory)).filter((name) => name.endsWith('.json'));
    const compiledRoot = resolve(this.ctx.config.root, this.compiledDirectory) + sep;
    let merged = { result: [] };
    for (const file of files) {
      const data = JSON.parse(await readFile(resolve(this.processDirectory, file), 'utf8'));
      data.result = data.result.filter(
        (entry) =>
          entry.url.startsWith('file:') && fileURLToPath(entry.url).startsWith(compiledRoot)
      );
      merged = mergeProcessCovs([merged, data]);
    }
    for (const entry of merged.result) {
      const filename = fileURLToPath(entry.url);
      const code = await readFile(filename, 'utf8');
      // Production compilers emit external maps pointing to the original TypeScript.
      // A missing map is an error, never a silently omitted process path.
      const map = JSON.parse(await readFile(filename + '.map', 'utf8'));
      map.sources = map.sources.map((source) => new URL(source, entry.url).href);
      if (!map.sources.some((source) => this.isIncluded(fileURLToPath(source)))) continue;
      const mapped = createCoverageMap(
        await this.remapCoverage(entry.url, 0, { code, map }, entry.functions)
      );
      for (const source of mapped.files()) {
        const incoming = mapped.fileCoverageFor(source).toJSON();
        const existing = coverage.files().includes(source)
          ? coverage.fileCoverageFor(source).toJSON()
          : null;
        coverage.addFileCoverage(existing ? alignProcessBranches(existing, incoming) : incoming);
      }
    }
    coverage.filter((filename) => this.isIncluded(filename));
    this.ctx.logger.log(
      `Merged ${files.length} ${this.processLabel}-process coverage files (${merged.result.length} compiled modules)`
    );
    return coverage;
  }
}

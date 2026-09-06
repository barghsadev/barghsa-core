import { V8CoverageProvider } from '@vitest/coverage-v8/dist/provider.js';
import { mergeProcessCovs } from '@bcoe/v8-coverage';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export class HttpV8CoverageProvider extends V8CoverageProvider {
  initialize(ctx) {
    super.initialize(ctx);
    this.httpDirectory = resolve(this.options.reportsDirectory, 'http-v8');
    process.env.BARGHSA_HTTP_COVERAGE_DIR = this.httpDirectory;
    ctx.config.env = { ...ctx.config.env, BARGHSA_HTTP_COVERAGE_DIR: this.httpDirectory };
  }

  async clean(clean = true) {
    await super.clean(clean);
    await rm(this.httpDirectory, { recursive: true, force: true });
    await mkdir(this.httpDirectory, { recursive: true });
  }

  async generateCoverage(options) {
    const coverage = await super.generateCoverage(options);
    const files = (await readdir(this.httpDirectory)).filter((name) => name.endsWith('.json'));
    const compiledRoot = resolve(this.ctx.config.root, 'dist/src') + sep;
    let merged = { result: [] };
    for (const file of files) {
      const data = JSON.parse(await readFile(resolve(this.httpDirectory, file), 'utf8'));
      data.result = data.result.filter(
        (entry) =>
          entry.url.startsWith('file:') && fileURLToPath(entry.url).startsWith(compiledRoot)
      );
      merged = mergeProcessCovs([merged, data]);
    }
    for (const entry of merged.result) {
      const filename = fileURLToPath(entry.url);
      const code = await readFile(filename, 'utf8');
      // Production SWC output has external maps containing the original TS.
      // A missing map is an error, never a silently omitted HTTP path.
      const map = JSON.parse(await readFile(filename + '.map', 'utf8'));
      map.sources = map.sources.map((source) => new URL(source, entry.url).href);
      if (!map.sources.some((source) => this.isIncluded(fileURLToPath(source)))) continue;
      coverage.merge(await this.remapCoverage(entry.url, 0, { code, map }, entry.functions));
    }
    coverage.filter((filename) => this.isIncluded(filename));
    this.ctx.logger.log(
      `Merged ${files.length} HTTP-process coverage files (${merged.result.length} compiled modules)`
    );
    return coverage;
  }
}

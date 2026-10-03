import assert from 'node:assert/strict';
import { on } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const config = require('nodemon/lib/config');
const { rulesToMonitor } = require('nodemon/lib/monitor/match');
const { watch, resetWatchers } = require('nodemon/lib/monitor/watch');
const { bus } = require('nodemon/lib/utils');
const projectConfig = JSON.parse(await readFile(new URL('../nodemon.json', import.meta.url)));

async function restartFor(file) {
  // Native filesystems may emit more than one event for an earlier write.
  for await (const [files] of on(bus, 'restart', { signal: AbortSignal.timeout(5000) })) {
    if (files.includes(file)) return files;
  }
  throw new Error(`Watcher stopped before reporting ${file}`);
}

for (const polling of [false, true]) {
  test(`nodemon preserves recursive changes and ignored outputs with polling=${polling}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'barghsa-watch-'));
    const source = join(root, 'apps/api/src/main.ts');
    const environment = join(root, '.env');
    const ignored = [
      'apps/api/node_modules/dependency/index.js',
      'apps/api/dist/src/main.js',
      'apps/web/dist-coverage/index.js',
      'apps/web/coverage/output.json',
      'packages/ui/.turbo/cache.json',
      'apps/api/.build-cjs-test/index.js',
      'packages/ui/tsconfig.tsbuildinfo',
      'apps/web/test-results/trace.json',
      'apps/web/playwright-report/index.html',
      'packages/ui/.distribution-test/consumer.mts',
      'apps/web/src/routeTree.gen.ts',
    ].map((file) => join(root, file));
    const put = async (file, text) => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text);
    };
    let restarts = 0;
    const onRestart = () => restarts++;
    try {
      await put(source, 'initial');
      await put(environment, 'initial');
      await mkdir(join(root, 'packages'), { recursive: true });
      await mkdir(join(root, 'scripts'), { recursive: true });
      for (const file of ignored) await put(file, 'initial');
      config.dirs = [];
      config.options = {
        ignore: projectConfig.ignore,
        legacyWatch: polling,
        pollingInterval: 20,
        watchOptions: { binaryInterval: 20 },
        delay: 0,
        quiet: true,
        execOptions: { ext: projectConfig.ext },
        monitor: rulesToMonitor(
          ['apps', 'packages', 'scripts', '.env'].map((file) => join(root, file)),
          projectConfig.ignore,
          config
        ),
      };
      const watched = await watch();
      assert.ok(watched.includes(source));
      assert.ok(watched.includes(environment));
      for (const file of ignored) assert.ok(!watched.includes(file), `must not watch ${file}`);
      bus.on('restart', onRestart);
      for (const file of ignored) await put(file, 'changed');
      await setTimeout(200);
      assert.equal(restarts, 0, 'generated output must not cause restart loops');

      const changed = restartFor(source);
      await put(source, 'changed source');
      assert.deepEqual(await changed, [source]);

      const envChanged = restartFor(environment);
      await put(environment, 'changed environment');
      assert.deepEqual(await envChanged, [environment]);

      const nested = join(root, 'apps/api/src/new/module.ts');
      const added = restartFor(nested);
      await put(nested, 'new source');
      assert.deepEqual(await added, [nested]);
    } finally {
      bus.off('restart', onRestart);
      resetWatchers();
      await rm(root, { recursive: true, force: true });
    }
  });
}

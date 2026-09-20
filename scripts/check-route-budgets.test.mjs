import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { checkBudgets, measureRoute, verifyWithSizeLimit } from './check-route-budgets.mjs';

test('auth budgets measure the served auth build and retain its asset paths', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'barghsa-auth-budget-'));
  try {
    for (const build of ['', 'auth']) {
      await mkdir(join(dist, build, '.vite'), { recursive: true });
      await writeFile(
        join(dist, build, '.vite/manifest.json'),
        JSON.stringify({
          'index.html': { file: 'entry.js' },
          login: { file: 'login.js' },
        })
      );
      await writeFile(
        join(dist, build, 'entry.js'),
        build ? 'export const auth=1;' : randomBytes(3000)
      );
      await writeFile(join(dist, build, 'login.js'), 'export const login=1;');
    }
    const rule = { name: 'Login', entries: ['login'], limitKB: 1, build: 'auth' };
    const results = await checkBudgets(dist, [rule]);
    assert.equal(results[0].pass, true);
    assert.deepEqual(results[0].files, ['auth/entry.js', 'auth/login.js']);
    await writeFile(join(dist, 'auth/entry.js'), randomBytes(3000));
    assert.equal((await checkBudgets(dist, [rule]))[0].pass, false);
    await assert.rejects(
      checkBudgets(dist, [{ ...rule, build: '../outside' }]),
      /Invalid budget build/
    );
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test('common dependencies count once, an oversized common chunk fails, and missing routes fail closed', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'barghsa-budget-'));
  try {
    await mkdir(join(dist, '.vite'));
    const manifest = {
      'index.html': { file: 'entry.js', imports: ['common'] },
      login: { file: 'login.js', imports: ['common', 'index.html'] },
      common: { file: 'common.js' },
    };
    const contents = {
      'entry.js': 'export const entry=1;',
      'login.js': 'export const login=1;',
      'common.js': 'export const common=1;',
    };
    for (const [file, content] of Object.entries(contents))
      await writeFile(join(dist, file), content);
    await writeFile(join(dist, '.vite/manifest.json'), JSON.stringify(manifest));
    const measured = await measureRoute(dist, manifest, ['login']);
    assert.equal(
      measured.bytes,
      Object.values(contents).reduce((sum, content) => sum + gzipSync(content).length, 0)
    );
    const rules = [{ name: 'login', entries: ['login'], limitKB: 1 }];
    const passing = await checkBudgets(dist, rules);
    assert.equal(passing[0].pass, true);
    await verifyWithSizeLimit(dist, passing);
    await writeFile(join(dist, 'common.js'), randomBytes(3000));
    const failing = await checkBudgets(dist, rules);
    assert.equal(failing[0].pass, false);
    await assert.rejects(verifyWithSizeLimit(dist, failing), /Size Limit rejected route budgets/);
    await assert.rejects(measureRoute(dist, manifest, ['missing']), /Missing manifest entry/);
    await rm(join(dist, 'common.js'));
    await assert.rejects(verifyWithSizeLimit(dist, passing), /Unavailable Size Limit asset/);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test('interaction code has its own gate and cannot be hidden when imported eagerly', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'barghsa-interaction-budget-'));
  try {
    await mkdir(join(dist, '.vite'));
    const manifest = {
      'index.html': { file: 'entry.js' },
      register: { file: 'register.js', dynamicImports: ['strength'] },
      strength: { file: 'strength.js', imports: ['dictionary'] },
      dictionary: { file: 'dictionary.js' },
    };
    for (const name of ['entry', 'register', 'strength'])
      await writeFile(join(dist, `${name}.js`), `export const ${name}=1;`);
    await writeFile(join(dist, 'dictionary.js'), randomBytes(3000));
    const saveManifest = () =>
      writeFile(join(dist, '.vite/manifest.json'), JSON.stringify(manifest));
    await saveManifest();
    const rules = [
      { name: 'registration', entries: ['register'], limitKB: 1 },
      { name: 'estimator', entries: ['strength'], phase: 'interaction', limitKB: 4 },
    ];
    const pass = await checkBudgets(dist, rules);
    assert.deepEqual(
      pass.map((row) => row.pass),
      [true, true]
    );
    assert.deepEqual(pass[0].files, ['entry.js', 'register.js']);
    assert.deepEqual(pass[1].files, ['dictionary.js', 'strength.js']);
    await verifyWithSizeLimit(dist, pass);
    const tooLarge = await checkBudgets(dist, [rules[0], { ...rules[1], limitKB: 1 }]);
    assert.deepEqual(
      tooLarge.map((row) => row.pass),
      [true, false]
    );
    await assert.rejects(verifyWithSizeLimit(dist, tooLarge), /Size Limit rejected route budgets/);
    manifest.register.imports = ['strength'];
    await saveManifest();
    assert.equal((await checkBudgets(dist, rules))[0].pass, false);
    delete manifest.strength;
    await saveManifest();
    await assert.rejects(checkBudgets(dist, rules), /Missing manifest entry/);
    await assert.rejects(
      checkBudgets(dist, [{ ...rules[0], phase: 'typo' }]),
      /Invalid budget phase/
    );
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

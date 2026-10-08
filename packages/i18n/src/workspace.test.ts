import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fa, en } from './workspace-admin-messages.js';
import { fa as fullFa, en as fullEn, t as fullText } from './admin-ui.js';
import { tWorkspace } from './workspace-admin.js';

it('retains every admin message prefix referenced by workspace callers', () => {
  const prefixes = new Set<string>();
  function scan(directory: URL) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(entry.name, directory);
      if (entry.isDirectory()) scan(new URL(`${entry.name}/`, directory));
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
        const source = readFileSync(path, 'utf8');
        if (!source.includes('@barghsa/i18n/workspace-admin')) continue;
        for (const match of source.matchAll(/['"`]([a-z][\w]*(?:\.[\w-]*)+)/g))
          prefixes.add(match[1]!);
      }
    }
  }
  scan(new URL('../../../apps/web/src/', import.meta.url));
  expect(prefixes.size).toBeGreaterThan(0);
  for (const key of Object.keys(fullEn)) {
    if (![...prefixes].some((prefix) => key.startsWith(prefix))) continue;
    expect(en[key], key).toBe(fullEn[key]);
    expect(fa[key], key).toBe(fullFa[key]);
  }
});

for (const locale of ['fa', 'en'] as const)
  it(`keeps scoped values, inherited messages and unknown keys intact in ${locale}`, () => {
    expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) expect(tWorkspace(key, locale)).toBe(fullText(key, locale));
    for (const key of ['common.loading', 'crm.title', 'constructor', '__proto__', 'missing.key'])
      expect(tWorkspace(key, locale)).toBe(fullText(key, locale));
  });

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { prepareLiaraMigrations } = require('./run-liara-migrations.cjs');

test('Liara variant changes only migration 0210 and keeps a stable hash', () => {
  const source = path.resolve(__dirname, '../packages/db/drizzle/production');
  const first = mkdtempSync(path.join(tmpdir(), 'barghsa-liara-test-'));
  const second = mkdtempSync(path.join(tmpdir(), 'barghsa-liara-test-'));
  try {
    prepareLiaraMigrations(source, first);
    prepareLiaraMigrations(source, second);
    const name = '0210_knowledge_base_foundation.sql';
    const original = readFileSync(path.join(source, name), 'utf8');
    const variant = readFileSync(path.join(first, name), 'utf8');
    assert.match(original, /USING hnsw/);
    assert.doesNotMatch(variant, /USING hnsw/);
    assert.match(variant, /CREATE TABLE "kb_chunks"/);
    assert.equal(variant, readFileSync(path.join(second, name), 'utf8'));
    assert.equal(
      readFileSync(path.join(first, '0209_ai_model_management.sql'), 'utf8'),
      readFileSync(path.join(source, '0209_ai_model_management.sql'), 'utf8')
    );
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

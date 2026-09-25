// Keep canonical migration SQL immutable. Liara's pgvector lacks HNSW, so
// prepare a deterministic provider variant for this fresh managed database.
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const indexSql = 'CREATE INDEX "idx_kb_chunks_embedding" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;';
const replacement = '-- Liara pgvector has no HNSW access method. Exact vector search remains available.\nSELECT 1;';

function prepareLiaraMigrations(source, destination) {
  mkdirSync(path.join(destination, 'meta'));
  symlinkSync(path.join(source, 'meta/_journal.json'), path.join(destination, 'meta/_journal.json'));
  for (const file of readdirSync(source).filter((name) => name.endsWith('.sql'))) {
    const from = path.join(source, file);
    const to = path.join(destination, file);
    if (file !== '0210_knowledge_base_foundation.sql') {
      symlinkSync(from, to);
      continue;
    }
    const sql = readFileSync(from, 'utf8');
    if (sql.split(indexSql).length !== 2) throw new Error('Expected one HNSW index in migration 0210');
    writeFileSync(to, sql.replace(indexSql, replacement));
  }
}

if (require.main === module) {
  const dbDirectory = path.dirname(require.resolve('@barghsa/db'));
  const folder = mkdtempSync(path.join(tmpdir(), 'barghsa-liara-migrations-'));
  try {
    prepareLiaraMigrations(path.join(dbDirectory, '../drizzle/production'), folder);
    const result = spawnSync(process.execPath, [path.join(dbDirectory, 'migrate.js')], {
      stdio: 'inherit',
      env: { ...process.env, BARGHSA_MIGRATIONS_FOLDER: folder },
    });
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

module.exports = { prepareLiaraMigrations };

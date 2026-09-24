import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import type { StorageProvider } from '@barghsa/shared/storage';
import type { EmbeddingClient } from '@barghsa/shared/ai-models';
import { runMigrations } from '../../../../packages/db/src/migrate';
import { runKnowledgeBaseProcessing } from './processing-runner.js';

const database = `test_kb_processing_${randomUUID().replaceAll('-', '')}`;
let management: Pool;
let pool: Pool;
const user = randomUUID();
const file = Buffer.from('Useful knowledge about meters and invoices. '.repeat(10));
const getObject = vi.fn(async (_key: string) => ({
  contentLength: file.length,
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(file);
      controller.close();
    },
  }),
}));
const storage = { getObject } as unknown as StorageProvider;
const vector = () => [1, ...Array(1535).fill(0)] as number[];

beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  const migration = await runMigrations({ connection: { pgdirectUrl: url.toString() } });
  if (!migration.ok) throw new Error(JSON.stringify(migration));
  pool = new Pool({ connectionString: url.toString() });
  await pool.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,$3)', [
    user,
    `${user}@test.local`,
    'hash',
  ]);
}, 40_000);
afterAll(async () => {
  await pool?.end();
  await management.query(`DROP DATABASE "${database}"`);
  await management.end();
});
beforeEach(async () => {
  getObject.mockClear();
  await pool.query('DELETE FROM knowledge_bases');
  await pool.query("DELETE FROM storage_records WHERE storage_key LIKE 'kb-test/%'");
});

async function seed() {
  const key = `kb-test/${randomUUID()}.txt`;
  await pool.query(
    "INSERT INTO storage_records(storage_key,status,file_name,metadata) VALUES($1,'active','guide.txt','{}'::jsonb)",
    [key]
  );
  const kb = (
    await pool.query<{ id: string }>(
      `INSERT INTO knowledge_bases(title,created_by,vector_embedding_model,chunking_strategy)
     VALUES('Meter guide',$1,'embed-1536','{"size":100,"overlap":10}'::jsonb) RETURNING id`,
      [user]
    )
  ).rows[0]!.id;
  await pool.query(
    'INSERT INTO kb_documents(kb_id,storage_key,file_name,created_by) VALUES($1,$2,$3,$4)',
    [kb, key, 'guide.txt', user]
  );
  return { kb, key };
}

it('extracts, chunks, embeds and publishes a ready KB with retrievable vectors', async () => {
  const { kb, key } = await seed();
  const embed = vi.fn(async (texts: string[]) => texts.map(vector));
  expect(await runKnowledgeBaseProcessing(pool, storage, { embed } as EmbeddingClient)).toBe(
    'ready'
  );
  expect(getObject).toHaveBeenCalledWith(key);
  expect(embed).toHaveBeenCalled();
  const state = (
    await pool.query('SELECT content_state,is_enabled FROM knowledge_bases WHERE id=$1', [kb])
  ).rows[0];
  expect(state).toEqual({ content_state: 'ready', is_enabled: false });
  const chunks = (
    await pool.query(
      'SELECT chunk_index,content,embedding IS NOT NULL AS embedded FROM kb_chunks WHERE kb_id=$1 ORDER BY chunk_index',
      [kb]
    )
  ).rows;
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => chunk.embedded && chunk.content.length <= 100)).toBe(true);
  expect(
    (await pool.query('SELECT processing_status FROM kb_documents WHERE kb_id=$1', [kb])).rows
  ).toEqual([{ processing_status: 'ready' }]);
  expect(await runKnowledgeBaseProcessing(pool, storage, { embed } as EmbeddingClient)).toBe(
    'idle'
  );
});

it('does not publish an old result after staff changes the KB during embedding', async () => {
  const { kb } = await seed();
  const embed = vi.fn(async (texts: string[]) => {
    await pool.query(
      "UPDATE knowledge_bases SET title='Changed',content_state='empty' WHERE id=$1",
      [kb]
    );
    return texts.map(vector);
  });
  expect(await runKnowledgeBaseProcessing(pool, storage, { embed } as EmbeddingClient)).toBe(
    'stale'
  );
  expect(
    (await pool.query('SELECT content_state FROM knowledge_bases WHERE id=$1', [kb])).rows
  ).toEqual([{ content_state: 'empty' }]);
  expect((await pool.query('SELECT id FROM kb_chunks WHERE kb_id=$1', [kb])).rows).toHaveLength(0);
});

it('does not publish content after its storage record becomes unavailable', async () => {
  const { kb, key } = await seed();
  const embed = vi.fn(async (texts: string[]) => {
    await pool.query("UPDATE storage_records SET status='removed' WHERE storage_key=$1", [key]);
    return texts.map(vector);
  });
  expect(await runKnowledgeBaseProcessing(pool, storage, { embed } as EmbeddingClient)).toBe(
    'error'
  );
  expect(
    (await pool.query('SELECT content_state,content_error FROM knowledge_bases WHERE id=$1', [kb]))
      .rows
  ).toEqual([{ content_state: 'error', content_error: 'kb_source_unavailable' }]);
  expect((await pool.query('SELECT id FROM kb_chunks WHERE kb_id=$1', [kb])).rows).toHaveLength(0);
});

it('records a safe error and failed document status when embedding fails', async () => {
  const { kb } = await seed();
  const embed = vi.fn(async () => {
    throw new Error('provider echoed sk-secret');
  });
  expect(
    await runKnowledgeBaseProcessing(pool, storage, { embed } as unknown as EmbeddingClient)
  ).toBe('error');
  expect(
    (await pool.query('SELECT content_state,content_error FROM knowledge_bases WHERE id=$1', [kb]))
      .rows
  ).toEqual([{ content_state: 'error', content_error: 'kb_processing_failed' }]);
  expect(
    (
      await pool.query(
        'SELECT processing_status,processing_error FROM kb_documents WHERE kb_id=$1',
        [kb]
      )
    ).rows
  ).toEqual([{ processing_status: 'failed', processing_error: 'kb_processing_failed' }]);
});

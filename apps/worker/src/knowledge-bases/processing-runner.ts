import type { Pool, PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import { OpenAiEmbeddingClient, type EmbeddingClient } from '@barghsa/shared/ai-models';
import { chunkText, documentText, webText } from './extraction.js';

export const KB_PROCESSING_INTERVAL_MS = 10_000;
export const KB_PROCESSING_JOB_TYPE = 'knowledge_base_processing';

interface Claim {
  id: string;
  revision: string;
  source_type: 'document' | 'url' | 'api';
  source_config: { urls?: string[]; apiUrl?: string };
  chunking_strategy: { size: number; overlap: number };
  vector_embedding_model: string | null;
}
interface DocumentRow {
  id: string;
  storage_key: string;
  file_name: string;
  status: string;
}
interface Passage {
  documentId: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

async function claimKb(pool: Pool): Promise<Claim | null> {
  const result = await pool.query<Claim>(
    `WITH candidate AS (
       SELECT kb.id FROM knowledge_bases kb
       WHERE (kb.content_state='empty' OR
              (kb.content_state='processing' AND kb.updated_at<NOW()-INTERVAL '5 minutes'))
         AND (kb.source_type<>'document' OR EXISTS
              (SELECT 1 FROM kb_documents d WHERE d.kb_id=kb.id))
       ORDER BY kb.updated_at,kb.id FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE knowledge_bases kb SET content_state='processing',content_error=NULL,updated_at=NOW()
     FROM candidate c WHERE kb.id=c.id
     RETURNING kb.id,kb.xmin::text AS revision,kb.source_type,kb.source_config,
               kb.chunking_strategy,kb.vector_embedding_model`
  );
  return result.rows[0] ?? null;
}

async function passagesFor(pool: Pool, storage: StorageProvider, kb: Claim): Promise<Passage[]> {
  const sources: Array<{
    text: string;
    documentId: string | null;
    metadata: Record<string, unknown>;
  }> = [];
  if (kb.source_type === 'document') {
    const docs = await pool.query<DocumentRow>(
      `SELECT d.id,d.storage_key,d.file_name,s.status
       FROM kb_documents d JOIN storage_records s ON s.storage_key=d.storage_key
       WHERE d.kb_id=$1 ORDER BY d.created_at,d.id`,
      [kb.id]
    );
    if (!docs.rows.length) throw new Error('kb_source_empty');
    for (const doc of docs.rows) {
      if (doc.status !== 'active' && doc.status !== 'immutable')
        throw new Error('kb_source_unavailable');
      sources.push({
        text: await documentText(storage, doc.storage_key, doc.file_name),
        documentId: doc.id,
        metadata: { sourceType: 'document', fileName: doc.file_name },
      });
    }
  } else {
    const urls = kb.source_type === 'url' ? kb.source_config.urls : [kb.source_config.apiUrl];
    if (!urls?.length || urls.length > 20 || urls.some((url) => !url))
      throw new Error('kb_source_empty');
    for (const url of urls) {
      const address = new URL(url!);
      sources.push({
        text: await webText(address.href),
        documentId: null,
        metadata: { sourceType: kb.source_type, url: `${address.origin}${address.pathname}` },
      });
    }
  }
  const passages: Passage[] = [];
  for (const source of sources) {
    for (const content of chunkText(
      source.text,
      kb.chunking_strategy.size,
      kb.chunking_strategy.overlap
    )) {
      passages.push({ documentId: source.documentId, content, metadata: source.metadata });
      if (passages.length > 500) throw new Error('kb_too_many_chunks');
    }
  }
  if (!passages.length) throw new Error('kb_source_empty');
  return passages;
}

async function saveReady(
  client: PoolClient,
  kb: Claim,
  passages: Passage[],
  embeddings: number[][]
) {
  await client.query('DELETE FROM kb_chunks WHERE kb_id=$1', [kb.id]);
  for (let offset = 0; offset < passages.length; offset += 25) {
    const batch = passages.slice(offset, offset + 25);
    const values: unknown[] = [];
    const rows = batch.map((passage, index) => {
      const i = offset + index;
      values.push(
        kb.id,
        passage.documentId,
        i,
        passage.content,
        JSON.stringify(embeddings[i]),
        JSON.stringify(passage.metadata)
      );
      const p = values.length;
      return `($${p - 5},$${p - 4},$${p - 3},$${p - 2},$${p - 1}::vector,$${p}::jsonb)`;
    });
    await client.query(
      `INSERT INTO kb_chunks(kb_id,document_id,chunk_index,content,embedding,metadata)
       VALUES ${rows.join(',')}`,
      values
    );
  }
  await client.query(
    "UPDATE kb_documents SET processing_status='ready',processing_error=NULL WHERE kb_id=$1",
    [kb.id]
  );
  await client.query(
    "UPDATE knowledge_bases SET content_state='ready',content_error=NULL WHERE id=$1",
    [kb.id]
  );
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Embedding provider is not configured') return 'kb_embedding_not_configured';
  return /^kb_[a-z0-9_]+$/.test(message) ? message : 'kb_processing_failed';
}

/** One bounded processing job; old runs cannot publish after an admin edit or lease takeover. */
export async function runKnowledgeBaseProcessing(
  pool: Pool,
  storage: StorageProvider,
  embedder: EmbeddingClient = new OpenAiEmbeddingClient()
): Promise<'idle' | 'ready' | 'error' | 'stale'> {
  const kb = await claimKb(pool);
  if (!kb) return 'idle';
  let passages: Passage[];
  let embeddings: number[][];
  try {
    if (!kb.vector_embedding_model) throw new Error('kb_embedding_model_missing');
    passages = await passagesFor(pool, storage, kb);
    embeddings = [];
    for (let offset = 0; offset < passages.length; offset += 32) {
      embeddings.push(
        ...(await embedder.embed(
          passages.slice(offset, offset + 32).map((passage) => passage.content),
          kb.vector_embedding_model
        ))
      );
    }
    if (embeddings.length !== passages.length) throw new Error('kb_embedding_count_mismatch');
    if (
      embeddings.some(
        (embedding) =>
          embedding.length !== 1536 ||
          !embedding.every(Number.isFinite) ||
          !embedding.some((value) => value !== 0)
      )
    )
      throw new Error('kb_embedding_invalid');
  } catch (error) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ revision: string }>(
        "SELECT xmin::text AS revision FROM knowledge_bases WHERE id=$1 AND content_state='processing' FOR UPDATE",
        [kb.id]
      );
      if (current.rows[0]?.revision !== kb.revision) {
        await client.query('ROLLBACK');
        return 'stale';
      }
      const reason = safeError(error);
      await client.query(
        "UPDATE knowledge_bases SET content_state='error',content_error=$2,is_enabled=false WHERE id=$1",
        [kb.id, reason]
      );
      await client.query(
        "UPDATE kb_documents SET processing_status='failed',processing_error=$2 WHERE kb_id=$1",
        [kb.id, reason]
      );
      await client.query('COMMIT');
      return 'error';
    } catch (failure) {
      await client.query('ROLLBACK');
      throw failure;
    } finally {
      client.release();
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ revision: string }>(
      "SELECT xmin::text AS revision FROM knowledge_bases WHERE id=$1 AND content_state='processing' FOR UPDATE",
      [kb.id]
    );
    if (current.rows[0]?.revision !== kb.revision) {
      await client.query('ROLLBACK');
      return 'stale';
    }
    if (kb.source_type === 'document') {
      const sources = await client.query<{ status: string }>(
        `SELECT s.status FROM kb_documents d JOIN storage_records s ON s.storage_key=d.storage_key
         WHERE d.kb_id=$1 FOR SHARE OF d,s`,
        [kb.id]
      );
      if (
        !sources.rows.length ||
        sources.rows.some(({ status }) => status !== 'active' && status !== 'immutable')
      ) {
        await client.query(
          "UPDATE knowledge_bases SET content_state='error',content_error='kb_source_unavailable',is_enabled=false WHERE id=$1",
          [kb.id]
        );
        await client.query(
          "UPDATE kb_documents SET processing_status='failed',processing_error='kb_source_unavailable' WHERE kb_id=$1",
          [kb.id]
        );
        await client.query('COMMIT');
        return 'error';
      }
    }
    await saveReady(client, kb, passages, embeddings);
    await client.query('COMMIT');
    return 'ready';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

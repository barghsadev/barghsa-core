import { guardedRequest } from './guarded-http.js';

export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingClient {
  embed(texts: string[], model: string): Promise<number[][]>;
}

/** OpenAI-compatible embeddings with a bounded, SSRF-guarded request. */
export class OpenAiEmbeddingClient implements EmbeddingClient {
  async embed(texts: string[], model: string): Promise<number[][]> {
    if (!texts.length || texts.length > 32 || !model.trim())
      throw new Error('Invalid embedding request');
    const base = process.env.KB_EMBEDDING_BASE_URL?.trim().replace(/\/+$/, '');
    if (!base) throw new Error('Embedding provider is not configured');
    const url = new URL(base);
    if (url.search || url.hash || url.username || url.password)
      throw new Error('Embedding provider URL is not allowed');
    const token = process.env.KB_EMBEDDING_API_KEY;
    const allowlist = (process.env.AI_MODEL_BASE_URL_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const response = await guardedRequest(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ model, input: texts, encoding_format: 'float' }),
      maxBytes: 2 * 1024 * 1024,
      allowHttp: allowlist.some(
        (host) => host.toLowerCase().replace(/\.$/, '') === url.hostname.toLowerCase()
      ),
      allowlist,
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error(`Embedding provider failed (HTTP ${response.status})`);
    let data: unknown;
    try {
      data = JSON.parse(response.body.toString('utf8'));
    } catch {
      throw new Error('Embedding provider returned invalid JSON');
    }
    const records = (data as { data?: unknown }).data;
    if (!Array.isArray(records) || records.length !== texts.length)
      throw new Error('Embedding provider returned an invalid vector count');
    const output = new Array<number[]>(texts.length);
    for (const entry of records) {
      const item = entry as { index?: unknown; embedding?: unknown };
      if (
        !Number.isInteger(item.index) ||
        Number(item.index) < 0 ||
        Number(item.index) >= texts.length ||
        !Array.isArray(item.embedding) ||
        item.embedding.length !== EMBEDDING_DIMENSIONS ||
        !item.embedding.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
        !item.embedding.some((value) => value !== 0)
      )
        throw new Error('Embedding provider returned an invalid vector');
      output[Number(item.index)] = item.embedding as number[];
    }
    for (let i = 0; i < texts.length; i++)
      if (!output[i]) throw new Error('Embedding provider omitted a vector');
    return output;
  }
}

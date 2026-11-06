import { chatRecord, readKnowledgeAnswer, type KnowledgeAnswer } from './assistant-chat.js';

/** Accept only a complete, matching receipt; interrupted text remains an unfinished draft. */
export async function readKnowledgeResponse(
  response: Response,
  signal: AbortSignal,
  onDelta: (text: string) => void
): Promise<KnowledgeAnswer> {
  if (response.status !== 200 || signal.aborted) throw new Error('Invalid answer response');
  if (response.headers.get('content-type')?.split(';')[0] !== 'text/event-stream') {
    const answer = readKnowledgeAnswer(await response.json());
    if (!answer || signal.aborted) throw new Error('Invalid answer');
    return answer;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing answer stream');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '',
    text = '',
    bytes = 0;
  let answer: KnowledgeAnswer | null = null;
  const abort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('Answer aborted');
      const part = await reader.read();
      bytes += part.value?.byteLength ?? 0;
      if (bytes > 256 * 1024 || signal.aborted) throw new Error('Invalid answer stream');
      buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const lines = buffer.slice(0, boundary.index).split(/\r?\n/);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (answer || lines.length !== 2 || !lines[1]?.startsWith('data: '))
          throw new Error('Invalid answer event');
        const data: unknown = JSON.parse(lines[1].slice(6));
        if (lines[0] === 'event: delta') {
          if (!chatRecord(data) || typeof data.text !== 'string' || !data.text.length)
            throw new Error('Invalid answer text');
          text += data.text;
          if (text.length > 8000) throw new Error('Answer too long');
          onDelta(text);
        } else if (lines[0] === 'event: complete') {
          answer = readKnowledgeAnswer(data);
          if (!answer || !text || answer.reply !== text) throw new Error('Mismatched answer');
        } else throw new Error('Unknown answer event');
      }
      if (part.done) break;
    }
    if (buffer || !answer || signal.aborted) throw new Error('Incomplete answer');
    return answer;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

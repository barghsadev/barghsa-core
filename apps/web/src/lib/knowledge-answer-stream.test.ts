import { expect, it } from 'vitest';
import { readKnowledgeResponse } from './knowledge-answer-stream.js';

const answer = {
  reply: 'راهنما 🌱\nPublished guide.',
  sources: [
    {
      kbId: '01900000-0000-7000-8000-000000000001',
      title: 'Guide',
      documentTitle: null,
      excerpt: 'Published',
    },
  ],
  attribution: 'retrieved_context',
  remainingQuota: 4,
  policyChecks: [],
  answeredAt: '2026-11-06T10:00:00Z',
};
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const wire = event('delta', { text: answer.reply }) + event('complete', answer);
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        // Split every UTF-8 sequence and event boundary across reads.
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }
  );
}
it('reads split UTF-8 and CRLF frames and requires exact final text and metadata', async () => {
  const deltas: string[] = [];
  expect(
    await readKnowledgeResponse(
      response(wire.replaceAll('\n', '\r\n')),
      new AbortController().signal,
      (text) => deltas.push(text)
    )
  ).toEqual(answer);
  expect(deltas).toEqual([answer.reply]);
});
it.each([
  event('delta', { text: answer.reply }),
  wire.slice(0, -1),
  event('delta', { text: 'Different' }) + event('complete', answer),
  event('complete', answer),
  wire + event('delta', { text: 'Unconfirmed extra text' }),
  event('unknown', { text: answer.reply }),
  event('delta', { text: 'x'.repeat(8001) }),
  event('delta', { text: answer.reply }) + event('complete', { ...answer, sources: [] }),
])('refuses an incomplete, mismatched or invalid answer stream %#', async (text) => {
  await expect(
    readKnowledgeResponse(response(text), new AbortController().signal, () => {})
  ).rejects.toThrow();
});
it('cancels a pending reader on scope withdrawal without accepting its receipt', async () => {
  const abort = new AbortController();
  let cancelled = false;
  const pending = readKnowledgeResponse(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } }
    ),
    abort.signal,
    () => {}
  );
  abort.abort();
  await expect(pending).rejects.toThrow();
  expect(cancelled).toBe(true);
});
it('retains validated JSON compatibility during a rolling deployment', async () => {
  expect(
    await readKnowledgeResponse(Response.json(answer), new AbortController().signal, () => {
      throw new Error('No JSON deltas');
    })
  ).toEqual(answer);
});

it('never renders text from an unexpected successful status', async () => {
  const unexpected = new Response(wire, {
    status: 201,
    headers: { 'content-type': 'text/event-stream' },
  });
  await expect(
    readKnowledgeResponse(unexpected, new AbortController().signal, () => {
      throw new Error('Unexpected text was rendered');
    })
  ).rejects.toThrow('Invalid answer response');
});

it.each([Uint8Array.of(255), new Uint8Array(256 * 1024 + 1)])(
  'refuses invalid UTF-8 or an oversized wire response %#',
  async (bytes) => {
    await expect(
      readKnowledgeResponse(
        new Response(bytes, { headers: { 'content-type': 'text/event-stream' } }),
        new AbortController().signal,
        () => {}
      )
    ).rejects.toThrow();
  }
);

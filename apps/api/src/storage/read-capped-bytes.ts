export async function readCappedBytes(
  body: unknown,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const web = asWebReadableStream(body)
  if (web) return readWebStreamCapped(web, maxBytes)
  if (isAsyncIterable(body)) return readAsyncIterableCapped(body, maxBytes)
  throw new TypeError('Storage object body is not readable')
}

function asWebReadableStream(body: unknown): ReadableStream<Uint8Array> | null {
  if (body && typeof body === 'object') {
    const candidate = body as {
      getReader?: unknown
      transformToWebStream?: () => ReadableStream<Uint8Array>
    }
    if (typeof candidate.getReader === 'function') {
      return body as ReadableStream<Uint8Array>
    }
    if (typeof candidate.transformToWebStream === 'function') {
      return candidate.transformToWebStream()
    }
  }
  return null
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array | Buffer | string> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  )
}

async function readWebStreamCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      total += value.byteLength
      if (total > maxBytes) {
        truncated = true
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return { bytes: concatBytes(chunks, truncated ? maxBytes + 1 : total), truncated }
}

async function readAsyncIterableCapped(
  body: AsyncIterable<Uint8Array | Buffer | string>,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for await (const chunk of body) {
    const bytes = toUint8Array(chunk)
    chunks.push(bytes)
    total += bytes.byteLength
    if (total > maxBytes) {
      truncated = true
      break
    }
  }
  return { bytes: concatBytes(chunks, truncated ? maxBytes + 1 : total), truncated }
}

function toUint8Array(chunk: Uint8Array | Buffer | string): Uint8Array {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk)
  return chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, total - offset)
    if (take <= 0) break
    out.set(chunk.subarray(0, take), offset)
    offset += take
    if (offset >= total) break
  }
  return out
}

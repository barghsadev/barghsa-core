import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import yauzl from 'yauzl';
import type { StorageProvider } from '@barghsa/shared/storage';
import { guardedRequest } from '@barghsa/shared/ai-models';

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;

function clean(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t \u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function xmlText(xml: string): string {
  return xml
    .replace(/<\/(?:w:p|row|si|c)>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_, hex: string, decimal: string) =>
      String.fromCodePoint(Number.parseInt(hex || decimal, hex ? 16 : 10))
    )
    .replace(
      /&(?:amp|lt|gt|quot|apos);/g,
      (entity) =>
        ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity] ?? entity
    );
}

async function zipXml(
  bytes: Buffer,
  match: (name: string) => boolean
): Promise<Map<string, string>> {
  if (!bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')))
    throw new Error('kb_invalid_archive');
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, file) =>
      error || !file ? reject(error ?? new Error('kb_invalid_archive')) : resolve(file)
    )
  );
  const files = new Map<string, string>();
  let entries = 0;
  let total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        entries++;
        if (entries > 500) return reject(new Error('kb_archive_too_complex'));
        if (!match(entry.fileName)) return zip.readEntry();
        total += entry.uncompressedSize;
        if (entry.uncompressedSize > MAX_SOURCE_BYTES || total > MAX_SOURCE_BYTES)
          return reject(new Error('kb_archive_too_large'));
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error ?? new Error('kb_archive_unavailable'));
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_SOURCE_BYTES) stream.destroy(new Error('kb_archive_too_large'));
            else chunks.push(chunk);
          });
          stream.on('error', reject);
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return files;
}

async function pdfText(bytes: Buffer): Promise<string> {
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('kb_invalid_pdf');
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const timeout = setTimeout(() => void loading.destroy(), 15_000);
  try {
    const document = await loading.promise;
    if (document.numPages > 100) throw new Error('kb_pdf_too_many_pages');
    let text = '';
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      text += content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('');
      page.cleanup();
      if (text.length > MAX_TEXT_CHARS) throw new Error('kb_text_too_large');
    }
    return text;
  } finally {
    clearTimeout(timeout);
    await loading.destroy();
  }
}

function xlsxText(files: Map<string, string>): string {
  const shared = [
    ...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g),
  ].map((match) => xmlText(match[1] ?? ''));
  const sheets = [...files.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b));
  if (!sheets.length) throw new Error('kb_invalid_spreadsheet');
  return sheets
    .map(([name, xml]) => {
      const cells = [...xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map((match) => {
        const body = match[2] ?? '';
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
        return /\bt="s"/.test(match[1] ?? '')
          ? (shared[Number(value)] ?? '')
          : xmlText(value || body);
      });
      return `${name}\n${cells.join(' ')}`;
    })
    .join('\n');
}

export async function documentText(
  storage: StorageProvider,
  key: string,
  fileName: string
): Promise<string> {
  const object = await storage.getObject(key);
  if (object.contentLength && object.contentLength > MAX_SOURCE_BYTES)
    throw new Error('kb_source_too_large');
  const reader = object.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SOURCE_BYTES) throw new Error('kb_source_too_large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  const extension = fileName.toLowerCase().split('.').pop();
  let text: string;
  if (extension === 'txt' || extension === 'csv')
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  else if (extension === 'pdf') text = await pdfText(bytes);
  else if (extension === 'docx') {
    const files = await zipXml(
      bytes,
      (name) => name === '[Content_Types].xml' || name === 'word/document.xml'
    );
    const xml = files.get('word/document.xml');
    if (!xml || !files.has('[Content_Types].xml')) throw new Error('kb_invalid_docx');
    text = xmlText(xml);
  } else if (extension === 'xlsx') {
    const files = await zipXml(
      bytes,
      (name) =>
        name === '[Content_Types].xml' ||
        name === 'xl/sharedStrings.xml' ||
        /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
    );
    if (!files.has('[Content_Types].xml')) throw new Error('kb_invalid_spreadsheet');
    text = xlsxText(files);
  } else throw new Error('kb_unsupported_file_type');
  const normalized = clean(text);
  if (!normalized || normalized.length > MAX_TEXT_CHARS)
    throw new Error('kb_text_empty_or_too_large');
  return normalized;
}

export async function webText(url: string): Promise<string> {
  const response = await guardedRequest(url, {
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 15_000,
    headers: { accept: 'text/html,text/plain,application/json' },
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error(`kb_source_http_${response.status}`);
  const mime = String(response.headers['content-type'] ?? '')
    .split(';')[0]!
    .toLowerCase();
  if (!['text/html', 'text/plain', 'application/json'].includes(mime))
    throw new Error('kb_source_content_type');
  let text = new TextDecoder('utf-8', { fatal: true }).decode(response.body);
  if (mime === 'text/html')
    text = xmlText(
      text
        .replace(/<(script|style|nav|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\/(?:p|div|li|h[1-6])>/gi, '\n')
    );
  const normalized = clean(text);
  if (!normalized || normalized.length > MAX_TEXT_CHARS)
    throw new Error('kb_text_empty_or_too_large');
  return normalized;
}

export function chunkText(text: string, size: number, overlap: number): string[] {
  if (
    !Number.isInteger(size) ||
    size < 100 ||
    size > 4000 ||
    !Number.isInteger(overlap) ||
    overlap < 0 ||
    overlap >= size
  )
    throw new Error('kb_invalid_chunking');
  const chars = Array.from(clean(text));
  const chunks: string[] = [];
  for (let start = 0; start < chars.length; start += size - overlap) {
    const content = chars
      .slice(start, start + size)
      .join('')
      .trim();
    if (content) chunks.push(content);
    if (chunks.length > 500) throw new Error('kb_too_many_chunks');
    if (start + size >= chars.length) break;
  }
  return chunks;
}

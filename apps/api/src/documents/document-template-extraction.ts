import { BadRequestException } from '@nestjs/common';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import yauzl from 'yauzl';

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export type TemplateMime = typeof PDF_MIME | typeof DOCX_MIME;
export type PlaceholderOccurrence = { name: string; context: string };
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_.-]{0,63})\s*\}\}/g;

export function templateMime(name: string, declared: string): TemplateMime {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'pdf' && [PDF_MIME, 'application/octet-stream', ''].includes(declared))
    return PDF_MIME;
  if (
    extension === 'docx' &&
    [DOCX_MIME, 'application/zip', 'application/octet-stream', ''].includes(declared)
  )
    return DOCX_MIME;
  throw new BadRequestException('Only PDF and DOCX template files are accepted');
}

function occurrences(text: string): PlaceholderOccurrence[] {
  const normalized = text.replace(/\s+/g, ' ');
  const found: PlaceholderOccurrence[] = [];
  for (const match of normalized.matchAll(PLACEHOLDER)) {
    if (found.length >= 500) throw new BadRequestException('Too many template placeholders');
    const start = match.index;
    const context = normalized.slice(Math.max(0, start - 32), start + match[0].length + 32).trim();
    found.push({ name: match[1]!, context });
  }
  return found;
}

function decodeXml(xml: string): string {
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_, hex: string, decimal: string) =>
      String.fromCodePoint(Number.parseInt(hex || decimal, hex ? 16 : 10))
    )
    .replace(
      /&(?:amp|lt|gt|quot|apos);/g,
      (value) =>
        ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[value] ?? value
    );
}

async function docxText(bytes: Buffer): Promise<string> {
  if (!bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')))
    throw new BadRequestException('Invalid DOCX file');
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, file) =>
      error || !file ? reject(error ?? new Error('Invalid ZIP')) : resolve(file)
    )
  );
  const parts: string[] = [];
  let totalBytes = 0;
  let entries = 0;
  let hasDocument = false;
  let hasContentTypes = false;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        entries++;
        if (entries > MAX_ZIP_ENTRIES)
          return reject(new BadRequestException('DOCX is too complex'));
        if (entry.fileName === '[Content_Types].xml') hasContentTypes = true;
        if (entry.fileName === 'word/document.xml') hasDocument = true;
        if (
          !/^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(entry.fileName)
        ) {
          zip.readEntry();
          return;
        }
        totalBytes += entry.uncompressedSize;
        if (entry.uncompressedSize > MAX_TEXT_BYTES || totalBytes > MAX_TEXT_BYTES)
          return reject(new BadRequestException('DOCX text is too large'));
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error ?? new Error('DOCX entry is unavailable'));
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_TEXT_BYTES) stream.destroy(new Error('DOCX text is too large'));
            else chunks.push(chunk);
          });
          stream.on('error', reject);
          stream.on('end', () => {
            parts.push(decodeXml(Buffer.concat(chunks).toString('utf8')));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  if (!hasContentTypes || !hasDocument)
    throw new BadRequestException('Invalid DOCX document structure');
  return parts.join('\n');
}

async function pdfText(bytes: Buffer): Promise<string> {
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new BadRequestException('Invalid PDF file');
  const loading = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const timeout = setTimeout(() => void loading.destroy(), 10_000);
  try {
    const document = await loading.promise;
    if (document.numPages > 20) throw new BadRequestException('PDF has too many pages');
    let text = '';
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
        if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES)
          throw new BadRequestException('PDF text is too large');
      }
      page.cleanup();
    }
    return text;
  } finally {
    clearTimeout(timeout);
    await loading.destroy();
  }
}

export async function extractTemplatePlaceholders(
  bytes: Buffer,
  mime: TemplateMime
): Promise<PlaceholderOccurrence[]> {
  try {
    const text = mime === PDF_MIME ? await pdfText(bytes) : await docxText(bytes);
    return occurrences(text);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Template text could not be extracted');
  }
}

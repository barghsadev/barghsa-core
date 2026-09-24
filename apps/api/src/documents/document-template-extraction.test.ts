import { describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import yazl from 'yazl';
import {
  DOCX_MIME,
  PDF_MIME,
  extractTemplatePlaceholders,
  templateMime,
} from './document-template-extraction.js';

async function docx(xml: string): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from('<Types/>'), '[Content_Types].xml');
  zip.addBuffer(Buffer.from(xml), 'word/document.xml');
  const chunks: Buffer[] = [];
  zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) =>
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  );
  zip.end();
  return finished;
}

async function pdf(text: string): Promise<Buffer> {
  const document = new PDFDocument();
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) =>
    document.on('end', () => resolve(Buffer.concat(chunks)))
  );
  document.text(text);
  document.end();
  return finished;
}

describe('document template extraction', () => {
  it('validates file extensions and declared types together', () => {
    expect(templateMime('terms.pdf', PDF_MIME)).toBe(PDF_MIME);
    expect(templateMime('terms.docx', DOCX_MIME)).toBe(DOCX_MIME);
    expect(templateMime('terms.docx', 'application/zip')).toBe(DOCX_MIME);
    expect(() => templateMime('terms.exe', PDF_MIME)).toThrow();
    expect(() => templateMime('terms.pdf', DOCX_MIME)).toThrow();
  });

  it('extracts DOCX placeholders split between XML runs', async () => {
    const bytes = await docx(
      '<w:document><w:p><w:r><w:t>Dear {{customer</w:t></w:r><w:r><w:t>Name}}, contract {{contractNumber}}</w:t></w:r></w:p></w:document>'
    );
    expect((await extractTemplatePlaceholders(bytes, DOCX_MIME)).map((item) => item.name)).toEqual([
      'customerName',
      'contractNumber',
    ]);
  });

  it('rejects a generic ZIP posing as a DOCX', async () => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('hello'), 'wrong.txt');
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve) =>
      zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    );
    zip.end();
    await expect(extractTemplatePlaceholders(await finished, DOCX_MIME)).rejects.toThrow(
      'structure'
    );
  });

  it('extracts placeholders from a real PDF', async () => {
    const found = await extractTemplatePlaceholders(
      await pdf('Contract for {{customerName}} on {{date}}'),
      PDF_MIME
    );
    expect(found.map((item) => item.name)).toEqual(['customerName', 'date']);
  }, 15_000);
});

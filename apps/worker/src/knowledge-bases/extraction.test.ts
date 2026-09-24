import PDFDocument from 'pdfkit';
import yazl from 'yazl';
import { expect, it } from 'vitest';
import type { StorageProvider } from '@barghsa/shared/storage';
import { chunkText, documentText } from './extraction.js';

function storage(bytes: Buffer): StorageProvider {
  return {
    getObject: async () => ({
      contentLength: bytes.length,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    }),
  } as unknown as StorageProvider;
}

async function zip(files: Record<string, string>) {
  const archive = new yazl.ZipFile();
  for (const [name, contents] of Object.entries(files))
    archive.addBuffer(Buffer.from(contents), name);
  const chunks: Buffer[] = [];
  archive.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) =>
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  );
  archive.end();
  return done;
}

async function pdf(text: string) {
  const document = new PDFDocument();
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) =>
    document.on('end', () => resolve(Buffer.concat(chunks)))
  );
  document.text(text);
  document.end();
  return done;
}

it('extracts text from PDF, DOCX, XLSX and UTF-8 uploads', async () => {
  expect(await documentText(storage(Buffer.from('Hello, meter')), 'a', 'guide.txt')).toBe(
    'Hello, meter'
  );
  expect(await documentText(storage(await pdf('Invoice guide')), 'a', 'guide.pdf')).toContain(
    'Invoice guide'
  );
  const docx = await zip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml':
      '<w:document><w:p><w:r><w:t>Meter</w:t></w:r><w:r><w:t> guide</w:t></w:r></w:p></w:document>',
  });
  expect(await documentText(storage(docx), 'a', 'guide.docx')).toContain('Meter guide');
  const xlsx = await zip({
    '[Content_Types].xml': '<Types/>',
    'xl/sharedStrings.xml': '<sst><si><t>Meter</t></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>42</v></c></row></sheetData></worksheet>',
  });
  expect(await documentText(storage(xlsx), 'a', 'guide.xlsx')).toContain('Meter 42');
}, 15_000);

it('rejects a fake DOCX and bounds chunk overlap', async () => {
  await expect(
    documentText(storage(await zip({ 'word/document.xml': '<w:t>fake</w:t>' })), 'a', 'fake.docx')
  ).rejects.toThrow('kb_invalid_docx');
  expect(chunkText('x'.repeat(250), 100, 20).map((part) => part.length)).toEqual([100, 100, 90]);
  expect(() => chunkText('hello', 100, 100)).toThrow('kb_invalid_chunking');
});

import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { test as base } from './coverage-fixture';

export { expect } from './coverage-fixture';
type Upload = { method: string | undefined; headers: IncomingHttpHeaders; body: Buffer };
export const pdfPreviewImage = readFileSync(
  new URL('./fixtures/first-page-proof.png', import.meta.url)
);

/** Valid, dependency-free one-page PDF for native browser preview checks. */
export function pdfPreviewFixture() {
  const content = 'BT /F1 24 Tf 24 150 Td (First page proof) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

// Receive actual file bytes: WebKit does not expose File request bodies through routing.
export const test = base.extend<{
  uploadReceiver: { url: string; uploads: Upload[]; holdResponses: boolean; release: () => void };
}>({
  uploadReceiver: async ({}, use) => {
    const uploads: Upload[] = [];
    const pending: ServerResponse[] = [];
    const receiver = {
      url: '',
      uploads,
      holdResponses: false,
      release: () => {
        for (const response of pending.splice(0)) response.end();
      },
    };
    const server = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, if-none-match');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        uploads.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(200);
        if (receiver.holdResponses) pending.push(res);
        else res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    try {
      receiver.url = `http://127.0.0.1:${address.port}/upload`;
      await use(receiver);
    } finally {
      receiver.release();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  },
});

import { createServer, type IncomingHttpHeaders } from 'node:http';
import { test as base } from './coverage-fixture';

export { expect } from './coverage-fixture';
type Upload = { method: string | undefined; headers: IncomingHttpHeaders; body: Buffer };

// Receive actual file bytes: WebKit does not expose File request bodies through routing.
export const test = base.extend<{ uploadReceiver: { url: string; uploads: Upload[] } }>({
  uploadReceiver: async ({}, use) => {
    const uploads: Upload[] = [];
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
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    try {
      await use({ url: `http://127.0.0.1:${address.port}/upload`, uploads });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  },
});

import { createServer } from 'node:http';
import { once } from 'node:events';

export function isLoopbackUrl(url: URL): boolean {
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  );
}

export default async function startBrowserFixtureProxy() {
  const proxy = createServer((_request, response) => {
    response
      .writeHead(403, { Connection: 'close' })
      .end('Browser fixture blocked external network');
  });
  proxy.on('connect', (_request, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Missing browser fixture proxy');
  process.env['BARGHSA_BROWSER_FIXTURE_PROXY'] = `http://127.0.0.1:${address.port}`;
  return () =>
    new Promise<void>((resolve, reject) => {
      proxy.close((error) => (error ? reject(error) : resolve()));
    });
}

export function browserFixtureProxy() {
  const server = process.env['BARGHSA_BROWSER_FIXTURE_PROXY'];
  if (!server) throw new Error('Missing browser fixture proxy');
  return { server, bypass: 'localhost,127.0.0.1,[::1]' };
}

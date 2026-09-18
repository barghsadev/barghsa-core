import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

for (const [port, service] of [
  [3000, 'web'],
  [4000, 'api'],
]) {
  const server = createServer((req, res) => {
    const staticCases = {
      '/assets/app-a1b2c3d4.js': [
        200,
        'public, immutable, max-age=31536000',
        'application/javascript',
      ],
      '/auth/assets/auth-a1b2c3d4.js': [
        200,
        'public, immutable, max-age=31536000',
        'application/javascript',
      ],
      '/icon.svg': [200, 'public, max-age=86400', 'image/svg+xml'],
      '/assets/missing-a1b2c3d4.js': [404, 'private, no-store', 'text/plain'],
      '/missing.svg': [404, 'private, no-store', 'text/plain'],
      '/assets/private-a1b2c3d4.js': [200, 'private, no-store', 'text/plain'],
      '/fallback.js': [200, 'private, no-store', 'text/html'],
    };
    if (service === 'web' && staticCases[req.url]) {
      const [status, cacheControl, contentType] = staticCases[req.url];
      res.writeHead(status, {
        'Cache-Control': cacheControl,
        'Content-Type': contentType,
        Vary: 'Accept-Encoding',
      });
      res.end('fixture');
      return;
    }
    if (service === 'web' && req.url === '/csp-page') {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Security-Policy-Report-Only':
          "default-src 'self'; script-src 'strict-dynamic' 'nonce-fixture-app-nonce'; report-uri /api/csp-report",
        'Cache-Control': 'private, no-store',
      });
      res.end('<script nonce="fixture-app-nonce">window.ready=true</script>');
      return;
    }
    if (req.url === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: first\n\n');
      setTimeout(() => res.end('data: last\n\n'), 600);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': service === 'api' ? 'private, no-cache' : 'no-cache',
    });
    req.resume();
    res.end(JSON.stringify({ service, path: req.url, headers: req.headers }));
  });
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.on('end', () => socket.end());
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
}
console.log('ready');

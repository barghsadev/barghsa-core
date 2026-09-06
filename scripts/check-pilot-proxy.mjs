import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const transport = options.plain ? http : https;
    const req = transport.request(
      {
        host: '127.0.0.1',
        port: options.plain ? 80 : 443,
        path,
        rejectUnauthorized: false,
        servername: 'barghsa.example.com',
        method: options.body ? 'POST' : 'GET',
        headers: options.headers,
        ...options.tls,
      },
      (res) => {
        let body = '';
        const chunks = [];
        res.on('data', (chunk) => {
          body += chunk;
          chunks.push(String(chunk));
        });
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body, chunks })
        );
      }
    );
    req.setTimeout(10000, () => req.destroy(new Error('Proxy request timed out')));
    req.on('error', reject);
    req.end(options.body);
  });
}
const redirect = await request('/api/ping', { plain: true });
assert.equal(redirect.status, 301);
assert.equal(redirect.headers['x-content-type-options'], 'nosniff');
assert.equal(redirect.headers.location, 'https://127.0.0.1/api/ping');
for (const version of ['TLSv1.2', 'TLSv1.3']) {
  assert.equal(
    (await request('/api/ping', { tls: { minVersion: version, maxVersion: version } })).status,
    200
  );
}
const api = await request('/api/ping', {
  headers: { 'X-Forwarded-For': '203.0.113.99', 'X-Real-IP': '203.0.113.99' },
});
assert.equal(JSON.parse(api.body).service, 'api');
assert.equal(JSON.parse(api.body).headers['x-forwarded-for'], '127.0.0.1');
assert.equal(JSON.parse(api.body).headers['x-real-ip'], '127.0.0.1');
assert.equal(JSON.parse(api.body).headers['x-forwarded-proto'], 'https');
assert.equal(api.headers['cache-control'], 'private, no-cache');
assert.equal(api.headers['x-content-type-options'], 'nosniff');
assert.equal(api.headers['strict-transport-security'], undefined);
const web = await request('/');
assert.equal(JSON.parse(web.body).service, 'web');
assert.equal(
  (await request('/api/large', { body: Buffer.alloc(10 * 1024 * 1024 + 1) })).status,
  413
);
const templatePath = '/api/admin/contract-templates/01900000-0000-7000-8000-000000000001/versions';
const templateUpload = await request(templatePath, {body: Buffer.alloc(11 * 1024 * 1024)});
assert.equal(templateUpload.status, 200);
assert.equal(JSON.parse(templateUpload.body).service, 'api');
assert.equal(templateUpload.headers['x-content-type-options'], 'nosniff');
assert.equal((await request(templatePath, {body: Buffer.alloc(61 * 1024 * 1024 + 1)})).status, 413);
const stream = await request('/api/stream');
assert.ok(stream.chunks.length >= 2, 'SSE must reach the client before the final chunk');
assert.ok(stream.chunks[0].includes('first') && !stream.chunks[0].includes('last'));
await new Promise((resolve, reject) => {
  const req = https.request({
    host: '127.0.0.1',
    port: 443,
    path: '/api/ai/socket',
    rejectUnauthorized: false,
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    },
  });
  req.setTimeout(5000, () => req.destroy(new Error('WebSocket upgrade timed out')));
  req.on('upgrade', (res, socket) => {
    try {
      assert.equal(res.statusCode, 101);
      socket.destroy();
      resolve();
    } catch (error) {
      reject(error);
    }
  });
  req.on('response', (res) => reject(new Error(`Expected upgrade, received ${res.statusCode}`)));
  req.on('error', reject);
  req.end();
});
for (const path of ['/api/auth/login', '/api/upload/file', '/api/ai/stream']) {
  const responses = await Promise.all(
    Array.from({ length: 60 }, () => request(path, { headers: { 'Accept-Language': 'fa' } }))
  );
  const limited = responses.filter((response) => response.status === 429);
  assert.ok(limited.length > 0, `${path} did not enforce its edge quota`);
  assert.ok(responses.every((response) => response.status === 200 || response.status === 429));
  for (const response of limited) {
    assert.equal(response.headers['retry-after'], '1');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    const error = JSON.parse(response.body).error;
    assert.equal(error.code, 'RATE_LIMIT:EXCEEDED');
    assert.equal(error.retryAfterSeconds, 1);
    assert.ok(error.message.includes('ثانیه'));
  }
  console.log(`PASS ${path}: ${limited.length} rate-limited responses`);
}
const english = await request('/api/ai/stream', { headers: { 'Accept-Language': 'en' } });
assert.equal(english.status, 429);
assert.ok(JSON.parse(english.body).error.message.includes('1 second'));
console.log(
  'PASS TLS, routing, forwarded-address overwrite, headers, size limit, SSE and WebSocket upgrade'
);

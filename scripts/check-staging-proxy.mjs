import assert from 'node:assert/strict';
import https from 'node:https';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port: 443,
        servername: 'stg.barghsa.com',
        rejectUnauthorized: false,
        path,
        method: options.body ? 'POST' : 'GET',
        headers: options.headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
            chunks,
          })
        );
      }
    );
    req.setTimeout(10000, () => req.destroy(new Error('Proxy request timed out')));
    req.on('error', reject);
    req.end(options.body);
  });
}

const upstreamLimit = await request('/api/auth/application-limited');
assert.equal(upstreamLimit.status, 429);
assert.equal(upstreamLimit.headers['retry-after'], '60');
assert.equal(JSON.parse(upstreamLimit.body).error.code, 'FIXTURE:APPLICATION_LIMIT');
for (const language of ['fa', 'en']) {
  // Let the same client's quota refill before exercising the next language.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const responses = await Promise.all(
    Array.from({ length: 60 }, (_, i) =>
      request('/api/auth/login', {
        headers: { 'Accept-Language': language, 'X-Forwarded-For': `203.0.113.${i + 1}` },
      })
    )
  );
  const limited = responses.filter((response) => response.status === 429);
  assert.ok(limited.length > 0, `${language}: forged forwarding bypassed the edge quota`);
  assert.ok(responses.some((response) => response.status === 200));
  assert.ok(responses.every((response) => response.status === 200 || response.status === 429));
  for (const response of limited) {
    assert.equal(response.headers['retry-after'], '1');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['content-type'], 'application/json');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    const error = JSON.parse(response.body).error;
    assert.equal(error.code, 'RATE_LIMIT:EXCEEDED');
    assert.equal(error.retryAfterSeconds, 1);
    assert.ok(error.message.includes(language === 'fa' ? 'ثانیه' : '1 second'));
  }
  // An exhausted auth quota must not throttle health or unrelated API routes.
  const ping = await request('/api/ping');
  assert.equal(ping.status, 200);
  assert.equal(JSON.parse(ping.body).headers['x-forwarded-for'], '127.0.0.1');
  console.log(`PASS ${language}: ${limited.length} localized edge rejections; health unaffected`);
}
const upload = await request('/api/admin/contract-templates/fixture/versions', {
  body: Buffer.alloc(11 * 1024 * 1024),
});
assert.equal(upload.status, 200);
assert.equal(JSON.parse(upload.body).receivedBytes, 11 * 1024 * 1024);
const stream = await request('/api/stream');
assert.ok(stream.chunks.length >= 2);
assert.ok(
  stream.chunks[0].toString().includes('first') && !stream.chunks[0].toString().includes('last')
);
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
    socket.destroy();
    try {
      assert.equal(res.statusCode, 101);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
  req.on('response', (res) => reject(new Error(`Expected upgrade, received ${res.statusCode}`)));
  req.on('error', reject);
  req.end();
});
console.log('PASS API cooldown preserved, upload body, unbuffered SSE and WebSocket preserved');

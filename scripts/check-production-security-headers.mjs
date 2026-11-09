import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createStaticServer } from '../apps/web/server.js';

const server = createStaticServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');

try {
  const nonces = new Set();
  for (const path of ['/', '/login', '/login']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(
      response.headers.get('permissions-policy'),
      'camera=(), microphone=(), geolocation=()'
    );
    assert.equal(response.headers.get('x-frame-options'), 'DENY');

    const policy = response.headers.get('content-security-policy-report-only') ?? '';
    const nonce = policy.match(/script-src 'strict-dynamic' 'nonce-([A-Za-z0-9+/]{32})'/)?.[1];
    assert.ok(nonce, path);
    assert.ok(!nonces.has(nonce), `CSP nonce reused on ${path}`);
    nonces.add(nonce);
    assert.match(policy, /(?:^|; )frame-ancestors 'none'(?:;|$)/);
    assert.match(policy, /(?:^|; )report-uri \/api\/csp-report(?:;|$)/);
    assert.doesNotMatch(policy, /'unsafe-eval'/);
    assert.equal(response.headers.get('content-security-policy'), null);
    const html = await response.text();
    const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag);
    assert.ok(
      scriptTags.some((tag) => tag.includes('type="module"')),
      `No built module at ${path}`
    );
    const preloads = [...html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>/gi)];
    for (const tag of [...scriptTags, ...preloads.map(([tag]) => tag)]) {
      assert.ok(tag.includes(`nonce="${nonce}"`), `Missing per-response nonce at ${path}`);
    }
  }
  process.stdout.write('Production web security headers and per-response nonces verified.\n');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

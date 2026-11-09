import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createStaticServer } from '../apps/web/server.js';

const nonces = new Set();
const requiredDirectives = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  'report-uri /api/csp-report',
];

function assertHeaders(response, mode) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(
    response.headers.get('permissions-policy'),
    'camera=(), microphone=(), geolocation=()'
  );
  assert.equal(response.headers.get('x-frame-options'), 'DENY');

  const enforce = 'content-security-policy';
  const report = 'content-security-policy-report-only';
  const policy = response.headers.get(mode === 'enforce' ? enforce : report) ?? '';
  assert.equal(response.headers.get(mode === 'enforce' ? report : enforce), null);
  assert.doesNotMatch(policy, /'unsafe-eval'/);
  const directives = policy.split(/;\s*/);
  for (const directive of requiredDirectives) {
    assert.ok(directives.includes(directive), `Missing CSP directive ${directive}`);
  }
  return directives.find((directive) => directive.startsWith('script-src '));
}

for (const mode of ['report-only', 'enforce']) {
  if (mode === 'enforce') process.env.WEB_CSP_MODE = mode;
  else delete process.env.WEB_CSP_MODE;
  const server = createStaticServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    for (const path of ['/', '/login', '/login']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
      const scriptPolicy = assertHeaders(response, mode);
      const nonce = scriptPolicy?.match(
        /^script-src 'strict-dynamic' 'nonce-([A-Za-z0-9+/]{32})'$/
      )?.[1];
      assert.ok(nonce, path);
      assert.ok(!nonces.has(nonce), `CSP nonce reused on ${path}`);
      nonces.add(nonce);
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
    const missing = await fetch(origin + '/assets/release-header-fixture-missing.js');
    assert.equal(missing.status, 404);
    assert.equal(assertHeaders(missing, mode), "script-src 'none'");
    await missing.arrayBuffer();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
process.stdout.write('Production web security headers and nonces verified in both CSP modes.\n');

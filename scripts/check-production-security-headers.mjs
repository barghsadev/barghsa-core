import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStaticServer } from '../apps/web/server.js';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const sonnerEntry = readFileSync(
  requireWeb.resolve('sonner').replace(/index\.js$/, 'index.mjs'),
  'utf8'
);
const injectedStyle = sonnerEntry.match(/^__insertCSS\(("(?:[^"\\]|\\.)*")\);$/m)?.[1];
assert.ok(injectedStyle, 'Check the style policy for this Sonner build');
const toastHash = createHash('sha256').update(JSON.parse(injectedStyle)).digest('base64');
const requireUi = createRequire(new URL('../packages/ui/package.json', import.meta.url));
const baseUiProvider = requireUi.resolve('@base-ui/react/csp-provider');
const { styleDisableScrollbar } = await import(
  pathToFileURL(resolve(dirname(baseUiProvider), '../utils/styles.mjs'))
);
const scrollbarHash = createHash('sha256')
  .update(styleDisableScrollbar.getElement().props.children)
  .digest('base64');

const nonces = new Set();
const requiredDirectives = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
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
  return directives;
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
      const directives = assertHeaders(response, mode);
      const scriptPolicy = directives.find((directive) => directive.startsWith('script-src '));
      const nonce = scriptPolicy?.match(
        /^script-src 'strict-dynamic' 'nonce-([A-Za-z0-9+/]{32})'$/
      )?.[1];
      assert.ok(nonce, path);
      assert.ok(directives.includes("style-src-attr 'unsafe-inline'"), path);
      assert.ok(
        directives.includes(
          `style-src 'self' 'nonce-${nonce}' 'sha256-${toastHash}' 'sha256-${scrollbarHash}'`
        ),
        `Incorrect style nonce or component stylesheet hash at ${path}`
      );
      assert.ok(!nonces.has(nonce), `CSP nonce reused on ${path}`);
      nonces.add(nonce);
      const html = await response.text();
      const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag);
      assert.ok(
        scriptTags.some((tag) => tag.includes('type="module"')),
        `No built module at ${path}`
      );
      const preloads = [...html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>/gi)];
      const styles = [...html.matchAll(/<style\b[^>]*>/gi)];
      for (const tag of [
        ...scriptTags,
        ...preloads.map(([tag]) => tag),
        ...styles.map(([tag]) => tag),
      ]) {
        assert.ok(tag.includes(`nonce="${nonce}"`), `Missing per-response nonce at ${path}`);
      }
    }
    const missing = await fetch(origin + '/assets/release-header-fixture-missing.js');
    assert.equal(missing.status, 404);
    const missingDirectives = assertHeaders(missing, mode);
    assert.ok(missingDirectives.includes("script-src 'none'"));
    assert.ok(missingDirectives.includes("style-src 'self'"));
    await missing.arrayBuffer();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
process.stdout.write('Production web security headers and nonces verified in both CSP modes.\n');

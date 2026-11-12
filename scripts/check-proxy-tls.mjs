import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const [servername, mode, certificate = '/fixture-ca.pem', securePort = '443', plainPort = '80'] =
  process.argv.slice(2);
assert.ok(servername && ['default', 'hsts'].includes(mode));
const host = '127.0.0.1';
const ca = readFileSync(certificate);
const expectedHsts = mode === 'hsts' ? 'max-age=31536000; includeSubDomains' : undefined;

function negotiate(options) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: Number(securePort), servername, ca, ...options });
    socket.once('secureConnect', () => {
      resolve({ protocol: socket.getProtocol(), cipher: socket.getCipher().name });
      socket.destroy();
    });
    socket.once('error', reject);
    socket.setTimeout(5000, () => socket.destroy(new Error('TLS handshake timed out')));
  });
}

const tls12 = { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' };
assert.deepEqual(await negotiate({ ...tls12, ciphers: 'ECDHE-RSA-AES128-GCM-SHA256' }), {
  protocol: 'TLSv1.2',
  cipher: 'ECDHE-RSA-AES128-GCM-SHA256',
});
const tls13 = await negotiate({ minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' });
assert.equal(tls13.protocol, 'TLSv1.3');
assert.match(tls13.cipher, /^TLS_(?:AES|CHACHA20)_/);
await assert.rejects(negotiate({ servername: 'wrong.example.test' }), {
  code: 'ERR_TLS_CERT_ALTNAME_INVALID',
});
for (const version of ['TLSv1', 'TLSv1.1']) {
  await assert.rejects(
    negotiate({ minVersion: version, maxVersion: version, ciphers: 'DEFAULT:@SECLEVEL=0' }),
    { code: 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION' }
  );
}
for (const cipher of ['ECDHE-RSA-AES128-SHA256', 'AES128-GCM-SHA256']) {
  assert.ok(tls.getCiphers().includes(cipher.toLowerCase()));
  await assert.rejects(negotiate({ ...tls12, ciphers: cipher }), {
    code: /^ERR_SSL_(?:SSLV3|SSL\/TLS)_ALERT_HANDSHAKE_FAILURE$/,
  });
}
console.log(
  'PASS verified TLS 1.2/1.3 and rejected wrong hostname, legacy versions, CBC and static RSA'
);

function request(path, { insecure = false, oversized = false } = {}) {
  return new Promise((resolve, reject) => {
    const transport = insecure ? http : https;
    const req = transport.request(
      {
        host,
        port: Number(insecure ? plainPort : securePort),
        servername,
        ca,
        path,
        method: oversized ? 'POST' : 'GET',
        headers: { Host: servername, ...(oversized ? { 'Content-Length': '70000000' } : {}) },
      },
      (res) => {
        res.resume();
        res.once('end', () => resolve({ status: res.statusCode, headers: res.headersDistinct }));
      }
    );
    req.once('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HSTS response timed out')));
    req.end();
  });
}

function assertEdgeHeaders({ headers }, path) {
  for (const [name, value] of Object.entries({
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'x-frame-options': 'DENY',
  })) {
    assert.deepEqual(headers[name], [value], `${path}: ${name}`);
  }
  assert.deepEqual(
    headers['strict-transport-security'],
    expectedHsts ? [expectedHsts] : undefined,
    `${path}: strict-transport-security`
  );
}

const redirect = await request('/api/ping', { insecure: true });
assert.equal(redirect.status, 301);
assert.equal(redirect.headers['strict-transport-security'], undefined);
const upstream = await request('/api/upstream-hsts');
assert.equal(upstream.status, 200);
assertEdgeHeaders(upstream, 'upstream response');
const tooLarge = await request('/api/large', { oversized: true });
assert.equal(tooLarge.status, 413);
assertEdgeHeaders(tooLarge, 'edge size rejection');
const responses = await Promise.all(Array.from({ length: 24 }, () => request('/api/auth/login')));
const limits = responses.filter(({ status }) => status === 429);
assert.ok(limits.length > 0, 'Expected a local rate limit response');
for (const limit of limits) assertEdgeHeaders(limit, 'edge rate limit');
console.log(`PASS ${mode} edge security headers on HTTPS success, size rejection and rate limit`);

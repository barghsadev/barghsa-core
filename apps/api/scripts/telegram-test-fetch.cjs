// Test-only preload for the compiled HTTP fixture. Production endpoints remain fixed.
if (process.env.NODE_ENV !== 'test') throw new Error('Telegram fixture requires test environment');
const target = new URL(process.env.BARGHSA_TEST_TELEGRAM_ENDPOINT);
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port)
  throw new Error('Telegram fixture must be an owned loopback server');
const request = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin === 'https://api.telegram.org') {
    const method = url.pathname.split('/').at(-1);
    if (!['getMe', 'sendMessage'].includes(method)) throw new Error('Unexpected fixture method');
    return request(new URL('/' + method, target), init);
  }
  return request(input, init);
};

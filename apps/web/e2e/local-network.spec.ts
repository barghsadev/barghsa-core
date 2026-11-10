import { test, expect } from './coverage-fixture';
import { createServer } from 'node:http';
import { once } from 'node:events';

test('provider addresses require an explicit browser fixture', async ({ page }) => {
  const provider = 'http://provider-boundary.example.test/verification';
  const secureProvider = provider.replace('http:', 'https:');
  const server = createServer((_request, response) => {
    response.writeHead(302, { Location: provider, Connection: 'close' }).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing redirect fixture');
    const redirect = `http://127.0.0.1:${address.port}/`;
    expect((await page.goto(provider))?.status()).toBe(403);
    await expect(page.locator('body')).toHaveText('Browser fixture blocked external network');
    expect((await page.goto(redirect))?.status()).toBe(403);
    await expect(page.locator('body')).toHaveText('Browser fixture blocked external network');
    await expect(page.goto(secureProvider)).rejects.toThrow();

    await page.route(secureProvider, (route) => route.fulfill({ body: 'local test fixture' }));
    expect((await page.goto(secureProvider))?.status()).toBe(200);
    await expect(page.locator('body')).toHaveText('local test fixture');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

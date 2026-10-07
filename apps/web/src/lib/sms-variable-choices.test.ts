import { afterEach, expect, it, vi } from 'vitest';
import { listSmsTemplateVariableChoices, smsVariableChoices } from './sms-providers-api.js';
import { ProviderRequestError } from './email-providers-api.js';
afterEach(() => vi.unstubAllGlobals());
const rows = [
  { eventKey: 'auth.otp', locale: 'en' as const, variables: ['code', 'englishOnly'] },
  { eventKey: 'auth.otp', locale: 'fa' as const, variables: ['code', 'persianOnly'] },
  { eventKey: 'invoice.created', locale: 'en' as const, variables: ['invoice.amount'] },
];
it('offers exact locale names and the all-language intersection without modifying the catalogue', () => {
  const original = structuredClone(rows);
  expect(smsVariableChoices(rows, 'auth.otp', 'en')).toEqual(['code', 'englishOnly']);
  expect(smsVariableChoices(rows, 'auth.otp', 'fa')).toEqual(['code', 'persianOnly']);
  expect(smsVariableChoices(rows, ' auth.otp ', 'all')).toEqual(['code']);
  expect(smsVariableChoices(rows, 'missing', 'en')).toEqual([]);
  expect(smsVariableChoices(rows, 'invoice.created', 'fa')).toEqual([]);
  expect(rows).toEqual(original);
});
it('loads a narrow validated catalogue with cancellation and sorted distinct names', async () => {
  const signal = new AbortController().signal;
  const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(
        JSON.stringify([
          { ...rows[0], variables: ['profile.name', 'code', 'code'], body: 'PRIVATE' },
        ])
      )
  );
  vi.stubGlobal('fetch', fetcher);
  expect(await listSmsTemplateVariableChoices(signal)).toEqual([
    { eventKey: 'auth.otp', locale: 'en', variables: ['code', 'profile.name'] },
  ]);
  expect(fetcher.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ signal, method: 'GET' }));
});
for (const value of [
  {},
  [null],
  [{ ...rows[0], locale: 'ar' }],
  [{ ...rows[0], variables: 'code' }],
  [{ ...rows[0], variables: ['__proto__.secret'] }],
  [{ ...rows[0], variables: ['profile.constructor'] }],
  [{ ...rows[0], variables: ['{{code}}'] }],
  [{ ...rows[0], variables: [' code '] }],
  [{ ...rows[0], eventKey: '' }],
  [rows[0], rows[0]],
])
  it(`rejects malformed or unsafe choices ${JSON.stringify(value)}`, async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(value)))
    );
    await expect(listSmsTemplateVariableChoices()).rejects.toBeInstanceOf(ProviderRequestError);
  });

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateProvider,
  createProvider,
  disableProvider,
  listProviders,
  rollbackProvider,
  testConnection,
  updateProvider,
} from './email-providers-api.js';

const row = {
  id: 'provider-1',
  transport: 'smtp',
  label: 'Provider',
  status: 'draft',
  lastTestStatus: 'pending',
};
afterEach(() => vi.unstubAllGlobals());
function respond(value: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status }))
  );
}
describe('provider response contracts', () => {
  it.each([
    null,
    {},
    [null],
    [{ ...row, transport: ['smtp'] }],
    [{ ...row, status: 'deleted' }],
    [{ ...row, lastTestAt: 'invalid' }],
    [{ ...row, activatedBy: {} }],
  ])('rejects malformed provider lists %j', async (value) => {
    respond(value);
    await expect(listProviders()).rejects.toThrow();
  });
  it('accepts known metadata and passes cancellation through', async () => {
    respond([row]);
    const signal = new AbortController().signal;
    await expect(listProviders(signal)).resolves.toEqual([row]);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal).toBe(signal);
  });
  const mutations = [
    { name: 'create', run: () => createProvider('smtp', 'Provider', {}), expected: row },
    { name: 'update', run: () => updateProvider(row.id, { label: 'Updated' }), expected: row },
    {
      name: 'activate',
      run: () => activateProvider(row.id),
      expected: { ...row, status: 'active' },
    },
    {
      name: 'disable',
      run: () => disableProvider(row.id),
      expected: { ...row, status: 'disabled' },
    },
    {
      name: 'rollback',
      run: () => rollbackProvider(row.id),
      expected: { ...row, id: 'replacement', status: 'active' },
    },
  ];
  for (const action of mutations) {
    it(`${action.name} rejects missing or contradictory acknowledgements`, async () => {
      for (const value of [null, {}, { ...action.expected, status: 'superseded' }]) {
        respond(value);
        await expect(action.run()).rejects.toThrow();
      }
      respond(action.expected);
      await expect(action.run()).resolves.toEqual(action.expected);
    });
  }
  it('does not accept a different edited provider', async () => {
    respond({ ...row, id: 'other' });
    await expect(updateProvider(row.id, {})).rejects.toThrow();
  });
  it('does not accept a different transport on creation', async () => {
    respond({ ...row, transport: 'resend' });
    await expect(createProvider('smtp', 'Provider', {})).rejects.toThrow();
  });
  it('requires rollback to create a new version', async () => {
    respond({ ...row, status: 'active' });
    await expect(rollbackProvider(row.id)).rejects.toThrow();
  });
  it.each([
    { test: { ok: 'true', error: null } },
    { test: { ok: true, error: 'failed' } },
    { test: { ok: false, error: null } },
    { id: 'other', test: { ok: true, error: null } },
    { test: null },
  ])('rejects contradictory test results %j', async (value) => {
    respond({ ...row, lastTestStatus: 'passed', ...value });
    await expect(testConnection(row.id)).rejects.toThrow();
  });
  it('preserves failed provider diagnostics and captures an explicit recipient', async () => {
    respond({ ...row, lastTestStatus: 'failed', test: { ok: false, error: 'Connection refused' } });
    await expect(testConnection(row.id, 'test@example.test')).resolves.toEqual({
      ok: false,
      error: 'Connection refused',
    });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
      recipient: 'test@example.test',
    });
  });
  it('accepts a successful connection test', async () => {
    respond({ ...row, lastTestStatus: 'passed', test: { ok: true, error: null } });
    await expect(testConnection(row.id)).resolves.toEqual({ ok: true, error: null });
  });
  it('does not expose HTTP response internals', async () => {
    respond({ message: 'private connection detail' }, 500);
    await expect(listProviders()).rejects.not.toThrow('private connection detail');
  });
});

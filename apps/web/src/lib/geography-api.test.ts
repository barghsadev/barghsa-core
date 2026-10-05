import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deactivateProvince,
  listProvinces,
  saveProvince,
  GeographyRequestError,
} from './geography-api.js';
import { ErrorCodes } from '@barghsa/shared/errors';

const province = { id: 'province-1', nameFa: 'تهران', nameEn: 'Tehran', status: 'active' as const };
afterEach(() => vi.unstubAllGlobals());
function response(value: unknown, status = 200) {
  return vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status }))
  );
}
describe('geography response boundaries', () => {
  it.each([
    null,
    {},
    { provinces: [null], total: 1 },
    { provinces: [], total: -1 },
    { provinces: [], total: 0.5 },
  ])('rejects malformed lists %j', async (value) => {
    response(value);
    await expect(
      listProvinces({ search: '', status: '', page: 1 }, new AbortController().signal)
    ).rejects.toThrow('requestFailed');
  });
  it('passes encoded filters and cancellation signal', async () => {
    response({ provinces: [province], total: 1 });
    const signal = new AbortController().signal;
    await expect(
      listProvinces({ search: 'تهران &', status: 'active', page: 2 }, signal)
    ).resolves.toEqual({ provinces: [province], total: 1 });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(new URL(String(url), 'https://example.test').searchParams.get('search')).toBe('تهران &');
    expect(init?.signal).toBe(signal);
  });
  it.each([null, {}, { ...province, id: 'different' }, { ...province, status: 'deleted' }])(
    'rejects invalid saved rows %j',
    async (value) => {
      response(value);
      await expect(saveProvince(province, province)).rejects.toThrow('requestFailed');
    }
  );
  it('saves a valid row and excludes status from creation', async () => {
    response(province);
    await expect(saveProvince(null, province)).resolves.toEqual(province);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
      nameFa: province.nameFa,
      nameEn: province.nameEn,
    });
  });
  it.each([null, {}, { success: false }])('rejects incomplete deactivation %j', async (value) => {
    response(value);
    await expect(deactivateProvince(province.id)).rejects.toThrow('requestFailed');
  });
  it('accepts acknowledged deactivation', async () => {
    response({ success: true });
    await expect(deactivateProvince(province.id)).resolves.toBeUndefined();
  });
  it.each([
    [409, 'conflict'],
    [401, 'denied'],
    [403, 'denied'],
    [500, 'requestFailed'],
  ])('maps HTTP %s without exposing server messages', async (status, message) => {
    response({ message: 'private error' }, Number(status));
    await expect(deactivateProvince(province.id)).rejects.toThrow(String(message));
  });
  it('rejects invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid')));
    await expect(deactivateProvince(province.id)).rejects.toThrow('requestFailed');
  });
  it.each([['nameEn'], ['cities'], ['status', 'nameFa']])(
    'accepts only safe coded field feedback %j',
    async (...fields) => {
      response(
        {
          error: {
            code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            fields,
            message: 'private detail',
          },
        },
        400
      );
      const error = await saveProvince(province, province).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(GeographyRequestError);
      expect((error as GeographyRequestError).fields).toEqual(fields);
      expect((error as GeographyRequestError).message).toBe('requestFailed');
    }
  );
  it.each([['secret'], ['nameEn', null], Array.from({ length: 51 }, () => 'nameEn')])(
    'rejects malformed feedback without exposing details %j',
    async (...fields) => {
      response(
        {
          error: {
            code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            fields,
            message: 'private detail',
          },
        },
        400
      );
      const error = await saveProvince(province, province).catch((cause: unknown) => cause);
      expect((error as GeographyRequestError).fields).toEqual([]);
      expect((error as GeographyRequestError).message).toBe('requestFailed');
    }
  );
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpBillDataProvider, suggestEnergy } from './electricity-bill-data.service.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('hourly bill-data suggestion', () => {
  it('uses distinct valid hourly readings and discloses sparse coverage', () => {
    expect(
      suggestEnergy(
        [
          { hour: '2026-09-01T00:00:00Z', kwh: 2 },
          { hour: '2026-09-01T00:00:00Z', kwh: 2 },
          { hour: '2026-09-01T02:00:00Z', kwh: 4 },
          { hour: 'invalid', kwh: 9 },
        ],
        4,
        'meter'
      )
    ).toMatchObject({
      suggestedKwh: '12',
      dataSource: 'meter',
      dataTimestamp: '2026-09-01T02:00:00.000Z',
      coverage: 2 / 3,
      sampledHours: 2,
      dataPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-09-01T03:00:00.000Z' },
    });
  });

  it('returns no estimate when the provider has no valid data', () => {
    expect(suggestEnergy([], 24, 'meter')).toBeNull();
    expect(suggestEnergy([{ hour: '2026-09-01T00:00:00Z', kwh: -1 }], 24, 'meter')).toBeNull();
  });
});

it('accepts valid hourly provider readings and surfaces authentication failure', async () => {
  vi.stubEnv('ELECTRICITY_BILL_DATA_URL', 'https://bills.example.com');
  vi.stubEnv('ELECTRICITY_BILL_DATA_TOKEN', 'test-token');
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { hour: '2026-09-01T00:00:00Z', kwh: 2.5 },
          { hour: 'bad', kwh: 10 },
        ]),
        { status: 200 }
      )
    )
    .mockResolvedValueOnce(new Response('', { status: 401 }));
  vi.stubGlobal('fetch', request);
  const provider = new HttpBillDataProvider();
  expect(await provider.getHourlyConsumption('profile-1')).toEqual([
    { hour: '2026-09-01T00:00:00Z', kwh: 2.5 },
  ]);
  expect(String(request.mock.calls[0]?.[0])).toContain('/profiles/profile-1/hourly-consumption');
  await expect(provider.getHourlyConsumption('profile-1')).rejects.toThrow('auth_error');
});

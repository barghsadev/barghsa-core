import { expect, it } from 'vitest';
import { sessionLocation } from './session-location.js';

it.each(['8.8.8.8', '2001:4860:4860::8888', '::ffff:8.8.8.8'])(
  'resolves %s from the packaged database and exposes only a country',
  (ip) => {
    expect(sessionLocation({ ip, location: { countryCode: 'IR' }, secret: 'private' })).toEqual({
      countryCode: 'US',
    });
  }
);

it.each([
  null,
  undefined,
  {},
  { ip: 123 },
  { ip: 'example.com' },
  { ip: '8.8.8.8, 1.1.1.1' },
  { ip: '8.8.8.8:443' },
  { ip: 'x'.repeat(1000) },
  ...[
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.2.1',
    '::1',
    'fc00::1',
    '2001:db8::1',
  ].map((ip) => ({ ip })),
])('does not invent a country for %j', (deviceInfo) => {
  expect(sessionLocation(deviceInfo)).toBeNull();
});

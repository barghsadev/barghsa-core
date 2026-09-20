import { expect, it } from 'vitest';
import { deviceTrustIp } from './device-trust-ip.js';

it.each([
  ['192.0.2.1', '192.0.2.1'],
  ['::ffff:192.0.2.1', '192.0.2.1'],
  ['2001:db8::1', '2001:db8::1'],
  ['unknown', null],
  ['192.0.2.1, 198.51.100.1', null],
  ['192.0.2.1/24', null],
  ['fe80::1%eth0', null],
  ['', null],
])(
  'normalizes server address %s without accepting forwarded lists or networks',
  (input, expected) => {
    expect(deviceTrustIp(input)).toBe(expected);
  }
);

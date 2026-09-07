import { afterEach, expect, it, vi } from 'vitest';
import { promises as dns } from 'node:dns';
import {
  hostIsAllowlisted,
  isBlockedIp,
  SmtpDestinationBlockedError,
  SmtpNetworkGuard,
} from './smtp-network-guard.js';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
for (const ip of [
  '0.1.2.3',
  '10.255.255.255',
  '100.64.0.0',
  '100.127.255.255',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.0',
  '172.31.255.255',
  '192.0.0.1',
  '192.0.2.254',
  '192.168.255.255',
  '198.18.0.0',
  '198.19.255.255',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '239.255.255.255',
  '240.0.0.0',
  '255.255.255.255',
  '::',
  '::1',
  'fc00::1',
  'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  'fe80::1',
  'febf::1',
  'ff02::1',
  '2001:db8::1',
  '2001:db8::192.0.2.1',
  '::ffff:127.0.0.1',
  '::ffff:a00:1',
  '0:0:0:0:0:ffff:c0a8:101',
  'fe80::1%eth0',
  '',
  'not-an-ip',
  '256.1.1.1',
  '1.2.3',
])
  it(`blocks reserved, private or malformed destination ${ip}`, () =>
    expect(isBlockedIp(ip)).toBe(true));
for (const ip of [
  '8.8.8.8',
  '100.63.255.255',
  '100.128.0.0',
  '169.253.255.255',
  '172.15.255.255',
  '172.32.0.0',
  '192.0.1.1',
  '192.169.0.1',
  '198.17.255.255',
  '198.20.0.0',
  '198.51.99.1',
  '203.0.112.1',
  '223.255.255.255',
  '2606:4700:4700::1111',
  '2001:4860:4860:0:0:0:0:8888',
  '::ffff:8.8.8.8',
  '::ffff:808:808',
  '2606:4700::8.8.8.8',
])
  it(`permits address outside the guarded ranges ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
it('matches explicit hosts after normalization without suffix or CIDR expansion', () => {
  expect(hostIsAllowlisted(' MAIL.Example.TEST. ', ['mail.example.test'])).toBe(true);
  for (const host of ['', ' ', 'evilmail.example.test', 'mail.example.test.evil', '127.0.0.1'])
    expect(hostIsAllowlisted(host, ['mail.example.test', '127.0.0.0/8'])).toBe(false);
});
it('applies explicit deployment exceptions without resolving their private hosts', async () => {
  vi.stubEnv('SMTP_HOST_ALLOWLIST', ' , internal.example.test , localhost, ');
  const resolve = vi.fn().mockRejectedValue(new Error('Must not resolve'));
  await expect(
    new SmtpNetworkGuard({ resolve }).assertHostAllowed('INTERNAL.EXAMPLE.TEST.')
  ).resolves.toBeUndefined();
  expect(resolve).not.toHaveBeenCalled();
});
it('lets an explicit empty allowlist override environment exceptions', async () => {
  vi.stubEnv('SMTP_HOST_ALLOWLIST', 'localhost');
  const guard = new SmtpNetworkGuard({ allowlist: [], resolve: async () => ['127.0.0.1'] });
  await expect(guard.assertHostAllowed('localhost')).rejects.toBeInstanceOf(
    SmtpDestinationBlockedError
  );
});
it('rejects an empty host before resolution', async () => {
  const resolve = vi.fn();
  await expect(new SmtpNetworkGuard({ resolve }).assertHostAllowed('  ')).rejects.toMatchObject({
    detail: 'empty SMTP host',
  });
  expect(resolve).not.toHaveBeenCalled();
});
it('blocks mixed public/private DNS answers and reports resolver failure or empty results', async () => {
  const resolve = vi
    .fn()
    .mockResolvedValueOnce(['8.8.8.8', '::ffff:7f00:1'])
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error('Fixture DNS failure'));
  const guard = new SmtpNetworkGuard({ allowlist: [], resolve });
  await expect(guard.assertHostAllowed(' Mail.Example.Test. ')).rejects.toMatchObject({
    detail: 'resolves to blocked address ::ffff:7f00:1',
  });
  expect(resolve).toHaveBeenCalledWith('mail.example.test');
  await expect(guard.assertHostAllowed('mail.example.test')).rejects.toMatchObject({
    detail: 'host resolved to no addresses',
  });
  await expect(guard.assertHostAllowed('mail.example.test')).rejects.toMatchObject({
    detail: 'host could not be resolved: Fixture DNS failure',
  });
});
it('checks IP literals without DNS and checks every default DNS answer', async () => {
  vi.stubEnv('SMTP_HOST_ALLOWLIST', '');
  const lookup = vi.fn().mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  vi.spyOn(dns, 'lookup').mockImplementation(lookup);
  const guard = new SmtpNetworkGuard();
  await expect(guard.assertHostAllowed('8.8.8.8')).resolves.toBeUndefined();
  await expect(guard.assertHostAllowed('127.0.0.1')).rejects.toBeInstanceOf(
    SmtpDestinationBlockedError
  );
  expect(lookup).not.toHaveBeenCalled();
  await expect(guard.assertHostAllowed('mail.example.test')).resolves.toBeUndefined();
  expect(lookup).toHaveBeenCalledWith('mail.example.test', { all: true, verbatim: true });
});

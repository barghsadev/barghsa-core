import { describe, it, expect } from 'vitest'
import {
  SmtpNetworkGuard,
  SmtpDestinationBlockedError,
  isBlockedIp,
  hostIsAllowlisted,
} from './smtp-network-guard'

describe('SmtpNetworkGuard — isBlockedIp (T-05.06.02)', () => {
  it('blocks RFC1918 private IPv4 ranges', () => {
    expect(isBlockedIp('10.0.0.1')).toBe(true)
    expect(isBlockedIp('172.16.0.1')).toBe(true)
    expect(isBlockedIp('172.31.255.255')).toBe(true)
    expect(isBlockedIp('172.32.0.1')).toBe(false)
    expect(isBlockedIp('192.168.1.1')).toBe(true)
  })

  it('blocks loopback, link-local, and special ranges', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true)
    expect(isBlockedIp('169.254.0.1')).toBe(true)
    expect(isBlockedIp('0.0.0.0')).toBe(true)
    expect(isBlockedIp('100.64.0.1')).toBe(true)
    expect(isBlockedIp('224.0.0.1')).toBe(true) // multicast
    expect(isBlockedIp('240.0.0.1')).toBe(true) // reserved
    expect(isBlockedIp('192.0.2.1')).toBe(true) // TEST-NET
    expect(isBlockedIp('198.51.100.1')).toBe(true) // TEST-NET-2
    expect(isBlockedIp('203.0.113.1')).toBe(true) // TEST-NET-3
  })

  it('allows public IPv4 addresses', () => {
    expect(isBlockedIp('93.184.216.34')).toBe(false)
    expect(isBlockedIp('8.8.8.8')).toBe(false)
    expect(isBlockedIp('1.1.1.1')).toBe(false)
  })

  it('blocks private/reserved IPv6 and unwraps IPv4-mapped addresses', () => {
    expect(isBlockedIp('::1')).toBe(true)
    expect(isBlockedIp('::')).toBe(true)
    expect(isBlockedIp('fc00::1')).toBe(true)
    expect(isBlockedIp('fd12:3456::1')).toBe(true)
    expect(isBlockedIp('fe80::1')).toBe(true)
    expect(isBlockedIp('ff02::1')).toBe(true)
    expect(isBlockedIp('2001:db8::1')).toBe(true)
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true) // mapped loopback
    expect(isBlockedIp('::ffff:192.168.0.1')).toBe(true) // mapped private
    // genuine public v6
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false)
  })

  it('treats unparseable input as blocked', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true)
    expect(isBlockedIp('999.1.1.1')).toBe(true)
  })
})

describe('SmtpNetworkGuard — hostIsAllowlisted', () => {
  const allowlist = ['mail.example.com', 'smtp.corp.local']

  it('matches exact hosts case-insensitively and trims trailing dot', () => {
    expect(hostIsAllowlisted('mail.example.com', allowlist)).toBe(true)
    expect(hostIsAllowlisted('MAIL.EXAMPLE.COM.', allowlist)).toBe(true)
    expect(hostIsAllowlisted('smtp.corp.local', allowlist)).toBe(true)
    expect(hostIsAllowlisted('other.example.com', allowlist)).toBe(false)
  })
})

describe('SmtpNetworkGuard — assertHostAllowed', () => {
  const makeGuard = (resolve: (host: string) => Promise<string[]>, allowlist: string[] = []) =>
    new SmtpNetworkGuard({ resolve, allowlist })

  it('blocks a host that resolves to a private address', async () => {
    const guard = makeGuard(async () => ['10.0.0.5'])
    await expect(guard.assertHostAllowed('internal.example')).rejects.toBeInstanceOf(
      SmtpDestinationBlockedError,
    )
  })

  it('allows a host that resolves only to public addresses', async () => {
    const guard = makeGuard(async () => ['93.184.216.34'])
    await expect(guard.assertHostAllowed('public.example')).resolves.toBeUndefined()
  })

  it('blocks a direct private IP literal host', async () => {
    const guard = makeGuard(async () => [])
    await expect(guard.assertHostAllowed('192.168.1.1')).rejects.toBeInstanceOf(
      SmtpDestinationBlockedError,
    )
  })

  it('allows an explicitly allow-listed private host', async () => {
    const guard = makeGuard(async () => ['10.0.0.5'], ['mx.internal.corp'])
    await expect(guard.assertHostAllowed('mx.internal.corp')).resolves.toBeUndefined()
  })

  it('blocks when a multi-A host has any private address', async () => {
    const guard = makeGuard(async () => ['93.184.216.34', '127.0.0.1'])
    await expect(guard.assertHostAllowed('hybrid.example')).rejects.toBeInstanceOf(
      SmtpDestinationBlockedError,
    )
  })

  it('reports DNS failures as blocked', async () => {
    const guard = makeGuard(async () => {
      throw new Error('ENOTFOUND')
    })
    await expect(guard.assertHostAllowed('nonexistent.invalid')).rejects.toBeInstanceOf(
      SmtpDestinationBlockedError,
    )
  })
})

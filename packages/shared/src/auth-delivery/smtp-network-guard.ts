import { isIP } from 'node:net'
import { promises as dns } from 'node:dns'

/**
 * SMTP destination network guard (E-05, T-05.06.02).
 *
 * SSRF defence: an admin-supplied SMTP `host` is resolved and its addresses are
 * checked against private/reserved ranges before any connection is attempted.
 * This prevents the email-test feature from being abused to reach loopback,
 * RFC1918, link-local, or metadata endpoints (security ledger: "Provider SSRF
 * via SMTP config"). A deployment-level allow-list (`SMTP_HOST_ALLOWLIST`)
 * explicitly opts specific hosts/subnet entries out of the block.
 */

/** Raised when an SMTP destination is (or resolves to) a blocked address. */
export class SmtpDestinationBlockedError extends Error {
  constructor(
    public readonly host: string,
    public readonly detail: string,
  ) {
    super(`SMTP destination '${host}' is not allowed: ${detail}`)
    this.name = 'SmtpDestinationBlockedError'
  }
}

export type HostResolver = (host: string) => Promise<string[]>

/** Default resolver: IP literals pass through; host names resolved over DNS. */
const defaultResolve: HostResolver = async (host) => {
  if (isIP(host) !== 0) return [host]
  const records = await dns.lookup(host, { all: true, verbatim: true })
  return records.map((r) => r.address)
}

/** Env var holding a comma-separated allow-list of SMTP hosts. */
const ALLOWLIST_ENV = 'SMTP_HOST_ALLOWLIST'

function readAllowlistFromEnv(): readonly string[] {
  const raw = process.env[ALLOWLIST_ENV] ?? ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

/** Exact host-match against the allow-list. */
export function hostIsAllowlisted(host: string, allowlist: readonly string[]): boolean {
  const h = normalizeHost(host)
  if (!h) return false
  return allowlist.some((entry) => normalizeHost(entry) === h)
}

/** True when `ip` is a private/reserved address that must not be dialed. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isBlockedIpv4(ip)
  if (version === 6) return isBlockedIpv6(ip)
  // Unparseable input is treated as unsafe rather than connected.
  return true
}

function isBlockedIpv4(ip: string): boolean {
  const oct = ip.split('.').map(Number)
  if (oct.length !== 4 || oct.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true
  const a = oct[0]!
  const b = oct[1]!
  const c = oct[2]!
  // 0.0.0.0/8  – "this network"
  if (a === 0) return true
  // 10.0.0.0/8 – RFC1918
  if (a === 10) return true
  // 100.64.0.0/10 – CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true
  // 127.0.0.0/8 – loopback
  if (a === 127) return true
  // 169.254.0.0/16 – link-local
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12 – RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.0.0.0/24 (IETF), 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
  // 192.168.0.0/16 – RFC1918
  if (a === 192 && b === 168) return true
  // 198.18.0.0/15 – benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true
  // 224.0.0.0/4 – multicast, 240.0.0.0/4 – reserved/broadcast
  if (a >= 224) return true
  return false
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  // IPv4-mapped addresses: unwrap and check the embedded IPv4.
  const mapped = lower.match(/^::ffff:([0-9a-f.]+)$/)
  if (mapped && mapped[1]?.includes('.')) {
    return isBlockedIpv4(mapped[1])
  }
  const value = ipv6ToBigInt(lower)
  if (value === null) return true
  return [
    '::1/128', // loopback
    '::/128', // unspecified
    'fc00::/7', // unique-local
    'fe80::/10', // link-local
    'ff00::/8', // multicast
    '2001:db8::/32', // documentation
  ].some((prefix) => ipv6InRange(value, prefix))
}

/** Expand an IPv6 literal to a 128-bit BigInt, or null when invalid. */
function ipv6ToBigInt(ip: string): bigint | null {
  let s = ip.toLowerCase()
  // Optional trailing IPv4 segment (e.g. ::ffff:192.0.2.1, 2001:db8::1.2.3.4).
  const v4Tail = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (v4Tail) {
    const parts = (v4Tail[2] as string).split('.').map(Number)
    if (parts.some((o) => o < 0 || o > 255)) return null
    const hi = ((parts[0] as number) << 8) | (parts[1] as number)
    const lo = ((parts[2] as number) << 8) | (parts[3] as number)
    s = `${v4Tail[1]}${hi.toString(16)}:${lo.toString(16)}`
  }
  const doubleColon = s.indexOf('::')
  if (doubleColon !== -1) {
    const left = s.slice(0, doubleColon)
    const right = s.slice(doubleColon + 2)
    const leftParts = left ? left.split(':').filter(Boolean) : []
    const rightParts = right ? right.split(':').filter(Boolean) : []
    const missing = 8 - leftParts.length - rightParts.length
    if (missing < 1) return null
    s = [...leftParts, ...Array<string>(missing).fill('0'), ...rightParts].join(':')
  }
  const groups = s.split(':')
  if (groups.length !== 8) return null
  let value = 0n
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    value = (value << 16n) | BigInt(parseInt(g, 16))
  }
  return value
}

function ipv6InRange(value: bigint, prefix: string): boolean {
  const [base, bitsStr] = prefix.split('/') as [string, string]
  const bits = Number(bitsStr)
  const baseValue = ipv6ToBigInt(base)
  if (baseValue === null) return false
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits)
  return (value & mask) === (baseValue & mask)
}

export interface SmtpNetworkGuardDeps {
  /** Explicitly permitted SMTP hosts that bypass the private-range block. */
  allowlist: readonly string[]
  /** Injectable DNS resolver (defaults to `dns.promises.lookup`). */
  resolve: HostResolver
}

const DEFAULT_ALLOWED: SmtpNetworkGuardDeps['allowlist'] = []

/** SSRF guard for SMTP destinations; injectable resolver for tests. */
export class SmtpNetworkGuard {
  private readonly allowlist: readonly string[]
  private readonly resolve: HostResolver

  constructor(deps: Partial<SmtpNetworkGuardDeps> = {}) {
    this.allowlist = deps.allowlist ?? readAllowlistFromEnv() ?? DEFAULT_ALLOWED
    this.resolve = deps.resolve ?? defaultResolve
  }

  /**
   * Throw `SmtpDestinationBlockedError` when `host` resolves to (or is) a
   * private/reserved address and is not on the allow-list.
   */
  async assertHostAllowed(host: string): Promise<void> {
    const h = normalizeHost(host)
    if (!h) throw new SmtpDestinationBlockedError(host, 'empty SMTP host')
    if (hostIsAllowlisted(h, this.allowlist)) return
    let ips: string[]
    try {
      ips = await this.resolve(h)
    } catch (err) {
      throw new SmtpDestinationBlockedError(
        host,
        `host could not be resolved: ${(err as Error).message}`,
      )
    }
    if (ips.length === 0) {
      throw new SmtpDestinationBlockedError(host, 'host resolved to no addresses')
    }
    const blocked = ips.find(isBlockedIp)
    if (blocked !== undefined) {
      throw new SmtpDestinationBlockedError(host, `resolves to blocked address ${blocked}`)
    }
  }
}

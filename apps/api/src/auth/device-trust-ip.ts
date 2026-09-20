import { isIP } from 'node:net';

/** Only the HTTP server's observed address may establish device trust. */
export function deviceTrustIp(ip: string): string | null {
  // Dual-stack servers can report IPv4 peers with this IPv6 prefix.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  const address = mapped ?? ip;
  // Scoped/link-local interface identifiers are not portable trust identities.
  return !address.includes('%') && isIP(address) !== 0 ? address : null;
}

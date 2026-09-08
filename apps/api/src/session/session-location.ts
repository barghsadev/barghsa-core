import { isIP } from 'node:net';
import { lookup } from 'geoip-country';

/** Display-only country estimate from the saved server-observed IP. Never authorizes access. */
export function sessionLocation(deviceInfo: unknown): { countryCode: string } | null {
  if (!deviceInfo || typeof deviceInfo !== 'object' || !('ip' in deviceInfo)) return null;
  const ip = deviceInfo.ip;
  if (typeof ip !== 'string' || ip.length > 45 || !isIP(ip)) return null;
  const country = lookup(ip)?.country;
  return country && /^[A-Z]{2}$/.test(country) ? { countryCode: country } : null;
}

import { isIP } from 'node:net';

/** Trust only configured immediate proxy addresses, never a hop count or wildcard. */
export function trustedProxyIps(raw = process.env.API_TRUSTED_PROXY_IPS ?? ''): string[] {
  if (!raw.trim()) return [];
  const values = raw.split(',').map((value) => value.trim());
  if (values.some((value) => !isIP(value) || value === '0.0.0.0' || value === '::')) {
    throw new Error('API_TRUSTED_PROXY_IPS must contain only explicit proxy IP addresses');
  }
  return [...new Set(values)];
}

import { isIP, type LookupFunction } from 'node:net';
import { promises as dns } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isBlockedIp } from '../auth-delivery/smtp-network-guard.js';

export interface GuardedRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  maxBytes: number;
  timeoutMs?: number;
  allowHttp?: boolean;
  allowlist?: readonly string[];
}

/** Bound the address at socket connect time; preflight alone cannot prevent DNS rebinding. */
export async function guardedRequest(
  rawUrl: string,
  options: GuardedRequest
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && !(options.allowHttp && url.protocol === 'http:'))
    throw new Error('Destination protocol is not allowed');
  if (url.username || url.password || url.hash) throw new Error('Destination URL is not allowed');
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  const allowed =
    options.allowlist?.some((name) => name.toLowerCase().replace(/\.$/, '') === host) ?? false;
  if (!host || (isIP(host) && !allowed && isBlockedIp(host)))
    throw new Error('Destination host is not allowed');
  const lookup: LookupFunction = (hostname, lookupOptions, callback) => {
    void dns.lookup(hostname, { all: true, verbatim: true }).then(
      (addresses) => {
        if (
          !addresses.length ||
          (!allowed && addresses.some(({ address }) => isBlockedIp(address)))
        ) {
          callback(new Error('Destination host is not allowed'), '', 4);
          return;
        }
        if (lookupOptions.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      () => callback(new Error('Destination host could not be resolved'), '', 4)
    );
  };
  if (options.body && Buffer.byteLength(options.body) > 2 * 1024 * 1024)
    throw new Error('Request is too large');
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        lookup,
        agent: false,
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > options.maxBytes) {
            response.destroy(new Error('Response is too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

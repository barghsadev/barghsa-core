import { readCappedBytes } from '../storage/read-capped-bytes.js';

const MAX_BILL_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function fetchBillProviderJson(
  url: URL,
  token: string,
  timeoutMs: number
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'manual',
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) throw new Error('auth_error');
    throw new Error('provider_error');
  }
  if (!response.body) throw new Error('invalid_data');
  const { bytes, truncated } = await readCappedBytes(response.body, MAX_BILL_RESPONSE_BYTES);
  if (truncated) throw new Error('invalid_data');
  return JSON.parse(new TextDecoder().decode(bytes));
}

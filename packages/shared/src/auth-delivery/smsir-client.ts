/** SMS.ir v1 envelope and field names, shared by activation tests and delivery. */
import { DeliveryRejected } from '../notification-delivery/execution.js';
async function smsirRequest(
  path: string,
  apiKey: string,
  base: string,
  body: unknown,
  request: typeof fetch,
  timeout: number,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await request(`${base.replace(/\/$/, '')}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(Math.min(timeout, 15_000))])
      : AbortSignal.timeout(Math.min(timeout, 15_000)),
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    // Typed diagnostics affect health only. HTTP failures still carry no retry-safe rejection proof.
    const diagnostic = (await response.json().catch(() => null)) as {
      status?: unknown;
      Status?: unknown;
    } | null;
    throw Object.assign(new Error('SMS.ir request failed'), {
      httpStatus: response.status,
      smsirStatus: diagnostic?.status ?? diagnostic?.Status,
    });
  }
  const result = (await response.json()) as {
    status?: number;
    Status?: number;
    data?: unknown;
    Data?: unknown;
  };
  const status = result.status ?? result.Status;
  if (typeof status !== 'number' || !Number.isSafeInteger(status))
    throw new Error('SMS.ir returned an invalid outcome');
  if (status !== 1) {
    const data = result.data ?? result.Data;
    if (
      data &&
      typeof data === 'object' &&
      ('messageId' in data || 'MessageId' in data || 'messageIds' in data || 'MessageIds' in data)
    )
      throw new Error('SMS.ir returned a conflicting outcome');
    throw Object.assign(new DeliveryRejected('SMS.ir rejected request'), { smsirStatus: status });
  }
  return result.data ?? result.Data;
}

export async function getSmsirCredit(
  apiKey: string,
  base: string,
  request: typeof fetch = fetch
): Promise<number> {
  const credit = await smsirRequest('credit', apiKey, base, undefined, request, 15_000);
  if (typeof credit !== 'number' || !Number.isFinite(credit) || credit < 0)
    throw new Error('SMS.ir returned invalid credit');
  return credit;
}

export async function sendSmsirVerification(
  apiKey: string,
  base: string,
  mobile: string,
  template: string,
  parameters: Array<{ name: string; value: string | number }>,
  request: typeof fetch = fetch,
  timeout = 15_000,
  signal?: AbortSignal
): Promise<string> {
  if (!/^\d+$/.test(template) || !Number.isSafeInteger(Number(template)) || Number(template) <= 0)
    throw new Error('Invalid SMS.ir template');
  const data = (await smsirRequest(
    'send/verify',
    apiKey,
    base,
    {
      Mobile: mobile.replace(/^\+98/, '0'),
      TemplateId: Number(template),
      Parameters: parameters.map((item) => ({ Name: item.name, Value: String(item.value) })),
    },
    request,
    timeout,
    signal
  )) as { messageId?: number; MessageId?: number } | null;
  const id = data?.messageId ?? data?.MessageId;
  if (!Number.isSafeInteger(id) || id! <= 0) throw new Error('SMS.ir returned no receipt');
  return String(id);
}

export async function sendSmsirText(
  apiKey: string,
  base: string,
  mobile: string,
  sender: string,
  text: string,
  request: typeof fetch = fetch,
  timeout = 15_000,
  signal?: AbortSignal
): Promise<string> {
  if (
    !/^\d+$/.test(sender) ||
    !Number.isSafeInteger(Number(sender)) ||
    Number(sender) <= 0 ||
    !text.trim() ||
    text.length > 1600
  )
    throw new DeliveryRejected('Invalid direct SMS');
  const data = (await smsirRequest(
    'send/bulk',
    apiKey,
    base,
    { lineNumber: Number(sender), messageText: text, mobiles: [mobile.replace(/^\+98/, '0')] },
    request,
    timeout,
    signal
  )) as { messageIds?: number[]; MessageIds?: number[] } | null;
  const ids = data?.messageIds ?? data?.MessageIds;
  if (!Array.isArray(ids) || ids.length !== 1 || !Number.isSafeInteger(ids[0]) || ids[0]! <= 0)
    throw new Error('SMS.ir returned no single-recipient receipt');
  return String(ids[0]);
}

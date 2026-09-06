/** SMS.ir v1 envelope and field names, shared by activation tests and delivery. */
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
  if (!response.ok) throw new Error('SMS.ir request failed');
  const result = (await response.json()) as {
    status?: number;
    Status?: number;
    data?: unknown;
    Data?: unknown;
  };
  if ((result.status ?? result.Status) !== 1) throw new Error('SMS.ir rejected request');
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

import { expect, it, vi } from 'vitest';
import { getSmsirCredit, sendSmsirVerification, sendSmsirText } from './smsir-client.js';
import { DeliveryRejected } from '../notification-delivery/execution.js';

it('uses the provider request contract and requires a successful receipt', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ status: 1, data: { messageId: 123 } })));
  expect(
    await sendSmsirVerification(
      'key',
      'https://api.sms.ir',
      '+989121234567',
      '12345',
      [{ name: 'CODE', value: '123456' }],
      request
    )
  ).toBe('123');
  expect(request.mock.calls[0]![0]).toBe('https://api.sms.ir/v1/send/verify');
  expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({
    Mobile: '09121234567',
    TemplateId: 12345,
    Parameters: [{ Name: 'CODE', Value: '123456' }],
  });
  for (const body of [{}, { status: 1, data: {} }, { status: 0, data: { messageId: 123 } }]) {
    request.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(
      sendSmsirVerification('key', 'https://api.sms.ir', '09121234567', '12345', [], request)
    ).rejects.toThrow();
  }
});

it('rejects empty or failed credit responses instead of enabling a broken provider', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 1, data: 0 })));
  expect(await getSmsirCredit('key', 'https://api.sms.ir', request)).toBe(0);
  for (const body of [{}, { status: 0, data: 100 }, { status: 1, data: '100' }]) {
    request.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(getSmsirCredit('key', 'https://api.sms.ir', request)).rejects.toThrow();
  }
});

it('sends direct text to one recipient using the configured line and requires its message receipt', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ status: 1, data: { packId: 'pack', messageIds: [456] } }))
    );
  expect(
    await sendSmsirText(
      'key',
      'https://api.sms.ir',
      '+989121234567',
      '30002108008345',
      'آزمون',
      request
    )
  ).toBe('456');
  expect(request.mock.calls[0]![0]).toBe('https://api.sms.ir/v1/send/bulk');
  expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({
    lineNumber: 30002108008345,
    messageText: 'آزمون',
    mobiles: ['09121234567'],
  });
  for (const data of [
    {},
    { messageIds: [] },
    { messageIds: [0] },
    { messageIds: [1, 2] },
    { messageIds: ['456'] },
  ]) {
    request.mockResolvedValueOnce(new Response(JSON.stringify({ status: 1, data })));
    await expect(
      sendSmsirText('key', 'https://api.sms.ir', '09121234567', '3000', 'text', request)
    ).rejects.toThrow('receipt');
  }
  request.mockResolvedValueOnce(
    new Response(JSON.stringify({ status: 0, data: { messageIds: [456] } }))
  );
  await expect(
    sendSmsirText('key', 'https://api.sms.ir', '09121234567', '3000', 'text', request)
  ).rejects.toThrow('conflicting');
});

it('rejects invalid direct text or sender before a provider request and preserves HTTP uncertainty', async () => {
  const request = vi.fn<typeof fetch>();
  for (const [sender, text] of [
    ['not-a-number', 'text'],
    ['0', 'text'],
    ['9007199254740992', 'text'],
    ['3000', ' '],
    ['3000', 'x'.repeat(1601)],
  ]) {
    await expect(
      sendSmsirText('key', 'https://api.sms.ir', '09121234567', sender!, text!, request)
    ).rejects.toThrow('Invalid');
  }
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(
    new Response(JSON.stringify({ status: 123, data: null }), { status: 400 })
  );
  const error = await sendSmsirText(
    'key',
    'https://api.sms.ir',
    '09121234567',
    '3000',
    'text',
    request
  ).catch((error) => error);
  expect(error).toMatchObject({ httpStatus: 400, smsirStatus: 123 });
  expect(error).not.toBeInstanceOf(DeliveryRejected);
  expect(request).toHaveBeenCalledTimes(1);
});

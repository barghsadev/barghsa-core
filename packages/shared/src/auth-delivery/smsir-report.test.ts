import { expect, it, vi } from 'vitest';
import { getSmsirDeliveryReport } from './smsir-client.js';

it('authenticates the report and validates the exact message, destination, sender and dates', async () => {
  const sent = Math.floor(Date.now() / 1000) - 10;
  const accepted = {
    messageId: '123',
    destination: '+989121234567',
    sender: '3000',
    acceptedAt: new Date(sent * 1000),
  };
  const data = {
    messageId: 123,
    mobile: 9121234567,
    lineNumber: 3000,
    sendDateTime: sent,
    deliveryDateTime: sent + 1,
    deliveryState: 1,
    messageText: 'private message',
  };
  const request = vi.fn<typeof fetch>();
  request.mockResolvedValueOnce(Response.json({ status: 1, data }));
  expect(
    await getSmsirDeliveryReport('fixture-key', 'https://api.sms.ir', accepted, request)
  ).toEqual({
    state: 1,
    deliveredAt: new Date((sent + 1) * 1000),
  });
  expect(request).toHaveBeenCalledWith(
    'https://api.sms.ir/v1/send/123',
    expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      headers: expect.objectContaining({ 'x-api-key': 'fixture-key' }),
    })
  );
  for (const invalid of [
    { ...data, messageId: 124 },
    { ...data, mobile: 9121234568 },
    { ...data, lineNumber: 3001 },
    { ...data, sendDateTime: sent - 301 },
    { ...data, deliveryDateTime: sent - 1 },
    { ...data, deliveryDateTime: sent + 600 },
    { ...data, deliveryDateTime: null },
    { ...data, deliveryState: 8 },
  ]) {
    request.mockResolvedValueOnce(Response.json({ status: 1, data: invalid }));
    await expect(
      getSmsirDeliveryReport('key', 'https://api.sms.ir', accepted, request)
    ).rejects.toThrow('SMS.ir report did not match the accepted send');
  }
  request.mockResolvedValueOnce(Response.json({ status: 10, data: null }, { status: 401 }));
  await expect(
    getSmsirDeliveryReport('key', 'https://api.sms.ir', accepted, request)
  ).rejects.toThrow('SMS.ir request failed');
});

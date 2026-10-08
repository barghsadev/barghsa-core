import { expect, it, vi } from 'vitest';
import {
  privateTelegramUpdate,
  TelegramClient,
  validTelegramWebhookSecret,
  telegramConfirmationCode,
} from './telegram-protocol';

const token = '8703508822:fixture_secret_not_a_live_bot_token';
it('binds confirmation codes to the protected secret, intent and private identity', () => {
  const secret = 's'.repeat(48),
    intent = '0199f111-1111-7111-8111-111111111111';
  const code = telegramConfirmationCode(secret, intent, '123');
  expect(code).toMatch(/^\d{6}$/);
  expect(telegramConfirmationCode(secret, intent, '123')).toBe(code);
  expect(
    new Set([
      code,
      telegramConfirmationCode('t'.repeat(48), intent, '123'),
      telegramConfirmationCode(secret, intent + 'x', '123'),
      telegramConfirmationCode(secret, intent, '124'),
    ]).size
  ).toBe(4);
});
const message = {
  message_id: 7,
  from: { id: 1234567890123, is_bot: false },
  chat: { id: 1234567890123, type: 'private' },
  text: 'پرسش درباره خدمات',
};

it('accepts exact private identities with safe 52-bit identifiers and bounded text', () => {
  expect(privateTelegramUpdate({ update_id: 0, message })).toEqual({
    updateId: 0,
    messageId: 7,
    telegramUserId: '1234567890123',
    chatId: '1234567890123',
    text: message.text,
  });
});

it.each([
  { ...message, chat: { ...message.chat, type: 'supergroup', id: -1004467450624 } },
  { ...message, chat: { ...message.chat, id: 12 } },
  { ...message, from: { ...message.from, is_bot: true } },
  { ...message, from: { ...message.from, id: Number.MAX_SAFE_INTEGER } },
  { ...message, forward_origin: {} },
  { ...message, via_bot: {} },
  { ...message, guest_query_id: 'guest' },
  { ...message, text: 'x'.repeat(4097) },
])('refuses non-private, forged, forwarded and oversized update identity %#', (candidate) => {
  expect(privateTelegramUpdate({ update_id: 2, message: candidate })).toBeNull();
});

it('ignores edited/channel updates and rejects invalid update IDs without trusting overrides', () => {
  expect(privateTelegramUpdate({ update_id: 1, edited_message: message })).toBeNull();
  expect(privateTelegramUpdate({ update_id: -1, message })).toBeNull();
  expect(privateTelegramUpdate({ update_id: 1.5, message })).toBeNull();
  expect(privateTelegramUpdate({ update_id: 1, channel_post: message })).toBeNull();
});

it('fails webhook proof closed for missing/malformed/array/oversized/mismatched secrets', () => {
  const secret = 'a'.repeat(48);
  expect(validTelegramWebhookSecret(secret, secret)).toBe(true);
  for (const supplied of [undefined, ['a'.repeat(48)], 'b'.repeat(48), 'a'.repeat(257)])
    expect(validTelegramWebhookSecret(secret, supplied)).toBe(false);
  expect(validTelegramWebhookSecret(undefined, secret)).toBe(false);
  expect(validTelegramWebhookSecret('short', 'short')).toBe(false);
});

it('requires the actual configured bot identity and never exposes provider errors', async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        result: { id: 8703508822, is_bot: true, username: 'barghsa_dev_bot' },
      })
    )
  );
  const client = new TelegramClient(token, request);
  expect(await client.verifyIdentity()).toBe(true);
  request.mockResolvedValue(
    new Response(
      JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: 'another_bot' } })
    )
  );
  expect(await client.verifyIdentity()).toBe(false);
  request.mockRejectedValue(new Error('https://api.telegram.org/bot' + token));
  expect(await client.verifyIdentity()).toBe(false);
});

it('returns a real private message receipt and disables parsing/previews/forwarding', async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 42, chat: { id: 1234567890123, type: 'private' } },
      })
    )
  );
  const client = new TelegramClient(token, request);
  expect(await client.sendPrivateMessage('1234567890123', 'پاسخ')).toEqual({
    status: 'sent',
    messageId: 42,
    chatId: '1234567890123',
  });
  expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({
    chat_id: '1234567890123',
    text: 'پاسخ',
    protect_content: true,
    link_preview_options: { is_disabled: true },
  });
  expect(request.mock.calls[0]![1].redirect).toBe('error');
});

it.each(['-1004467450624', '@BarghsaReleaseRadar', '01', '1.5', '9007199254740991'])(
  'refuses release/group/noncanonical destination %s before any I/O',
  async (chatId) => {
    const request = vi.fn();
    await expect(
      new TelegramClient(token, request).sendPrivateMessage(chatId, 'text')
    ).rejects.toThrow('TELEGRAM_MESSAGE_INVALID');
    expect(request).not.toHaveBeenCalled();
  }
);

it('keeps unknown sends unknown without retrying or surfacing secret-bearing errors', async () => {
  const request = vi.fn().mockRejectedValue(new Error('failed ' + token));
  expect(await new TelegramClient(token, request).sendPrivateMessage('12', 'text')).toEqual({
    status: 'unknown',
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  { ok: true, result: { message_id: 42, chat: { id: 13, type: 'private' } } },
  { ok: true, result: { message_id: 42, chat: { id: 12, type: 'group' } } },
  { ok: true, result: { message_id: 0, chat: { id: 12, type: 'private' } } },
  { ok: false, error_code: 500, description: token },
])('requires a trustworthy, exact private receipt %#', async (body) => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
  expect(await new TelegramClient(token, request).sendPrivateMessage('12', 'text')).toEqual({
    status: 'unknown',
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it('bounds malformed/oversized responses and preserves explicit safe rejection/retry receipts', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response('x'.repeat(65537)))
    .mockResolvedValueOnce(new Response('not-json'))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 30 } }),
        { status: 429 }
      )
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 403, description: token }), {
        status: 403,
      })
    );
  const client = new TelegramClient(token, request);
  expect(await client.sendPrivateMessage('12', 'text')).toEqual({ status: 'unknown' });
  expect(await client.sendPrivateMessage('12', 'text')).toEqual({ status: 'unknown' });
  expect(await client.sendPrivateMessage('12', 'text')).toEqual({
    status: 'rejected',
    code: 429,
    retryAfterSeconds: 30,
  });
  expect(await client.sendPrivateMessage('12', 'text')).toEqual({
    status: 'rejected',
    code: 403,
    retryAfterSeconds: null,
  });
  expect(request).toHaveBeenCalledTimes(4);
});

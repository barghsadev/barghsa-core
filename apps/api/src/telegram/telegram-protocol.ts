import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const MAX_ID = 2 ** 52 - 1;
const validId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_ID;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const TELEGRAM_BOT_USERNAME = 'barghsa_dev_bot';

/** Reconstruct a short-lived private-chat code without storing the code or bearer token. */
export function telegramConfirmationCode(secret: string, intentId: string, telegramUserId: string) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw new Error('TELEGRAM_CONFIG_INVALID');
  const value =
    createHmac('sha256', secret)
      .update(`barghsa:telegram-link:v1:${intentId}:${telegramUserId}`)
      .digest()
      .readUInt32BE(0) % 1_000_000;
  return String(value).padStart(6, '0');
}

export interface PrivateTelegramUpdate {
  updateId: number;
  messageId: number;
  telegramUserId: string;
  chatId: string;
  text: string;
}

/** Never adopt group/channel/guest/forwarded identities or edited-message replays. */
export function privateTelegramUpdate(value: unknown): PrivateTelegramUpdate | null {
  const update = record(value);
  const message = record(update?.message);
  const from = record(message?.from);
  const chat = record(message?.chat);
  if (
    !update ||
    typeof update.update_id !== 'number' ||
    !Number.isSafeInteger(update.update_id) ||
    update.update_id < 0 ||
    !message ||
    !from ||
    !chat ||
    chat.type !== 'private' ||
    from.is_bot !== false ||
    !validId(from.id) ||
    chat.id !== from.id ||
    !validId(message.message_id) ||
    message.forward_origin !== undefined ||
    message.via_bot !== undefined ||
    message.guest_query_id !== undefined ||
    typeof message.text !== 'string' ||
    message.text.length === 0 ||
    message.text.length > 4096
  )
    return null;
  return {
    updateId: update.update_id,
    messageId: message.message_id,
    telegramUserId: String(from.id),
    chatId: String(chat.id),
    text: message.text,
  };
}

/** A missing configuration fails closed; tokens never enter error messages. */
export function validTelegramWebhookSecret(expected: string | undefined, supplied: unknown) {
  if (
    !expected ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(expected) ||
    typeof supplied !== 'string' ||
    supplied.length > 256
  )
    return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(expected), hash(supplied));
}

export type TelegramSendReceipt =
  | { status: 'sent'; messageId: number; chatId: string }
  | { status: 'rejected'; code: number; retryAfterSeconds: number | null }
  | { status: 'unknown' };

/** Fixed official endpoint, bounded responses and no automatic send replay. */
export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch
  ) {
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('TELEGRAM_CONFIG_INVALID');
  }

  private async call(method: 'getMe' | 'sendMessage', payload: Record<string, unknown>) {
    const response = await this.request(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.body) throw new Error('TELEGRAM_RESPONSE_INVALID');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 65_536) throw new Error('TELEGRAM_RESPONSE_LIMIT');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!body) throw new Error('TELEGRAM_RESPONSE_INVALID');
    return { response, body };
  }

  async verifyIdentity(): Promise<boolean> {
    try {
      const { response, body } = await this.call('getMe', {});
      const bot = record(body.result);
      return (
        response.ok &&
        body.ok === true &&
        bot?.is_bot === true &&
        validId(bot.id) &&
        bot.username === TELEGRAM_BOT_USERNAME
      );
    } catch {
      return false;
    }
  }

  async sendPrivateMessage(chatId: string, text: string): Promise<TelegramSendReceipt> {
    if (
      !/^[1-9]\d*$/.test(chatId) ||
      !validId(Number(chatId)) ||
      String(Number(chatId)) !== chatId ||
      text.length === 0 ||
      text.length > 4096
    )
      throw new Error('TELEGRAM_MESSAGE_INVALID');
    try {
      const { response, body } = await this.call('sendMessage', {
        chat_id: chatId,
        text,
        protect_content: true,
        link_preview_options: { is_disabled: true },
      });
      if (body.ok === false && [400, 401, 403, 429].includes(Number(body.error_code))) {
        const parameters = record(body.parameters);
        const retry = parameters?.retry_after;
        return {
          status: 'rejected',
          code: Number(body.error_code),
          retryAfterSeconds:
            body.error_code === 429 &&
            typeof retry === 'number' &&
            Number.isInteger(retry) &&
            retry > 0 &&
            retry <= 3600
              ? retry
              : null,
        };
      }
      const sent = record(body.result);
      const chat = record(sent?.chat);
      if (
        response.ok &&
        body.ok === true &&
        sent &&
        validId(sent.message_id) &&
        chat?.type === 'private' &&
        validId(chat.id) &&
        String(chat.id) === chatId
      )
        return { status: 'sent', messageId: sent.message_id, chatId };
    } catch {
      // A timeout, malformed/oversized reply or mismatched receipt may follow a send.
      // Keep the outcome unknown; callers must persist it without blind retries.
    }
    return { status: 'unknown' };
  }
}

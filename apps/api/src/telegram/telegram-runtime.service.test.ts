import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AiStatelessKnowledgeService } from '../ai-agents/ai-stateless-knowledge.service.js';
import { TelegramLinksService } from './telegram-links.service.js';
import { TelegramRuntimeService } from './telegram-runtime.service.js';

const botIdentity = (username = 'barghsa_dev_bot') =>
  Response.json({ ok: true, result: { id: 42, is_bot: true, username } });

let links: TelegramLinksService;
let runtime: TelegramRuntimeService;
let request: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('CUSTOMER_TELEGRAM_BOT_TOKEN', '42:owned_fixture_not_a_live_bot_token');
  vi.stubEnv('CUSTOMER_TELEGRAM_WEBHOOK_SECRET', 'a'.repeat(32));
  vi.stubEnv('CUSTOMER_TELEGRAM_TRANSPORT', 'external-eu');
  request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
  links = new TelegramLinksService();
  runtime = new TelegramRuntimeService(links, {} as AiStatelessKnowledgeService);
});

afterEach(async () => {
  await runtime.onModuleDestroy();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('rechecks the configured bot after a startup outage without accepting callbacks early', async () => {
  request
    .mockRejectedValueOnce(new Error('Test connection unavailable'))
    .mockResolvedValueOnce(botIdentity('different_bot'))
    .mockResolvedValueOnce(botIdentity());

  await runtime.onModuleInit();
  expect(links.configured()).toBe(false);
  await expect(runtime.receive({})).rejects.toMatchObject({ status: 503 });
  await vi.advanceTimersByTimeAsync(14_999);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  expect(links.configured()).toBe(false);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(request).toHaveBeenCalledTimes(3);
  expect(links.configured()).toBe(true);
  await expect(runtime.receive({})).resolves.toEqual({ accepted: true, ignored: true });
});

it('cancels a pending identity retry at shutdown', async () => {
  request.mockRejectedValueOnce(new Error('Test connection unavailable'));
  await runtime.onModuleInit();
  await runtime.onModuleDestroy();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(request).toHaveBeenCalledOnce();
  expect(links.configured()).toBe(false);
});

it('keeps the transport offline when an in-flight identity check finishes after shutdown', async () => {
  let resolveIdentity!: (identity: Response) => void;
  request.mockRejectedValueOnce(new Error('Test connection unavailable')).mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      resolveIdentity = resolve;
    })
  );
  await runtime.onModuleInit();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(request).toHaveBeenCalledTimes(2);
  await runtime.onModuleDestroy();
  resolveIdentity(botIdentity());
  await vi.advanceTimersByTimeAsync(0);
  expect(links.configured()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

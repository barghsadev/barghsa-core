import { createHmac, randomUUID } from 'node:crypto';
import {
  HttpException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { telegramText } from '@barghsa/i18n/telegram';
import { AiStatelessKnowledgeService } from '../ai-agents/ai-stateless-knowledge.service.js';
import { appendAiAudit } from '../ai-agents/ai-audit.js';
import { redactAiText } from '../ai-agents/ai-prompt-redaction.js';
import { TelegramLinksService } from './telegram-links.service.js';
import {
  privateTelegramUpdate,
  TelegramClient,
  telegramConfirmationCode,
} from './telegram-protocol.js';
import { rootReleaseVersion } from './root-version.js';

type QueueRow = {
  id: string;
  kind: string;
  status: string;
  intent_id: string | null;
  link_id: string | null;
  chat_id: string;
  telegram_user_id: string;
  message: string | null;
  lease_token: string | null;
  attempts: number;
  dispatched?: boolean;
  answer: {
    reply: string;
    agentId?: string;
    sources?: Array<{ kbId: string; title: string; excerpt: string }>;
  } | null;
};
type Binding = {
  id: string;
  user_id: string;
  profile_id: string;
  telegram_user_id: string;
  chat_id: string;
  locale: 'fa' | 'en';
};
const unavailable = () => new HttpException({ error: 'TELEGRAM_UNAVAILABLE' }, 503);

/** A bounded durable consumer; model I/O still runs through the isolated AI process. */
@Injectable()
export class TelegramRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramRuntimeService.name);
  private client: TelegramClient | null = null;
  private version: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  constructor(
    private readonly links: TelegramLinksService,
    private readonly knowledge: AiStatelessKnowledgeService
  ) {}

  async onModuleInit() {
    if (!this.links.credentialsConfigured()) return;
    this.version = rootReleaseVersion();
    if (!this.version) return;
    const client = new TelegramClient(process.env['CUSTOMER_TELEGRAM_BOT_TOKEN']!);
    if (!(await client.verifyIdentity())) return;
    this.client = client;
    this.links.setTransportReady(true);
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.tick()
        .catch(() => this.logger.warn('Telegram consumer tick unavailable'))
        .finally(() => {
          this.running = null;
        });
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.links.setTransportReady(false);
    // A hard-stop lease is recovered as failed generation or unknown sending, never resent blindly.
  }

  private async binding(id: string): Promise<Binding> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const pointer = (
        await client.query<Binding>('SELECT * FROM telegram_links WHERE id=$1', [id])
      ).rows[0];
      if (!pointer) throw new HttpException({ error: 'TELEGRAM_LINK_UNAVAILABLE' }, 403);
      const profile = (
        await client.query(
          'SELECT archived,user_id,profile_type FROM profiles WHERE id=$1 FOR SHARE',
          [pointer.profile_id]
        )
      ).rows[0];
      const account = (
        await client.query(
          'SELECT disabled_at,activation_token,locale FROM users WHERE user_id=$1 FOR UPDATE',
          [pointer.user_id]
        )
      ).rows[0];
      const members = await client.query(
        "SELECT role FROM profile_agents WHERE profile_id=$1 AND user_id=$2 AND role IN ('Manager','Finance','Legal') FOR SHARE",
        [pointer.profile_id, pointer.user_id]
      );
      const current = (
        await client.query<Binding>(
          'SELECT * FROM telegram_links WHERE id=$1 AND revoked_at IS NULL FOR SHARE',
          [id]
        )
      ).rows[0];
      if (
        !current ||
        !profile ||
        profile.archived ||
        !account ||
        account.disabled_at ||
        account.activation_token ||
        (profile.user_id !== pointer.user_id &&
          !(profile.profile_type === 'LEGAL' && members.rowCount))
      )
        throw new HttpException({ error: 'TELEGRAM_LINK_UNAVAILABLE' }, 403);
      await client.query('COMMIT');
      return { ...current, locale: account.locale === 'en' ? 'en' : 'fa' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async receive(raw: unknown) {
    if (!this.client || !this.links.configured()) throw unavailable();
    const update = privateTelegramUpdate(raw);
    if (!update) return { accepted: true, ignored: true };
    const requestHash = createHmac('sha256', process.env['CUSTOMER_TELEGRAM_BOT_TOKEN']!)
      .update('barghsa:telegram-update:v1:' + JSON.stringify(update))
      .digest('hex');
    const existing = (
      await getDbPool().query<{ id: string; request_hash: string }>(
        'SELECT id,request_hash FROM telegram_updates WHERE update_id=$1',
        [update.updateId]
      )
    ).rows[0];
    if (existing) {
      if (existing.request_hash !== requestHash)
        throw new HttpException({ error: 'TELEGRAM_UPDATE_CONFLICT' }, 409);
      return { accepted: true, id: existing.id };
    }
    const pending = (
      await getDbPool().query<{ count: number }>(
        "SELECT count(*)::int AS count FROM telegram_updates WHERE status IN ('queued','processing','ready','sending')"
      )
    ).rows[0]!;
    if (pending.count >= 100) throw unavailable();
    const start = /^\/start(?:@barghsa_dev_bot)? ([A-Za-z0-9_-]{43})$/.exec(update.text);
    if (start) {
      try {
        return { accepted: true, id: await this.links.claim(update, start[1]!, requestHash) };
      } catch (error) {
        if (error instanceof HttpException && [401, 403, 404, 409].includes(error.getStatus()))
          return { accepted: true, ignored: true };
        throw error;
      }
    }
    if (update.text.startsWith('/') || update.text.length > 1000)
      return { accepted: true, ignored: true };
    const linked = (
      await getDbPool().query<{ id: string }>(
        'SELECT id FROM telegram_links WHERE telegram_user_id=$1 AND chat_id=$2 AND revoked_at IS NULL',
        [update.telegramUserId, update.chatId]
      )
    ).rows[0];
    if (!linked) return { accepted: true, ignored: true };
    let binding: Binding;
    try {
      binding = await this.binding(linked.id);
    } catch (error) {
      if (error instanceof HttpException) return { accepted: true, ignored: true };
      throw error;
    }
    const quota = (
      await getDbPool().query<{ count: number }>(
        'SELECT count FROM rate_limit_rolling(true,$1,60000,5,true)',
        ['telegram:admission:' + binding.user_id + ':' + binding.profile_id]
      )
    ).rows[0]!;
    if (Number(quota.count) > 5) return { accepted: true, ignored: true };
    const message = redactAiText(update.text).text.slice(0, 1000);
    const queued = (
      await getDbPool().query<{ id: string; request_hash: string }>(
        `INSERT INTO telegram_updates(update_id,message_id,telegram_user_id,chat_id,kind,link_id,request_hash,message)
       VALUES($1,$2,$3,$4,'question',$5,$6,$7) ON CONFLICT(update_id) DO NOTHING RETURNING id,request_hash`,
        [
          update.updateId,
          update.messageId,
          update.telegramUserId,
          update.chatId,
          linked.id,
          requestHash,
          message,
        ]
      )
    ).rows[0];
    if (!queued) {
      const replay = (
        await getDbPool().query<{ id: string; request_hash: string }>(
          'SELECT id,request_hash FROM telegram_updates WHERE update_id=$1',
          [update.updateId]
        )
      ).rows[0];
      if (replay?.request_hash !== requestHash)
        throw new HttpException({ error: 'TELEGRAM_UPDATE_CONFLICT' }, 409);
      return { accepted: true, id: replay.id };
    }
    return { accepted: true, id: queued.id };
  }

  private async settle(
    row: QueueRow,
    status: string,
    answer: QueueRow['answer'],
    error: string | null = null
  ) {
    const saved = await getDbPool().query(
      `UPDATE telegram_updates SET status=$3,answer=COALESCE($4::jsonb,answer),last_error=$5,
       lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`,
      [row.id, row.lease_token, status, answer === null ? null : JSON.stringify(answer), error]
    );
    if (saved.rowCount !== 1) throw new Error('TELEGRAM_LEASE_LOST');
  }

  private async process(row: QueueRow) {
    if (row.kind === 'link_confirmation') {
      const intent = await this.links.claimForDelivery(
        row.intent_id!,
        row.telegram_user_id,
        row.chat_id
      );
      if (!intent) return this.settle(row, 'denied', null, 'link_claim_unavailable');
      const locale = intent.locale === 'en' ? 'en' : 'fa';
      // The queue stores no plaintext confirmation code. Rendering happens at the final send boundary.
      return this.settle(row, 'ready', { reply: locale }, null);
    }
    const binding = await this.binding(row.link_id!);
    const result = await this.knowledge.askTelegram(
      row.message!,
      binding.user_id,
      binding.profile_id,
      async () => {
        const current = await this.binding(row.link_id!);
        if (current.id !== binding.id) throw unavailable();
      }
    );
    const answer = {
      reply: redactAiText(result.answer.reply).text,
      agentId: result.agentId,
      sources: result.answer.sources.map((source) => ({
        kbId: source.kbId,
        title: redactAiText(source.title).text,
        excerpt: redactAiText(source.excerpt).text.slice(0, 180),
      })),
    };
    await appendAiAudit({
      sessionId: null,
      userId: binding.user_id,
      profileId: binding.profile_id,
      agentSlot: 'telegram_chatbot',
      toolName: 'telegram_knowledge_question',
      input: { message: row.message, requestId: row.id },
      output: { sourceCount: answer.sources.length },
      authorizationResult: 'allowed',
      confirmationRequired: false,
      confirmationResult: 'not_required',
      tokenUsage: result.tokenUsage,
      latencyMs: result.latencyMs,
    });
    await this.settle(row, 'ready', answer);
  }

  private async send(row: QueueRow) {
    let text: string;
    let locale: 'fa' | 'en';
    if (row.kind === 'link_confirmation') {
      const intent = await this.links.claimForDelivery(
        row.intent_id!,
        row.telegram_user_id,
        row.chat_id
      );
      if (!intent) return this.settle(row, 'failed', null, 'link_claim_unavailable');
      locale = intent.locale === 'en' ? 'en' : 'fa';
      text = telegramText('privateCode', locale).replace(
        '{code}',
        telegramConfirmationCode(
          process.env['CUSTOMER_TELEGRAM_WEBHOOK_SECRET']!,
          intent.id,
          intent.telegram_user_id
        )
      );
    } else {
      const binding = await this.binding(row.link_id!);
      locale = binding.locale;
      if (
        binding.telegram_user_id !== row.telegram_user_id ||
        binding.chat_id !== row.chat_id ||
        !row.answer?.agentId ||
        !(await this.knowledge.verifyTelegramSources(
          row.answer.agentId,
          (row.answer.sources ?? []).map((source) => source.kbId)
        ))
      )
        return this.settle(row, 'failed', null, 'knowledge_scope_changed');
      const sources = (row.answer.sources ?? [])
        .map((source) => source.title + '\n' + source.excerpt.slice(0, 180))
        .join('\n')
        .slice(0, 700);
      text =
        telegramText('knowledge', locale) +
        '\n\n' +
        row.answer.reply.slice(0, 2800) +
        '\n\n' +
        telegramText('sources', locale) +
        ':\n' +
        sources;
    }
    text += '\n\n' + telegramText('version', locale).replace('{version}', this.version!);
    if (row.kind === 'question') {
      const binding = await this.binding(row.link_id!);
      await appendAiAudit({
        sessionId: null,
        userId: binding.user_id,
        profileId: binding.profile_id,
        agentSlot: 'telegram_chatbot',
        toolName: 'telegram_reply_dispatch',
        input: { requestId: row.id },
        output: { status: 'dispatch_authorized' },
        authorizationResult: 'allowed',
        confirmationRequired: false,
        confirmationResult: 'not_required',
      });
    }
    row.dispatched = true;
    const receipt = await this.client!.sendPrivateMessage(
      row.chat_id,
      text.slice(0, 4096).replace(/[\uD800-\uDBFF]$/, '')
    );
    if (receipt.status === 'sent') {
      const result = await getDbPool().query(
        `UPDATE telegram_updates SET status='sent',sent_message_id=$3,last_error=NULL,lease_token=NULL,lease_until=NULL
         WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`,
        [row.id, row.lease_token, receipt.messageId]
      );
      if (result.rowCount !== 1) throw new Error('TELEGRAM_LEASE_LOST');
    } else if (
      receipt.status === 'rejected' &&
      receipt.code === 429 &&
      receipt.retryAfterSeconds &&
      row.attempts < 3
    ) {
      const result = await getDbPool().query(
        `UPDATE telegram_updates SET status='ready',last_error='telegram_rate_limited',lease_token=NULL,lease_until=NULL,
         next_attempt_at=clock_timestamp()+($3::int*INTERVAL '1 second') WHERE id=$1 AND lease_token=$2 AND lease_until>clock_timestamp()`,
        [row.id, row.lease_token, receipt.retryAfterSeconds]
      );
      if (result.rowCount !== 1) throw new Error('TELEGRAM_LEASE_LOST');
    } else
      await this.settle(
        row,
        receipt.status === 'unknown' ? 'unknown' : 'failed',
        null,
        receipt.status === 'unknown' ? 'delivery_unknown' : 'telegram_rejected'
      );
  }

  private async tick() {
    const pool = getDbPool();
    await pool.query(
      `UPDATE telegram_updates SET status=CASE WHEN status='sending' THEN 'unknown' ELSE 'failed' END,
       last_error=CASE WHEN status='sending' THEN 'delivery_unknown' ELSE 'generation_interrupted' END,
       lease_token=NULL,lease_until=NULL WHERE status IN ('processing','sending') AND lease_until<=clock_timestamp()`
    );
    const lease = randomUUID();
    const row = (
      await pool.query<QueueRow>(
        `WITH candidate AS(SELECT id FROM telegram_updates WHERE status IN ('queued','ready')
        AND attempts<3 AND next_attempt_at<=clock_timestamp()
        ORDER BY (kind='link_confirmation') DESC,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
       UPDATE telegram_updates u SET status=CASE WHEN u.status='queued' THEN 'processing' ELSE 'sending' END,
        lease_token=$1,lease_until=clock_timestamp()+INTERVAL '3 minutes',attempts=u.attempts+1
       FROM candidate c WHERE u.id=c.id RETURNING u.*`,
        [lease]
      )
    ).rows[0];
    if (!row) return;
    try {
      if (row.status === 'processing') await this.process(row);
      else await this.send(row);
    } catch (error) {
      const failure =
        error instanceof HttpException && [401, 403].includes(error.getStatus())
          ? 'authority_changed'
          : 'telegram_processing_failed';
      if (row.kind === 'question' && row.status === 'processing') {
        const link = (
          await pool.query<{ user_id: string; profile_id: string }>(
            'SELECT user_id,profile_id FROM telegram_links WHERE id=$1',
            [row.link_id]
          )
        ).rows[0];
        if (link)
          await appendAiAudit({
            sessionId: null,
            userId: link.user_id,
            profileId: link.profile_id,
            agentSlot: 'telegram_chatbot',
            toolName: 'telegram_knowledge_question',
            input: { requestId: row.id, message: row.message },
            output: { status: failure === 'authority_changed' ? 403 : 503, code: failure },
            authorizationResult: failure === 'authority_changed' ? 'denied' : 'allowed',
            confirmationRequired: false,
            confirmationResult: 'not_required',
          });
      }
      await this.settle(
        row,
        row.dispatched ? 'unknown' : 'failed',
        null,
        row.dispatched ? 'delivery_unknown' : failure
      );
    }
  }
}

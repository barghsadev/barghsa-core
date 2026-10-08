import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { rootReleaseVersion } from './root-version.js';
import { telegramConfirmationCode } from './telegram-protocol.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>, provider: Server;
const secret = 'owned-telegram-webhook-' + 'a'.repeat(32);
const token = '8703508822:owned_fixture_not_a_live_bot_token';
const envKeys = [
  'CUSTOMER_TELEGRAM_BOT_TOKEN',
  'CUSTOMER_TELEGRAM_WEBHOOK_SECRET',
  'NODE_OPTIONS',
  'BARGHSA_TEST_TELEGRAM_ENDPOINT',
  'KB_EMBEDDING_BASE_URL',
  'AI_INFERENCE_URL',
  'AI_INFERENCE_SHARED_SECRET',
] as const;
const prior = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const sends: Array<{ chat_id: string; text: string; protect_content: boolean }> = [];
let mode: 'success' | 'unknown' | 'rate' = 'success';
let aiWorker: ChildProcess,
  modelCalls = 0,
  modelMessages: unknown[] = [];
let beforeModelReply: (() => Promise<void>) | undefined;
let sequence = 1,
  chatSequence = 10000;
beforeAll(async () => {
  provider = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/getMe')
      return void res.end(
        JSON.stringify({
          ok: true,
          result: { id: 8703508822, is_bot: true, username: 'barghsa_dev_bot' },
        })
      );
    if (req.url === '/v1/embeddings')
      return void res.end(
        JSON.stringify({ data: [{ index: 0, embedding: Array(1536).fill(0.1) }] })
      );
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === '/v1/chat/completions') {
      modelCalls++;
      modelMessages.push(body.messages);
      if (beforeModelReply) await beforeModelReply();
      return void res.end(
        JSON.stringify({
          choices: [{ message: { content: 'Published Telegram guidance.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        })
      );
    }
    sends.push(body);
    if (mode === 'unknown') return void res.end('not-json');
    if (mode === 'rate') {
      mode = 'success';
      res.statusCode = 429;
      return void res.end(
        JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 1 } })
      );
    }
    res.end(
      JSON.stringify({
        ok: true,
        result: { message_id: sends.length, chat: { id: Number(body.chat_id), type: 'private' } },
      })
    );
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  process.env.CUSTOMER_TELEGRAM_BOT_TOKEN = token;
  process.env.CUSTOMER_TELEGRAM_WEBHOOK_SECRET = secret;
  process.env.BARGHSA_TEST_TELEGRAM_ENDPOINT =
    'http://127.0.0.1:' + (provider.address() as { port: number }).port;
  process.env.KB_EMBEDDING_BASE_URL = process.env.BARGHSA_TEST_TELEGRAM_ENDPOINT + '/v1';
  const reserved = createServer();
  reserved.listen(0, '127.0.0.1');
  await once(reserved, 'listening');
  const aiPort = (reserved.address() as { port: number }).port;
  await new Promise<void>((done) => reserved.close(() => done()));
  process.env.AI_INFERENCE_URL = 'http://127.0.0.1:' + aiPort;
  process.env.AI_INFERENCE_SHARED_SECRET = 'owned-telegram-ai-' + 'b'.repeat(32);
  process.env.NODE_OPTIONS =
    (prior.NODE_OPTIONS ? prior.NODE_OPTIONS + ' ' : '') +
    '--require=' +
    resolve('scripts/telegram-test-fetch.cjs');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, undefined, '', 10, '127.0.0.1');
  const databaseUrl = new URL(process.env.TEST_DATABASE_URL!);
  databaseUrl.pathname =
    '/' + (await http.pool.query('SELECT current_database() AS name')).rows[0].name;
  aiWorker = fork(resolve(__dirname, '../../../worker/dist/ai-inference/main.js'), [], {
    silent: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NODE_OPTIONS: prior.NODE_OPTIONS ?? '',
      DATABASE_URL: databaseUrl.toString(),
      PGDIRECT_URL: databaseUrl.toString(),
      AI_INFERENCE_HOST: '127.0.0.1',
      AI_INFERENCE_PORT: String(aiPort),
      AI_MODEL_ENCRYPTION_KEY: 'a5'.repeat(32),
      AI_MODEL_BASE_URL_ALLOWLIST: '127.0.0.1',
    },
  });
  await vi.waitFor(
    async () =>
      expect(
        await fetch(process.env.AI_INFERENCE_URL + '/health/ready')
          .then((r) => r.status)
          .catch(() => 0)
      ).toBe(200),
    { timeout: 10000 }
  );
}, 40000);
afterAll(async () => {
  if (aiWorker && aiWorker.exitCode === null) {
    aiWorker.kill('SIGTERM');
    await once(aiWorker, 'exit');
  }
  await http?.close();
  provider?.close();
  for (const key of envKeys) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
}, 15000);
async function owner() {
  const user = randomUUID(),
    profile = randomUUID(),
    session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,locale) VALUES($1,$2,'fixture','en')",
    [user, user + '@test.local']
  );
  await http.pool.query('INSERT INTO profiles(id,user_id,is_default) VALUES($1,$2,true)', [
    profile,
    user,
  ]);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,operating_context,expires_at,idle_deadline,step_up_verified_at)
    VALUES($1,$2,$3,'customer',NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, user, csrf]
  );
  return {
    user,
    profile,
    session,
    csrf,
    headers: {
      Cookie: 'barghsa_session=' + session,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
  };
}
async function send(
  f: Awaited<ReturnType<typeof owner>>,
  path = '',
  method = 'GET',
  body?: unknown
) {
  return fetch(http.base + '/api/telegram/link' + path, {
    method,
    headers: f.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function create(f: Awaited<ReturnType<typeof owner>>) {
  const response = await send(f, '', 'POST', {});
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as { id: string; url: string };
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(body.url).toMatch(/^https:\/\/t\.me\/barghsa_dev_bot\?start=[A-Za-z0-9_-]{43}$/);
  return body;
}
async function webhook(text: string, chat = ++chatSequence, id = sequence++) {
  const body = {
    update_id: id,
    message: {
      message_id: id + 1,
      from: { id: chat, is_bot: false },
      chat: { id: chat, type: 'private' },
      text,
    },
  };
  const response = await fetch(http.base + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify(body),
  });
  return { response, body, chat, id };
}
async function claim(f: Awaited<ReturnType<typeof owner>>) {
  const intent = await create(f);
  const token = new URL(intent.url).searchParams.get('start')!;
  const claimed = await webhook('/start ' + token);
  expect(claimed.response.status, await claimed.response.clone().text()).toBe(200);
  await expect
    .poll(() => sends.filter((s) => s.chat_id === String(claimed.chat)).length, { timeout: 10000 })
    .toBe(1);
  const message = sends.find((s) => s.chat_id === String(claimed.chat))!;
  const code = telegramConfirmationCode(secret, intent.id, String(claimed.chat));
  expect(message.text).toContain(code);
  expect(message.text).toContain(rootReleaseVersion());
  expect(message.protect_content).toBe(true);
  return { ...claimed, ...intent, code };
}

async function linkWithKnowledge() {
  const f = await owner(),
    intent = await claim(f);
  expect((await send(f, '/confirm', 'POST', { id: intent.id, code: intent.code })).status).toBe(
    200
  );
  await http.pool.query("UPDATE profiles SET first_name='PROFILE_PRIVATE_NAME' WHERE id=$1", [
    f.profile,
  ]);
  const model = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO ai_models(title,provider_type,base_url,model_name,config,created_by,is_enabled,last_test_status)
     VALUES('Telegram fixture','openai_compatible',$1,'telegram-test','{"temperature":0,"max_tokens":64}',$2,true,'passed') RETURNING id`,
      [process.env.BARGHSA_TEST_TELEGRAM_ENDPOINT + '/v1', f.user]
    )
  ).rows[0]!;
  const agent = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO ai_agents(title,model_id,created_by,system_prompt) VALUES('Telegram knowledge',$1,$2,'Use published references') RETURNING id",
      [model.id, f.user]
    )
  ).rows[0]!;
  for (const audience of ['public', 'customer', 'staff', 'admin']) {
    const kb = (
      await http.pool.query<{ id: string }>(
        `INSERT INTO knowledge_bases(title,audience,created_by,is_enabled,content_state,vector_embedding_model)
       VALUES($1,$2,$3,true,'ready','embed-1536') RETURNING id`,
        [audience + ' guide', audience, f.user]
      )
    ).rows[0]!;
    await http.pool.query('INSERT INTO ai_agent_kbs(agent_id,kb_id) VALUES($1,$2)', [
      agent.id,
      kb.id,
    ]);
    await http.pool.query(
      'INSERT INTO kb_chunks(kb_id,chunk_index,content,embedding) VALUES($1,0,$2,$3::vector)',
      [
        kb.id,
        audience.toUpperCase() + '_KNOWLEDGE api_key=published-fixture-secret',
        JSON.stringify(Array(1536).fill(0.1)),
      ]
    );
  }
  await http.pool.query("UPDATE ai_agent_slots SET agent_id=$1 WHERE slot_key='telegram_chatbot'", [
    agent.id,
  ]);
  return { ...f, ...intent, modelId: model.id, agentId: agent.id };
}

it('audits cancellation of an unconfirmed intent once and retains its immutable history', async () => {
  const f = await owner(),
    intent = await create(f);
  expect((await send(f, '', 'DELETE')).status).toBe(200);
  expect((await send(f, '', 'DELETE')).status).toBe(200);
  expect(
    (await http.pool.query('SELECT status FROM telegram_link_intents WHERE id=$1', [intent.id]))
      .rows[0].status
  ).toBe('cancelled');
  const audits = (
    await http.pool.query(
      "SELECT metadata FROM audit_log WHERE user_id=$1 AND event='telegram_link_revoked'",
      [f.user]
    )
  ).rows;
  expect(audits).toHaveLength(1);
  expect(JSON.parse(audits[0].metadata)).toMatchObject({
    intentIds: [intent.id],
    linkIds: [],
    profileId: f.profile,
  });
});

it('answers from published Telegram knowledge with real isolated inference, source excerpts and current private binding', async () => {
  const f = await linkWithKnowledge();
  modelCalls = 0;
  modelMessages = [];
  const question = await webhook(
    'What services are available? token=customer-fixture-secret',
    f.chat
  );
  expect(question.response.status, await question.response.clone().text()).toBe(200);
  await expect
    .poll(
      async () =>
        (
          await http.pool.query('SELECT status FROM telegram_updates WHERE update_id=$1', [
            question.id,
          ])
        ).rows[0]?.status,
      { timeout: 15000 }
    )
    .toBe('sent');
  expect(modelCalls).toBe(1);
  const prompt = JSON.stringify(modelMessages);
  expect(prompt).toContain('PUBLIC_KNOWLEDGE');
  expect(prompt).toContain('CUSTOMER_KNOWLEDGE');
  for (const privateValue of [
    'STAFF_KNOWLEDGE',
    'ADMIN_KNOWLEDGE',
    'PROFILE_PRIVATE_NAME',
    'customer-fixture-secret',
  ])
    expect(prompt).not.toContain(privateValue);
  const replies = sends.filter((s) => s.chat_id === String(f.chat));
  expect(replies).toHaveLength(2);
  expect(replies[1]!.text).toContain('Published Telegram guidance.');
  expect(replies[1]!.text).toContain('KNOWLEDGE');
  expect(replies[1]!.text).toContain(rootReleaseVersion());
  expect(replies[1]!.text).not.toContain('published-fixture-secret');
  const row = (
    await http.pool.query('SELECT * FROM telegram_updates WHERE update_id=$1', [question.id])
  ).rows[0];
  expect(row.sent_message_id).toBeTruthy();
  expect(row.message).not.toContain('customer-fixture-secret');
  expect(
    (
      await http.pool.query(
        "SELECT authorization_result FROM ai_audit_log WHERE user_id=$1 AND agent_slot='telegram_chatbot'",
        [f.user]
      )
    ).rows
  ).toContainEqual({ authorization_result: 'allowed' });
});

it('withholds a late model answer after linked account authority is disabled', async () => {
  const f = await linkWithKnowledge();
  modelCalls = 0;
  beforeModelReply = async () => {
    await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [f.user]);
  };
  try {
    const question = await webhook('Published guidance please', f.chat);
    expect(question.response.status).toBe(200);
    await expect
      .poll(
        async () =>
          (
            await http.pool.query('SELECT status FROM telegram_updates WHERE update_id=$1', [
              question.id,
            ])
          ).rows[0]?.status,
        { timeout: 15000 }
      )
      .toBe('failed');
    expect(modelCalls).toBe(1);
    expect(sends.filter((s) => s.chat_id === String(f.chat))).toHaveLength(1);
    expect(
      (
        await http.pool.query(
          "SELECT authorization_result FROM ai_audit_log WHERE user_id=$1 AND agent_slot='telegram_chatbot'",
          [f.user]
        )
      ).rows
    ).toContainEqual({ authorization_result: 'denied' });
  } finally {
    beforeModelReply = undefined;
  }
});

it('withholds a late model answer after its Telegram slot is reassigned', async () => {
  const f = await linkWithKnowledge();
  beforeModelReply = async () => {
    await http.pool.query(
      "UPDATE ai_agent_slots SET agent_id=NULL WHERE slot_key='telegram_chatbot'"
    );
  };
  try {
    const question = await webhook('Published guidance please', f.chat);
    expect(question.response.status).toBe(200);
    await expect
      .poll(
        async () =>
          (
            await http.pool.query('SELECT status FROM telegram_updates WHERE update_id=$1', [
              question.id,
            ])
          ).rows[0]?.status,
        { timeout: 15000 }
      )
      .toBe('failed');
    expect(sends.filter((s) => s.chat_id === String(f.chat))).toHaveLength(1);
  } finally {
    beforeModelReply = undefined;
  }
});

it('authenticates the independent webhook proof before any parsing or database adoption', async () => {
  const beforeSends = sends.length;
  const beforeUpdates = (
    await http.pool.query('SELECT count(*)::int AS count FROM telegram_updates')
  ).rows[0].count;
  for (const headers of [{}, { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }]) {
    const response = await fetch(http.base + '/api/telegram/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
    });
    expect(response.status).toBe(401);
  }
  const group = await fetch(http.base + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({
      update_id: sequence++,
      message: {
        message_id: 1,
        from: { id: 1, is_bot: false },
        chat: { id: -1004467450624, type: 'supergroup' },
        text: 'question',
      },
    }),
  });
  expect(group.status).toBe(200);
  expect(await group.json()).toMatchObject({ ignored: true });
  expect(sends).toHaveLength(beforeSends);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM telegram_updates')).rows[0].count
  ).toBe(beforeUpdates);
});

it('requires current session, CSRF, recent step-up and exact owned scope to mint a hashed one-use link', async () => {
  const f = await owner();
  expect((await fetch(http.base + '/api/telegram/link')).status).toBe(401);
  expect(
    (
      await fetch(http.base + '/api/telegram/link', {
        method: 'POST',
        headers: { Cookie: f.headers.Cookie, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status
  ).toBe(403);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    f.session,
  ]);
  expect((await send(f, '', 'POST', {})).status).toBe(403);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW() WHERE session_id=$1', [
    f.session,
  ]);
  expect((await send(f, '', 'POST', { profileId: randomUUID() })).status).toBe(400);
  const intent = await create(f);
  const rawToken = new URL(intent.url).searchParams.get('start')!;
  const row = (
    await http.pool.query('SELECT * FROM telegram_link_intents WHERE id=$1', [intent.id])
  ).rows[0];
  expect(JSON.stringify(row)).not.toContain(rawToken);
  expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
  const status = await send(f);
  expect(status.status).toBe(200);
  expect(await status.text()).not.toContain(row.token_hash);
  expect(
    await send(await owner(), '/confirm', 'POST', { id: intent.id, code: '123456' }).then(
      (r) => r.status
    )
  ).toBe(404);
});

it('confirms only a code received in the exact private chat, audits once and replays without another send', async () => {
  const f = await owner(),
    intent = await claim(f);
  expect((await send(f, '/confirm', 'POST', { id: intent.id, code: intent.code })).status).toBe(
    200
  );
  expect((await send(f, '/confirm', 'POST', { id: intent.id, code: intent.code })).status).toBe(
    200
  );
  expect(
    (await webhook(intent.body.message.text, intent.chat, intent.body.update_id)).response.status
  ).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  expect(sends.filter((s) => s.chat_id === String(intent.chat))).toHaveLength(1);
  const link = (
    await http.pool.query('SELECT * FROM telegram_links WHERE intent_id=$1', [intent.id])
  ).rows[0];
  expect(link).toMatchObject({
    user_id: f.user,
    profile_id: f.profile,
    telegram_user_id: String(intent.chat),
    chat_id: String(intent.chat),
    revoked_at: null,
  });
  expect(
    (
      await http.pool.query(
        'SELECT l.verified_at=i.confirmed_at AS exact FROM telegram_links l JOIN telegram_link_intents i ON i.id=l.intent_id WHERE l.id=$1',
        [link.id]
      )
    ).rows[0].exact
  ).toBe(true);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE user_id=$1 AND event='telegram_link_confirmed'",
        [f.user]
      )
    ).rows[0].count
  ).toBe(1);
  expect(
    JSON.stringify(
      (await http.pool.query('SELECT metadata FROM audit_log WHERE user_id=$1', [f.user])).rows
    )
  ).not.toContain(intent.code);
  await expect(
    http.pool.query('UPDATE telegram_links SET chat_id=$2 WHERE id=$1', [link.id, intent.chat + 1])
  ).rejects.toThrow('Only permanent revocation');
  expect((await send(f, '', 'DELETE')).status).toBe(200);
  expect((await send(f, '', 'DELETE')).status).toBe(200);
  expect(
    (await http.pool.query('SELECT revoked_at FROM telegram_links WHERE id=$1', [link.id])).rows[0]
      .revoked_at
  ).toBeInstanceOf(Date);
  expect(
    await (await webhook('question after revocation', intent.chat)).response.json()
  ).toMatchObject({ ignored: true });
});

it('commits failed confirmation attempts and permanently cancels at five guesses', async () => {
  const f = await owner(),
    intent = await claim(f);
  const wrong = intent.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    expect((await send(f, '/confirm', 'POST', { id: intent.id, code: wrong })).status).toBe(422);
  expect(
    (
      await http.pool.query(
        'SELECT status,confirmation_attempts FROM telegram_link_intents WHERE id=$1',
        [intent.id]
      )
    ).rows[0]
  ).toEqual({ status: 'cancelled', confirmation_attempts: 5 });
  expect((await send(f, '/confirm', 'POST', { id: intent.id, code: intent.code })).status).toBe(
    409
  );
});

it('does not replay a send whose provider outcome is unknown, even on a duplicate webhook', async () => {
  const f = await owner(),
    intent = await create(f);
  mode = 'unknown';
  const update = await webhook('/start ' + new URL(intent.url).searchParams.get('start')!);
  expect(update.response.status).toBe(200);
  await expect
    .poll(
      async () =>
        (
          await http.pool.query('SELECT status FROM telegram_updates WHERE update_id=$1', [
            update.id,
          ])
        ).rows[0]?.status,
      { timeout: 10000 }
    )
    .toBe('unknown');
  mode = 'success';
  expect((await webhook(update.body.message.text, update.chat, update.id)).response.status).toBe(
    200
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  expect(sends.filter((s) => s.chat_id === String(update.chat))).toHaveLength(1);
  const row = (
    await http.pool.query('SELECT * FROM telegram_updates WHERE update_id=$1', [update.id])
  ).rows[0];
  expect(row.sent_message_id).toBeNull();
  expect(row.last_error).toBe('delivery_unknown');
  expect(await (await send(f)).json()).toMatchObject({ latestDelivery: { status: 'unknown' } });
  await expect(
    http.pool.query("UPDATE telegram_updates SET status='ready' WHERE id=$1", [row.id])
  ).rejects.toThrow('terminal delivery');
});

it('retries only an explicit rate-limit rejection, preserving one actual successful receipt', async () => {
  const f = await owner(),
    intent = await create(f);
  mode = 'rate';
  const update = await webhook('/start ' + new URL(intent.url).searchParams.get('start')!);
  expect(update.response.status).toBe(200);
  await expect
    .poll(
      async () =>
        (
          await http.pool.query('SELECT status FROM telegram_updates WHERE update_id=$1', [
            update.id,
          ])
        ).rows[0]?.status,
      { timeout: 12000 }
    )
    .toBe('sent');
  const row = (
    await http.pool.query(
      'SELECT status,attempts,sent_message_id FROM telegram_updates WHERE update_id=$1',
      [update.id]
    )
  ).rows[0];
  expect(row).toMatchObject({ status: 'sent', attempts: 3, sent_message_id: expect.any(String) });
  expect(sends.filter((s) => s.chat_id === String(update.chat))).toHaveLength(2);
});

it.each(['revoked', 'archived', 'disabled', 'context', 'expired'])(
  'withholds linking after current %s authority changes',
  async (change) => {
    const f = await owner(),
      intent = await create(f);
    if (change === 'revoked')
      await http.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [
        f.session,
      ]);
    if (change === 'archived')
      await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
    if (change === 'disabled')
      await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [f.user]);
    if (change === 'context')
      await http.pool.query("UPDATE sessions SET operating_context='staff' WHERE session_id=$1", [
        f.session,
      ]);
    if (change === 'expired')
      await http.pool.query(
        "UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE session_id=$1",
        [f.session]
      );
    const before = sends.length;
    expect(
      (await webhook('/start ' + new URL(intent.url).searchParams.get('start')!)).response.status
    ).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(sends).toHaveLength(before);
    expect(
      (await http.pool.query('SELECT status FROM telegram_link_intents WHERE id=$1', [intent.id]))
        .rows[0].status
    ).toBe('pending');
  }
);

it('enforces immutable intent and verified-link evidence below the HTTP boundary', async () => {
  const f = await owner(),
    intent = await claim(f);
  for (const sql of [
    "UPDATE telegram_link_intents SET token_hash=repeat('f',64) WHERE id=$1",
    'UPDATE telegram_link_intents SET telegram_user_id=777,chat_id=777 WHERE id=$1',
    'DELETE FROM telegram_link_intents WHERE id=$1',
  ])
    await expect(http.pool.query(sql, [intent.id])).rejects.toMatchObject({ code: '23514' });
  const insert = `INSERT INTO telegram_links(user_id,profile_id,intent_id,telegram_user_id,chat_id,verified_at)
    VALUES($1,$2,$3,$4,$4,NOW())`;
  await expect(
    http.pool.query(insert, [f.user, f.profile, intent.id, intent.chat])
  ).rejects.toMatchObject({ code: '23514' });
  expect((await send(f, '/confirm', 'POST', { id: intent.id, code: intent.code })).status).toBe(
    200
  );
  const link = (
    await http.pool.query('SELECT * FROM telegram_links WHERE intent_id=$1', [intent.id])
  ).rows[0];
  for (const sql of [
    'UPDATE telegram_links SET chat_id=777,telegram_user_id=777 WHERE id=$1',
    'DELETE FROM telegram_links WHERE id=$1',
  ])
    await expect(http.pool.query(sql, [link.id])).rejects.toMatchObject({ code: '23514' });
  expect((await send(f, '', 'DELETE')).status).toBe(200);
  await expect(
    http.pool.query('UPDATE telegram_links SET revoked_at=NULL WHERE id=$1', [link.id])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query(
      "UPDATE telegram_link_intents SET status='claimed',confirmed_at=NULL WHERE id=$1",
      [intent.id]
    )
  ).rejects.toMatchObject({ code: '23514' });
});

it('refuses malformed group, null-proof and expired intents in the migrated database', async () => {
  const f = await owner(),
    intent = await create(f);
  await expect(
    http.pool.query(
      `UPDATE telegram_link_intents SET status='claimed',
    telegram_user_id=NULL,chat_id=NULL,claimed_at=NOW() WHERE id=$1`,
      [intent.id]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query(
      `UPDATE telegram_link_intents SET status='claimed',
    telegram_user_id=-1004467450624,chat_id=-1004467450624,claimed_at=NOW() WHERE id=$1`,
      [intent.id]
    )
  ).rejects.toMatchObject({ code: '23514' });
  const expired = (
    await http.pool.query(
      `INSERT INTO telegram_link_intents(user_id,profile_id,session_id,token_hash,created_at,expires_at)
    VALUES($1,$2,$3,repeat('e',64),NOW()-INTERVAL '20 minutes',NOW()-INTERVAL '10 minutes') RETURNING id`,
      [f.user, f.profile, f.session]
    )
  ).rows[0];
  await expect(
    http.pool.query(
      `UPDATE telegram_link_intents SET status='claimed',telegram_user_id=888,
    chat_id=888,claimed_at=NOW() WHERE id=$1`,
      [expired.id]
    )
  ).rejects.toMatchObject({ code: '23514' });
});

it('cannot bind one private Telegram identity to two accounts under concurrent confirmation', async () => {
  const first = await owner(),
    second = await owner(),
    a = await claim(first),
    b = await create(second);
  expect(
    (await webhook('/start ' + new URL(b.url).searchParams.get('start')!, a.chat)).response.status
  ).toBe(200);
  const code = telegramConfirmationCode(secret, b.id, String(a.chat));
  const results = await Promise.all([
    send(first, '/confirm', 'POST', { id: a.id, code: a.code }),
    send(second, '/confirm', 'POST', { id: b.id, code }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS count FROM telegram_links WHERE telegram_user_id=$1 AND revoked_at IS NULL',
        [a.chat]
      )
    ).rows[0].count
  ).toBe(1);
});

it('rejects forged update bindings and terminal delivery/history edits', async () => {
  const f = await owner(),
    intent = await claim(f);
  const row = (
    await http.pool.query('SELECT * FROM telegram_updates WHERE intent_id=$1', [intent.id])
  ).rows[0];
  for (const sql of [
    "UPDATE telegram_updates SET request_hash=repeat('d',64) WHERE id=$1",
    "UPDATE telegram_updates SET status='ready',sent_message_id=NULL WHERE id=$1",
    'DELETE FROM telegram_updates WHERE id=$1',
  ])
    await expect(http.pool.query(sql, [row.id])).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query(
      `INSERT INTO telegram_updates(update_id,message_id,telegram_user_id,chat_id,kind,intent_id,request_hash)
    VALUES($1,1,999,999,'link_confirmation',$2,repeat('c',64))`,
      [sequence++, intent.id]
    )
  ).rejects.toMatchObject({ code: '23514' });
});

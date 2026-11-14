import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { decryptAuthDelivery } from '@barghsa/shared/auth-delivery';
import { startHttpFixture } from '../src/test/http-fixture';
import { startTestPostgres } from '../../../packages/db/src/test/globalSetup';

const cleanups: Array<() => Promise<unknown>> = [];
async function cleanup() {
  const errors: unknown[] = [];
  while (cleanups.length) {
    try {
      await cleanups.pop()!();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Fixture cleanup failed');
}

async function main() {
  const database = await startTestPostgres();
  cleanups.push(database.close);
  const objects = new Map<string, Buffer>();
  const probeMetadata = new Map<string, { nonce: string; etag: string }>();
  const storage = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'PUT, GET, HEAD, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {
      response.end();
      return;
    }
    const url = new URL(request.url!, 'http://localhost');
    const key = decodeURIComponent(url.pathname).replace('/test-evidence/', '');
    if (request.method === 'GET' && url.searchParams.has('versioning')) {
      response.setHeader('Content-Type', 'application/xml');
      response.end('<VersioningConfiguration/>');
      return;
    }
    if (request.method === 'PUT') {
      const nonce = request.headers['x-amz-meta-barghsa-probe'];
      if (key.startsWith('_storage_probes/')) {
        if (request.headers['if-none-match'] !== '*' || nonce !== key.split('/')[1]) {
          response.writeHead(400).end();
          return;
        }
        if (objects.has(key)) {
          response.writeHead(412).end();
          return;
        }
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      objects.set(key, bytes);
      if (typeof nonce === 'string' && key.startsWith('_storage_probes/')) {
        const etag = '"' + createHash('sha256').update(bytes).digest('hex') + '"';
        probeMetadata.set(key, { nonce, etag });
        response.setHeader('ETag', etag);
      }
      response.end();
      return;
    }
    if (url.searchParams.has('list-type') || url.pathname.replace(/\/$/, '') === '/test-evidence') {
      response.setHeader('Content-Type', 'application/xml');
      response.end(
        '<ListBucketResult><Name>test-evidence</Name><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>'
      );
      return;
    }
    const bytes = objects.get(key);
    const probe = probeMetadata.get(key);
    if (request.method === 'DELETE' && probe) {
      objects.delete(key);
      probeMetadata.delete(key);
      response.writeHead(204).end();
      return;
    }
    if (!bytes) {
      response.statusCode = 404;
      response.end();
      return;
    }
    if (probe) {
      response.setHeader('ETag', probe.etag);
      response.setHeader('x-amz-meta-barghsa-probe', probe.nonce);
    }
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Content-Length', bytes.length);
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise<void>((done) => storage.listen(0, '127.0.0.1', done));
  cleanups.push(() => new Promise<void>((done) => storage.close(() => done())));
  const previousProviderKey = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = randomUUID();
  const http = await startHttpFixture(
    database.connectionString,
    `http://127.0.0.1:${(storage.address() as { port: number }).port}`,
    '',
    10,
    '',
    true
  );
  if (previousProviderKey === undefined) delete process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  else process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = previousProviderKey;
  cleanups.push(() => http.close());
  const session = randomUUID(),
    csrf = randomUUID(),
    customerSession = randomUUID(),
    customerCsrf = randomUUID();
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_admin,is_staff) VALUES
    ('team-ui-admin','admin-ui@example.test','test-only',true,true),
    ('team-ui-member','Member UI','test-only',false,true)`);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at,otp_step_up_verified_at)
    VALUES ($1,'team-ui-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW(),NOW())`,
    [session, csrf, randomUUID()]
  );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context)
     VALUES ($1,'team-ui-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour','customer')`,
    [customerSession, customerCsrf, randomUUID()]
  );
  for (const language of ['en', 'fa']) {
    await http.pool.query(
      `INSERT INTO users(user_id,username,password_hash,is_staff,must_change_password,activation_token,activation_token_expires_at)
      VALUES ($1,$2,'test-only',true,true,'test-only-expired-token',NOW()-INTERVAL '1 day')`,
      [randomUUID(), `pending-${language}@example.test`]
    );
  }
  await http.pool.query(
    `INSERT INTO storage_records(storage_key,file_name,content_type,file_size,status,metadata) VALUES ('uploads/document/kb-ui.pdf','Knowledge guide.pdf','application/pdf',1024,'active','{"uploadedBy":"team-ui-admin"}')`
  );
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('gift-ui-recipient','gift-recipient@example.test','test-only'); INSERT INTO profiles(user_id,profile_type,status,first_name) VALUES ('gift-ui-recipient','INDIVIDUAL','VERIFIED','Gift recipient')"
  );
  const jobs: Record<string, { first: string; second: string; dead: string }> = {};
  for (const [locale, types] of [
    ['en', ['storage_cleanup', 'auth_delivery', 'invoice_overdue_scan']],
    ['fa', ['service_breach_scan', 'service_escalation_scan', 'invoice_reminder_sender']],
  ] as const) {
    const ids = { first: randomUUID(), second: randomUUID(), dead: randomUUID() };
    jobs[locale] = ids;
    for (const [index, key] of ['first', 'second', 'dead'].entries()) {
      await http.pool.query(
        `INSERT INTO background_jobs(id,job_type,status,attempts,max_attempts,error)
        VALUES($1,$2,$3,5,5,'Local worker transport failed')`,
        [ids[key as keyof typeof ids], types[index], key === 'dead' ? 'dead_letter' : 'failed']
      );
    }
  }
  const profile = (
    await http.pool.query("INSERT INTO profiles(user_id) VALUES ('team-ui-admin') RETURNING id")
  ).rows[0].id;
  await http.pool.query(
    "UPDATE profiles SET is_default=true,status='VERIFIED',first_name='Dashboard',last_name='Example' WHERE id=$1",
    [profile]
  );
  await http.pool.query(
    'INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES ($1,$2,2)',
    [profile, '9007199254740995']
  );
  await http.pool.query(
    "INSERT INTO invoices(profile_id,state,total_amount,due_at) VALUES ($1,'Overdue',$2,NOW()-INTERVAL '1 day')",
    [profile, '9007199254740994']
  );
  for (const locale of ['en', 'fa'])
    for (const action of ['retry', 'resolve', 'dismiss']) {
      const outbox = randomUUID(),
        job = randomUUID(),
        dead = randomUUID(),
        event = `triage.${locale}.${action}`;
      await http.pool.query(
        `INSERT INTO notification_outbox(id,profile_id,event_key,payload,channels,idempotency_key,status) VALUES ($1::uuid,$2,$3,'{"email":"private@example.test","token":"private-secret"}',ARRAY['email'],$1::text,'failed')`,
        [outbox, profile, event]
      );
      await http.pool.query(
        `INSERT INTO notification_job(id,outbox_id,channel,status,attempts,delivery_payload) VALUES ($1,$2,'email','dead_letter',5,'{"preserved":"snapshot"}')`,
        [job, outbox]
      );
      await http.pool.query(
        `INSERT INTO notification_dead_letter(id,outbox_id,job_id,channel,event_key,profile_id,attempts,idempotency_key,cause) VALUES ($1::uuid,$2,$3,'email',$4,$5,5,$1::text,'Local provider failed')`,
        [dead, outbox, job, event, profile]
      );
    }
  const readyAgentEditorModels: Record<string, { id: string; title: string }> = {};
  for (const locale of ['en', 'fa']) {
    const { rows } = await http.pool.query<{ id: string; title: string }>(
      `INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by,is_enabled,last_test_status)
       VALUES ($1,'openai_compatible','https://example.test','test','team-ui-admin',true,'passed')
       RETURNING id,title`,
      [`Editor model ${locale}`]
    );
    readyAgentEditorModels[locale] = rows[0]!;
    await http.pool.query(
      "INSERT INTO reconciliation_exceptions(exception_type,severity,description,details) VALUES ('wallet_mismatch','high',$1,$2::jsonb)",
      [
        `Reconciliation live ${locale}`,
        JSON.stringify({ ledger: '9007199254740993', balance: '9007199254740992' }),
      ]
    );
  }
  await http.pool.query(
    `INSERT INTO products(system_key,title,price,status) VALUES ('green','{"en":"Green UI","fa":"Green UI"}',1000,'active') ON CONFLICT(system_key) DO UPDATE SET title=EXCLUDED.title,status='active',price=1000`
  );
  const staffReviewActors: Record<string, { username: string; session: string; csrf: string }> = {};
  for (const locale of ['en', 'fa']) {
    const userId = `team-ui-role-review-${locale}`;
    const username = `admin-role-review-${locale}@example.test`;
    const session = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO users(user_id,username,password_hash,is_admin,is_staff) VALUES ($1,$2,'test-only',true,true)`,
      [userId, username]
    );
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())`,
      [session, userId, csrf, randomUUID()]
    );
    staffReviewActors[locale] = { username, session, csrf };
  }
  // Read synthetic OTP delivery only in the fixture process and only for its review actors.
  process.env.AUTH_DELIVERY_ENCRYPTION_KEY = 'http-fixture-delivery-key-only';
  async function deliverFixtureCode(challengeId: string, username: string) {
    const { rows } = await http.pool.query<{ id: string; encrypted_payload: string }>(
      `SELECT delivery.id,delivery.encrypted_payload
       FROM auth_delivery_outbox delivery
       JOIN otp_challenges challenge ON challenge.challenge_id=delivery.challenge_id
       WHERE challenge.challenge_id=$1 AND challenge.destination=$2 AND challenge.purpose='step_up'`,
      [challengeId, username]
    );
    const row = rows[0];
    const payload = row && decryptAuthDelivery(row.id, row.encrypted_payload);
    const code = payload && typeof payload === 'object' && 'code' in payload ? payload.code : null;
    process.send?.({ challengeId, code });
  }
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await cleanup();
    // The browser runner captures this output and attaches it only on failure.
    process.stderr.write(http.logs());
    process.exit(0);
  };
  const requestClose = () =>
    void close().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  process.on('message', (message: unknown) => {
    if (message === 'stop') requestClose();
    else if (
      message &&
      typeof message === 'object' &&
      'challengeId' in message &&
      'username' in message &&
      typeof message.challengeId === 'string' &&
      typeof message.username === 'string' &&
      Object.values(staffReviewActors).some((actor) => actor.username === message.username)
    ) {
      const { challengeId, username } = message;
      void deliverFixtureCode(challengeId, username).catch(() =>
        process.send?.({ challengeId, code: null })
      );
    }
  });
  process.once('disconnect', requestClose);
  process.once('SIGTERM', requestClose);
  process.send?.({
    base: http.base,
    session,
    csrf,
    customerSession,
    customerCsrf,
    jobs,
    readyAgentEditorModels,
    staffReviewActors,
  });
}
main().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error(cleanupError);
  }
  process.exit(1);
});

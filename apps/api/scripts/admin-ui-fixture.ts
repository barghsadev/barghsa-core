import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../src/test/http-fixture';
import { setup, teardown } from '../../../packages/db/src/test/globalSetup';

async function main() {
  await setup();
  const storage = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/xml');
    response.end(
      '<ListBucketResult><Name>test-evidence</Name><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>'
    );
  });
  await new Promise<void>((done) => storage.listen(0, '127.0.0.1', done));
  const http = await startHttpFixture(
    process.env.TEST_DATABASE_URL!,
    `http://127.0.0.1:${(storage.address() as { port: number }).port}`,
    '',
    10,
    '',
    true
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_admin,is_staff) VALUES
    ('team-ui-admin','admin-ui@example.test','test-only',true,true),
    ('team-ui-member','Member UI','test-only',false,true)`);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'team-ui-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())`,
    [session, csrf, randomUUID()]
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
  for (const locale of ['en', 'fa']) {
    await http.pool.query(
      "INSERT INTO reconciliation_exceptions(exception_type,severity,description,details) VALUES ('wallet_mismatch','high',$1,$2::jsonb)",
      [
        `Reconciliation live ${locale}`,
        JSON.stringify({ ledger: '9007199254740993', balance: '9007199254740992' }),
      ]
    );
  }
  await http.pool.query(
    `INSERT INTO products(system_key,title,price,status) VALUES ('green_electricity','{"en":"Green UI","fa":"Green UI"}',1000,'active') ON CONFLICT(system_key) DO UPDATE SET status='active',price=1000`
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await http.close();
    // The browser runner captures this output and attaches it only on failure.
    process.stderr.write(http.logs());
    await new Promise<void>((done) => storage.close(() => done()));
    await teardown();
    process.exit(0);
  };
  process.once('message', () => void close());
  process.once('disconnect', () => void close());
  process.once('SIGTERM', () => void close());
  process.send?.({ base: http.base, session, csrf, jobs });
}
main().catch(async (error) => {
  console.error(error);
  await teardown();
  process.exit(1);
});

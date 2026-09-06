import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../src/test/http-fixture';
import { setup, teardown } from '../../../packages/db/src/test/globalSetup';

async function main() {
  await setup();
  const http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
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
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await http.close();
    await teardown();
    process.exit(0);
  };
  process.once('message', () => void close());
  process.once('disconnect', () => void close());
  process.once('SIGTERM', () => void close());
  process.send?.({ base: http.base, session, csrf });
}
main().catch(async (error) => {
  console.error(error);
  await teardown();
  process.exit(1);
});

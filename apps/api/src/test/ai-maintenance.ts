import type { Pool } from 'pg';

export async function withAiMaintenance(pool: Pool, verify: () => Promise<void>) {
  await pool.query(
    `INSERT INTO app_config(key,value,version,updated_at)
     VALUES('maintenance.ai_chat',$1::jsonb,1,now())`,
    [
      JSON.stringify({
        active: true,
        reason: { fa: 'در حال بررسی', en: 'Assistant service check' },
        estimatedUntil: '2099-01-01T00:00:00.000Z',
        owner: 'Operations',
      }),
    ]
  );
  try {
    await verify();
  } finally {
    await pool.query("DELETE FROM app_config WHERE key='maintenance.ai_chat'");
  }
}

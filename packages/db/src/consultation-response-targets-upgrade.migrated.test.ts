import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';

it('expands consultation breaches while preserving existing episodes, routing cursors and notifications', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'consultation-targets-upgrade-'));
  const production = resolve('drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 244),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  const name = 'test_consultation_targets_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined,
    databaseCreated = false;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    databaseCreated = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES('assigned','assigned','test')"
    );
    const team = (await pool.query("INSERT INTO staff_teams(name) VALUES('Existing') RETURNING id"))
      .rows[0].id;
    for (const type of ['ticket', 'verification_case', 'consultation'])
      await pool.query(
        "INSERT INTO staff_assignment_cursors(team_id,work_type,last_user_id,updated_at) VALUES($1,$2,'assigned','2025-01-02T03:04:05Z')",
        [team, type]
      );
    await pool.query(
      `INSERT INTO service_breach_alerts(service_type,item_id,target_hours,alerted_at,escalation_level,escalated_at)
       VALUES ('ticket','existing-ticket',24,'2025-01-02T03:04:05Z',1,NULL),
              ('verification_case','existing-case',48,'2025-01-01T03:04:05Z',3,'2025-01-03T03:04:05Z')`
    );
    await pool.query(
      `INSERT INTO in_app_notifications(recipient_user_id,operating_context,type,delivery_key,title_i18n_key,body_i18n_key,params,link_route,is_read,read_at,created_at)
       VALUES ('assigned','staff','service_breach','historical-breach','notifications.service_breach.title','notifications.service_breach.body',
               '{"serviceType":"ticket","itemId":"existing-ticket","targetHours":24}','/admin/tickets',TRUE,'2025-01-03T03:04:05Z','2025-01-02T03:04:05Z')`
    );
    await expect(
      pool.query(
        "INSERT INTO service_breach_alerts(service_type,item_id,target_hours) VALUES('consultation','before-upgrade',24)"
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'chk_sba_service_type' });
    const alerts = (await pool.query('SELECT * FROM service_breach_alerts ORDER BY item_id')).rows;
    const cursors = (await pool.query('SELECT * FROM staff_assignment_cursors ORDER BY work_type'))
      .rows;
    const notices = (await pool.query('SELECT * FROM in_app_notifications ORDER BY id')).rows;
    const history = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id'))
      .rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: [
        '0244_consultation_response_targets',
        '0245_business_actor_context',
        '0246_catalogue_foundation_guards',
        '0247_gift_code_integrity',
      ],
    });
    expect((await pool.query('SELECT * FROM service_breach_alerts ORDER BY item_id')).rows).toEqual(
      alerts.map((alert) => ({ ...alert, source_activity_at: null }))
    );
    expect(
      (await pool.query('SELECT * FROM staff_assignment_cursors ORDER BY work_type')).rows
    ).toEqual(cursors);
    expect((await pool.query('SELECT * FROM in_app_notifications ORDER BY id')).rows).toEqual(
      notices
    );
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(
        0,
        history.length
      )
    ).toEqual(history);
    for (const tier of [1, 2, 3])
      await pool.query(
        "INSERT INTO service_breach_alerts(service_type,item_id,target_hours,escalation_level,source_activity_at) VALUES('consultation',$1,24,$2,$3)",
        ['consultation-tier-' + tier, tier, '2025-01-02T03:04:05.123456Z']
      );
    expect(
      (
        await pool.query(
          "SELECT to_char(source_activity_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS activity FROM service_breach_alerts WHERE service_type='consultation' ORDER BY item_id"
        )
      ).rows
    ).toEqual(Array.from({ length: 3 }, () => ({ activity: '2025-01-02 03:04:05.123456' })));
    await expect(
      pool.query(
        "INSERT INTO service_breach_alerts(service_type,item_id,target_hours) VALUES('consultation','missing-activity',24)"
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'chk_sba_consultation_activity' });
    await expect(
      pool.query(
        "INSERT INTO service_breach_alerts(service_type,item_id,target_hours,escalation_level,source_activity_at) VALUES('consultation','consultation-tier-1',48,2,'2025-01-02T03:04:05.123456Z')"
      )
    ).rejects.toMatchObject({ code: '23505', constraint: 'uq_sba_item' });
    await pool.query(
      "INSERT INTO service_breach_alerts(service_type,item_id,target_hours,source_activity_at) VALUES('consultation','existing-ticket',24,'2025-01-02T03:04:05.123456Z')"
    );
    await expect(
      pool.query(
        "INSERT INTO service_breach_alerts(service_type,item_id,target_hours) VALUES('unsupported','invalid-domain',24)"
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'chk_sba_service_type' });
    for (const tier of [0, 4])
      await expect(
        pool.query(
          "INSERT INTO service_breach_alerts(service_type,item_id,target_hours,escalation_level,source_activity_at) VALUES('consultation',$1,24,$2,$3)",
          ['invalid-tier-' + tier, tier, '2025-01-02T03:04:05.123456Z']
        )
      ).rejects.toMatchObject({ code: '23514', constraint: 'chk_sba_escalation_level' });
    await expect(
      pool.query(
        "INSERT INTO service_breach_alerts(service_type,item_id,target_hours,source_activity_at) VALUES('consultation','invalid-target',0,'2025-01-02T03:04:05.123456Z')"
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'chk_sba_target_hours' });
    const upgradedAlerts = (
      await pool.query('SELECT * FROM service_breach_alerts ORDER BY item_id')
    ).rows;
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    expect((await pool.query('SELECT * FROM service_breach_alerts ORDER BY item_id')).rows).toEqual(
      upgradedAlerts
    );
    expect((await pool.query('SELECT * FROM in_app_notifications ORDER BY id')).rows).toEqual(
      notices
    );
  } finally {
    await pool?.end();
    try {
      if (databaseCreated) await management.query(`DROP DATABASE "${name}"`);
    } finally {
      await management.end();
      rmSync(previous, { recursive: true, force: true });
    }
  }
}, 120000);

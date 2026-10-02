import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';
it('upgrades legacy plain replies, reruns safely and enforces formats, file limits and durable submission identities', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'ticket-reply-upgrade-')),
    production = resolve('drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 233),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    name = 'test_reply_upgrade_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined,
    created = false;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES('legacy-reply','legacy-reply','test')"
    );
    const ticket = randomUUID(),
      comment = randomUUID();
    await pool.query(
      "INSERT INTO tickets(id,user_id,subject,body) VALUES($1,'legacy-reply','Legacy','Question')",
      [ticket]
    );
    await pool.query(
      "INSERT INTO ticket_comments(id,ticket_id,author_id,body) VALUES($1,$2,'legacy-reply','**Plain historical text**')",
      [comment, ticket]
    );
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: [
        '0233_ticket_reply_evidence',
        '0234_conversation_identities',
        '0235_conversation_identity_timestamps',
      ],
    });
    expect(
      (await pool.query('SELECT * FROM ticket_comments WHERE id=$1', [comment])).rows[0]
    ).toMatchObject({
      body: '**Plain historical text**',
      body_format: 'plain',
      author_context: 'unknown',
      attachments: [],
      submission_id: null,
      submission_hash: null,
    });
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    for (const sql of [
      "body_format='html'",
      "author_context='admin'",
      "attachments='{}'::jsonb",
      "attachments='[1,2,3,4,5,6]'::jsonb",
      `submission_id='${randomUUID()}'`,
    ]) {
      await expect(
        pool.query(`UPDATE ticket_comments SET ${sql} WHERE id=$1`, [comment])
      ).rejects.toMatchObject({ code: '23514' });
    }
    const submission = randomUUID(),
      digest = 'a'.repeat(64);
    await pool.query('UPDATE ticket_comments SET submission_id=$1,submission_hash=$2 WHERE id=$3', [
      submission,
      digest,
      comment,
    ]);
    await expect(
      pool.query(
        "INSERT INTO ticket_comments(ticket_id,author_id,body,submission_id,submission_hash) VALUES($1,'legacy-reply','Duplicate',$2,$3)",
        [ticket, submission, digest]
      )
    ).rejects.toMatchObject({ code: '23505', constraint: 'ticket_comments_submission_unique' });
  } finally {
    await pool?.end();
    try {
      if (created) await management.query(`DROP DATABASE "${name}"`);
    } finally {
      await management.end();
      rmSync(previous, { recursive: true, force: true });
    }
  }
}, 120000);

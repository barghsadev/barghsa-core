import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMigratedTestDb } from './test/migrated-db';
import { aiAgentKbGroups, aiAgentPolicyGroups } from './schema/ai-agent-groups';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
}, 30000);
afterAll(async () => {
  await fixture?.close();
});
it.each(['kb', 'policy'] as const)(
  'enforces unique %s group links and cascades only links',
  async (kind) => {
    const user = randomUUID();
    await fixture.pool.query(
      'INSERT INTO users(user_id,username,password_hash) VALUES ($1,$1,$1)',
      [user]
    );
    const model = (
      await fixture.pool.query(
        "INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by) VALUES ('Model','openai_compatible','https://example.test','test',$1) RETURNING id",
        [user]
      )
    ).rows[0].id;
    const agent = (
      await fixture.pool.query(
        "INSERT INTO ai_agents(title,model_id,created_by) VALUES ('Agent',$1,$2) RETURNING id",
        [model, user]
      )
    ).rows[0].id;
    const groupTable = kind === 'kb' ? 'kb_groups' : 'ai_policy_groups',
      linkTable = kind === 'kb' ? 'ai_agent_kb_groups' : 'ai_agent_policy_groups',
      schema = kind === 'kb' ? aiAgentKbGroups : aiAgentPolicyGroups;
    const group = (
      await fixture.pool.query(
        `INSERT INTO ${groupTable}(title,created_by) VALUES ('Group',$1) RETURNING id`,
        [user]
      )
    ).rows[0].id;
    await expect(
      fixture.db.insert(schema).values({ agentId: agent, groupId: randomUUID() })
    ).rejects.toThrow();
    await fixture.db.insert(schema).values({ agentId: agent, groupId: group });
    await expect(
      fixture.db.insert(schema).values({ agentId: agent, groupId: group })
    ).rejects.toThrow();
    expect(
      (await fixture.pool.query(`SELECT created_at FROM ${linkTable} WHERE agent_id=$1`, [agent]))
        .rows[0].created_at
    ).toBeInstanceOf(Date);
    await fixture.pool.query(`DELETE FROM ${groupTable} WHERE id=$1`, [group]);
    expect(
      (await fixture.pool.query(`SELECT * FROM ${linkTable} WHERE agent_id=$1`, [agent])).rows
    ).toHaveLength(0);
    expect(
      (await fixture.pool.query('SELECT id FROM ai_agents WHERE id=$1', [agent])).rows
    ).toHaveLength(1);
    const other = (
      await fixture.pool.query(
        `INSERT INTO ${groupTable}(title,created_by) VALUES ('Other group',$1) RETURNING id`,
        [user]
      )
    ).rows[0].id;
    await fixture.db.insert(schema).values({ agentId: agent, groupId: other });
    await fixture.pool.query('DELETE FROM ai_agents WHERE id=$1', [agent]);
    expect(
      (await fixture.pool.query(`SELECT * FROM ${linkTable} WHERE agent_id=$1`, [agent])).rows
    ).toHaveLength(0);
    expect(
      (await fixture.pool.query(`SELECT id FROM ${groupTable} WHERE id=$1`, [other])).rows
    ).toHaveLength(1);
  }
);

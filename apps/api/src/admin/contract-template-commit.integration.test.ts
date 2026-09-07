import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { StorageProvider } from '@barghsa/shared/storage';
import { createRequire } from 'node:module';
const state = vi.hoisted(() => ({
  pool: undefined as Pool | undefined,
  url: '',
  loseCommit: false,
}));
vi.mock('@barghsa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@barghsa/db')>();
  return {
    ...actual,
    createDirectDbPool: () => new Pool({ connectionString: state.url, max: 1 }),
    getDbPool: () => ({
      connect: async () => {
        const client = await state.pool!.connect();
        return {
          query: async (sql: string, values?: unknown[]) => {
            const result = await client.query(sql, values);
            if (sql === 'COMMIT' && state.loseCommit) {
              state.loseCommit = false;
              throw new Error('Fixture lost commit acknowledgement');
            }
            return result;
          },
          release: () => client.release(),
        };
      },
    }),
  };
});
import { runMigrations } from '../../../../packages/db/src/migrate';
import { ContractTemplateService } from './contract-template.service.js';
import { CorrelationIdProvider } from '../common/correlation-id.middleware.js';
const requireWorker = createRequire(require.resolve('@barghsa/worker/package.json'));
const { cleanupStorageObjects } = requireWorker('./dist/storage/cleanup.js') as {
  cleanupStorageObjects(
    pool: Pool,
    storage: StorageProvider
  ): Promise<{ deleted: number; failed: number }>;
};
let management: Pool;
const database = 'test_template_commit_' + randomUUID().replaceAll('-', '');
const objects = new Set<string>();
const storage: StorageProvider = {
  putObject: async (key) => {
    objects.add(key);
  },
  deleteObject: async (key) => {
    objects.delete(key);
  },
  getObject: async () => {
    throw new Error('Unused read');
  },
  presignedPutUrl: async () => {
    throw new Error('Unused signing');
  },
  presignedGetUrl: async () => {
    throw new Error('Unused signing');
  },
  listObjects: async () => {
    throw new Error('Unused listing');
  },
};
let templateId: string;
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + database;
  state.url = url.toString();
  expect(await runMigrations({ connection: { pgdirectUrl: state.url } })).toMatchObject({
    ok: true,
  });
  state.pool = new Pool({ connectionString: state.url });
  await state.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff,is_admin) VALUES ('template-commit','template-commit@example.test','fixture',true,true)"
  );
  templateId = (
    await state.pool.query(
      "INSERT INTO contract_templates(name,created_by) VALUES ('Contract','template-commit') RETURNING id"
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await state.pool?.end();
  if (management) {
    await management.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await management.end();
  }
});
beforeEach(async () => {
  state.loseCommit = false;
  objects.clear();
  await state.pool!.query('DELETE FROM contract_template_versions; DELETE FROM storage_records');
});
function upload() {
  return new ContractTemplateService(new CorrelationIdProvider(), storage).uploadVersion(
    templateId,
    {
      fileName: 'contract.txt',
      content: '{{customerName}}',
      actorUserId: 'template-commit',
      ip: '127.0.0.1',
    }
  );
}
it('retains the committed file and version when the commit acknowledgement is lost', async () => {
  state.loseCommit = true;
  await expect(upload()).rejects.toThrow('Fixture lost commit acknowledgement');
  expect(
    (await state.pool!.query('SELECT storage_key FROM contract_template_versions')).rows
  ).toHaveLength(1);
  expect((await state.pool!.query('SELECT status,signed_by FROM storage_records')).rows).toEqual([
    { status: 'immutable', signed_by: 'template-commit' },
  ]);
  await state.pool!.query("UPDATE storage_records SET updated_at=NOW()-INTERVAL '2 minutes'");
  expect(await cleanupStorageObjects(state.pool!, storage)).toEqual({ deleted: 0, failed: 0 });
  expect(objects.size).toBe(1);
});
it('retries durable cleanup after a failed delete without retaining a version', async () => {
  await state.pool!.query(
    "CREATE FUNCTION reject_template_commit_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER reject_template_commit_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_template_commit_audit()"
  );
  try {
    await expect(upload()).rejects.toThrow('fixture audit failure');
  } finally {
    await state.pool!.query('DROP TRIGGER reject_template_commit_audit ON audit_log');
  }
  expect((await state.pool!.query('SELECT id FROM contract_template_versions')).rows).toEqual([]);
  expect(objects.size).toBe(1);
  await state.pool!.query("UPDATE storage_records SET updated_at=NOW()-INTERVAL '2 minutes'");
  expect(
    await cleanupStorageObjects(state.pool!, {
      ...storage,
      deleteObject: async () => {
        throw new Error('Fixture transport down');
      },
    })
  ).toEqual({ deleted: 0, failed: 1 });
  expect(objects.size).toBe(1);
  await state.pool!.query("UPDATE storage_records SET updated_at=NOW()-INTERVAL '2 minutes'");
  expect(await cleanupStorageObjects(state.pool!, storage)).toEqual({ deleted: 1, failed: 0 });
  expect(objects.size).toBe(0);
});
it('skips an eligible cleanup request while the upload transaction holds its reservation', async () => {
  await state.pool!.query(
    "CREATE FUNCTION age_template_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=NOW()-INTERVAL '2 minutes'; RETURN NEW; END $$; CREATE TRIGGER age_template_reservation BEFORE INSERT ON storage_records FOR EACH ROW EXECUTE FUNCTION age_template_reservation()"
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const put = vi.spyOn(storage, 'putObject').mockImplementation(async (key) => {
    objects.add(key);
    await gate;
  });
  const pending = upload();
  try {
    await expect.poll(() => objects.size).toBe(1);
    expect(
      (
        await state.pool!.query(
          "SELECT storage_key FROM storage_records WHERE status='removed' AND updated_at<NOW()-INTERVAL '1 minute'"
        )
      ).rows
    ).toHaveLength(1);
    expect(await cleanupStorageObjects(state.pool!, storage)).toEqual({ deleted: 0, failed: 0 });
    expect(objects.size).toBe(1);
    release();
    await expect(pending).resolves.toMatchObject({ versionNumber: 1 });
    expect(await cleanupStorageObjects(state.pool!, storage)).toEqual({ deleted: 0, failed: 0 });
  } finally {
    release();
    await pending.catch(() => {});
    put.mockRestore();
    await state.pool!.query('DROP TRIGGER age_template_reservation ON storage_records');
  }
});
it('retains cleanup intent when storage accepted bytes but the write response failed', async () => {
  const put = vi.spyOn(storage, 'putObject').mockImplementation(async (key) => {
    objects.add(key);
    throw new Error('Fixture lost PUT response');
  });
  try {
    await expect(upload()).rejects.toThrow('Fixture lost PUT response');
  } finally {
    put.mockRestore();
  }
  expect(objects.size).toBe(1);
  expect((await state.pool!.query('SELECT id FROM contract_template_versions')).rows).toEqual([]);
  await state.pool!.query("UPDATE storage_records SET updated_at=NOW()-INTERVAL '2 minutes'");
  expect(await cleanupStorageObjects(state.pool!, storage)).toEqual({ deleted: 1, failed: 0 });
  expect(objects.size).toBe(0);
});

import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { expect } from 'vitest';

/** Replaces fixture audit deletion with an equally scoped window over new rows. */
export class AuditWindow {
  private readonly prior = new Map<string, QueryResultRow>();
  constructor(private readonly pool: () => Pool) {}

  async excludeExisting(where = '', values: unknown[] = []) {
    await this.verifyHistory();
    const rows = await this.pool().query(
      `SELECT * FROM audit_log${where ? ` WHERE ${where}` : ''}`,
      values
    );
    for (const row of rows.rows) this.prior.set(row.id, row);
  }

  private async verifyHistory() {
    if (!this.prior.size) return;
    const ids = [...this.prior.keys()].sort();
    const rows = await this.pool().query(
      'SELECT * FROM audit_log WHERE id=ANY($1::text[]) ORDER BY id',
      [ids]
    );
    expect(rows.rows).toEqual(ids.map((id) => this.prior.get(id)));
  }

  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  query<Row extends QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
  async query<Row extends QueryResultRow>(sql: string, values: unknown[] = []) {
    if (!/^\s*SELECT\b/i.test(sql) || !/\baudit_log\b/.test(sql))
      throw new Error('AuditWindow accepts audit SELECT statements only');
    await this.verifyHistory();
    return this.pool().query<Row>(
      `WITH audit_log AS (SELECT * FROM public.audit_log WHERE id<>ALL($${values.length + 1}::text[])) ${sql}`,
      [...values, [...this.prior.keys()]]
    );
  }
}

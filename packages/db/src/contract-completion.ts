import type { Pool } from 'pg';
/** End the service term without changing any invoice, refund or balance. */
export async function completeDueContracts(pool: Pool, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new RangeError('Invalid completion batch size');
  const due = await pool.query<{ id: string; version_id: string }>(
    `SELECT c.id,c.current_version_id AS version_id FROM contracts c JOIN contract_activation_requirements r ON r.version_id=c.current_version_id WHERE c.state='Active' AND r.service_ends_at<=statement_timestamp() ORDER BY r.service_ends_at,c.id LIMIT $1`,
    [limit]
  );
  let completed = 0,
    skipped = 0;
  for (const row of due.rows) {
    try {
      const result = await pool.query(
        'INSERT INTO contract_completions(contract_id,version_id) VALUES($1,$2) ON CONFLICT (version_id) DO NOTHING RETURNING version_id',
        [row.id, row.version_id]
      );
      completed += result.rowCount ?? 0;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const changed =
        code === '23514' &&
        error &&
        typeof error === 'object' &&
        'constraint' in error &&
        error.constraint === 'contract_completion_prerequisites';
      if (code !== '55P03' && !changed) throw error;
      skipped++;
    }
  }
  return { completed, skipped };
}

import type { PoolClient, Pool } from 'pg';

export async function readContractActivation(
  client: PoolClient,
  id: string,
  versionId: string | undefined,
  staff: boolean,
  profileId?: string
) {
  const r = (
    await client.query<{
      id: string;
      version_id: string;
      current_version_id: string;
      state: string;
      archived: boolean;
      rule_revision: number;
      signature_required: boolean;
      payment_required: boolean;
      service_start_required: boolean;
      initial_invoice_id: string | null;
      service_starts_at: Date | null;
      approved: boolean;
      accepted: boolean;
      signed: boolean;
      paid: boolean;
      started: boolean;
      evaluated_at: Date;
    }>('SELECT * FROM contract_activation_status($1,$3,$2,$4)', [
      id,
      profileId ?? null,
      versionId ?? null,
      staff,
    ])
  ).rows[0];
  if (!r) return null;
  const check = (key: string, required: boolean, met: boolean) => ({
    key,
    required,
    status: !required ? 'not_required' : met ? 'met' : 'unmet',
  });
  const checks = [
    check('staffApproval', true, r.approved),
    check('customerAcceptance', true, r.accepted),
    check('signature', r.signature_required, r.signed),
    check('initialPayment', r.payment_required, r.paid),
    check('serviceStart', r.service_start_required, r.started),
  ];
  const isCurrent = r.version_id === r.current_version_id;
  return {
    contractId: r.id,
    versionId: r.version_id,
    state: r.state,
    isCurrent,
    ruleRevision: r.rule_revision,
    initialInvoiceId: r.initial_invoice_id,
    serviceStartsAt: r.service_starts_at?.toISOString() ?? null,
    evaluatedAt: r.evaluated_at.toISOString(),
    checks,
    ready:
      isCurrent &&
      !r.archived &&
      ['Accepted', 'Signed'].includes(r.state) &&
      checks.every((item) => item.status !== 'unmet'),
  };
}

/** The database rechecks and locks evidence before recording each activation. */
export async function activateReadyContracts(pool: Pool, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new RangeError('Invalid activation batch size');
  const candidates = await pool.query<{ id: string; version_id: string }>(
    `
 SELECT c.id,c.current_version_id AS version_id FROM contracts c
 CROSS JOIN LATERAL contract_activation_status(c.id,c.current_version_id) a
 WHERE c.state IN ('Accepted','Signed') AND NOT a.archived AND a.approved AND a.accepted
 AND (NOT a.signature_required OR a.signed) AND (NOT a.payment_required OR a.paid)
 AND (NOT a.service_start_required OR a.started)
 ORDER BY c.id LIMIT $1`,
    [limit]
  );
  let activated = 0,
    skipped = 0;
  for (const row of candidates.rows) {
    try {
      const result = await pool.query(
        'INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2) ON CONFLICT (version_id) DO NOTHING RETURNING version_id',
        [row.id, row.version_id]
      );
      activated += result.rowCount ?? 0;
    } catch (error) {
      // A concurrent lifecycle mutation or locked invoice/profile is retried by the next poll.
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const prerequisitesChanged =
        code === '23514' &&
        error &&
        typeof error === 'object' &&
        'constraint' in error &&
        error.constraint === 'contract_activation_prerequisites';
      if (code !== '55P03' && !prerequisitesChanged) throw error;
      skipped++;
    }
  }
  return { activated, skipped };
}

import type { Pool } from 'pg';

/** Domain evidence only; rejected feedback and exact replay must leave all entries unchanged. */
export async function contractJourneyEffects(
  pool: Pick<Pool, 'query'>,
  contractId: string,
  profileId: string
) {
  const related = async (
    table:
      | 'contract_versions'
      | 'contract_publications'
      | 'contract_acceptances'
      | 'contract_activation_requirements'
      | 'contract_signature_requests'
      | 'contract_signatures'
      | 'contract_documents'
  ) =>
    (await pool.query(`SELECT * FROM ${table} WHERE contract_id=$1 ORDER BY 1,2`, [contractId]))
      .rows;
  return {
    contract: (await pool.query('SELECT * FROM contracts WHERE id=$1', [contractId])).rows,
    versions: await related('contract_versions'),
    publications: await related('contract_publications'),
    acceptances: await related('contract_acceptances'),
    requirements: await related('contract_activation_requirements'),
    requests: await related('contract_signature_requests'),
    signatures: await related('contract_signatures'),
    documentLinks: await related('contract_documents'),
    documents: (
      await pool.query(
        'SELECT d.* FROM documents d JOIN contract_documents cd ON cd.document_id=d.id WHERE cd.contract_id=$1 ORDER BY d.id',
        [contractId]
      )
    ).rows,
    invoices: (
      await pool.query('SELECT * FROM invoices WHERE profile_id=$1 ORDER BY id', [profileId])
    ).rows,
    keys: (
      await pool.query(
        "SELECT * FROM idempotency_keys WHERE response->'request'->>'contractId'=$1 ORDER BY entity_type,idempotency_key",
        [contractId]
      )
    ).rows,
    audit: (
      await pool.query(
        "SELECT * FROM audit_log WHERE metadata::jsonb->>'contractId'=$1 ORDER BY id",
        [contractId]
      )
    ).rows,
    notices: (
      await pool.query('SELECT * FROM in_app_notifications WHERE profile_id=$1 ORDER BY id', [
        profileId,
      ])
    ).rows,
  };
}

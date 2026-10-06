import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/** Schema-valid retained signing records for terminal HTTP tests. The terminal
 * routes preserve these records; file upload/scan/signature APIs have their own tests. */
export async function seedElectricityTerminalSignature(
  pool: Pool,
  input: {
    contractId: string;
    versionId: string;
    profileId: string;
  },
  signed: boolean
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const document = async (role: 'original' | 'signed') => {
      const id = randomUUID(),
        upload = 'uploads/' + randomUUID(),
        copy = 'business-documents/' + randomUUID();
      await client.query(
        `INSERT INTO storage_records(storage_key,status,file_name,content_type,file_size,category,metadata) VALUES($1,'removed','terminal-fixture.pdf','application/pdf',20,'contract',$2::jsonb)`,
        [
          upload,
          JSON.stringify({
            uploadedBy: 'reviewer',
            provisionalUpload: true,
            uploadContext: { profileId: input.profileId, purpose: 'staff_business_document' },
          }),
        ]
      );
      await client.query(
        `INSERT INTO documents(id,profile_id,business_record_type,business_record_id,category,upload_key,original_name,size_bytes,uploaded_by,uploaded_by_type) VALUES($1,$2,'contract',$3,'contract',$4,'terminal-fixture.pdf',20,'reviewer','staff')`,
        [id, input.profileId, input.contractId, upload]
      );
      await client.query(
        'INSERT INTO contract_documents(contract_id,contract_version_id,document_id,role) VALUES($1,$2,$3,$4)',
        [input.contractId, input.versionId, id, role]
      );
      await client.query(
        `INSERT INTO document_events(document_id,revision,state,actor_id) VALUES($1,1,'Uploading','reviewer')`,
        [id]
      );
      await client.query(
        `INSERT INTO storage_records(storage_key,status,content_type,file_size,signed_at,metadata) VALUES($1,'immutable','application/pdf',20,NOW(),$2::jsonb)`,
        [
          copy,
          JSON.stringify({
            sourceKey: upload,
            sha256: 'a'.repeat(64),
            profileId: input.profileId,
            uploadedBy: 'reviewer',
          }),
        ]
      );
      let previous = 'Uploading',
        revision = 1;
      for (const state of ['PendingScan', 'Available', 'SubmittedForReview', 'Approved']) {
        if (state === 'PendingScan')
          await client.query("UPDATE documents SET state=$2,scan_state='Pending' WHERE id=$1", [
            id,
            state,
          ]);
        else if (state === 'Available')
          await client.query(
            "UPDATE documents SET state=$2,scan_state='Available',scan_skipped_reason='not_configured',storage_key=$3,checksum=$4,detected_mime='application/pdf' WHERE id=$1",
            [id, state, copy, 'a'.repeat(64)]
          );
        else await client.query('UPDATE documents SET state=$2 WHERE id=$1', [id, state]);
        await client.query(
          "INSERT INTO document_events(document_id,revision,previous_state,state,actor_id) VALUES($1,$2,$3,$4,'reviewer')",
          [id, ++revision, previous, state]
        );
        previous = state;
      }
      return id;
    };
    const original = await document('original');
    const request = (
      await client.query(
        `INSERT INTO contract_signature_requests(contract_id,version_id,request_number,original_document_id,requested_by) VALUES($1,$2,1,$3,'reviewer') RETURNING id`,
        [input.contractId, input.versionId, original]
      )
    ).rows[0]!.id;
    if (signed) {
      const copy = await document('signed');
      await client.query(
        `INSERT INTO contract_signatures(contract_id,version_id,request_id,signed_document_id,recorded_by,recorded_by_type) VALUES($1,$2,$3,$4,'reviewer','staff')`,
        [input.contractId, input.versionId, request, copy]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function electricityTerminalEvidence(pool: Pool, contractId: string) {
  return (
    await pool.query(
      `SELECT c.current_version_id,c.accepted_at,c.signed_at,
    (SELECT jsonb_agg(to_jsonb(v) ORDER BY version_number) FROM contract_versions v WHERE v.contract_id=c.id) AS versions,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY version_id) FROM contract_publications p WHERE p.contract_id=c.id) AS publications,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY version_id) FROM contract_acceptances a WHERE a.contract_id=c.id) AS acceptances,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY request_number) FROM contract_signature_requests r WHERE r.contract_id=c.id) AS requests,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY version_id) FROM contract_signatures s WHERE s.contract_id=c.id) AS signatures,
    (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM documents d JOIN contract_documents l ON l.document_id=d.id WHERE l.contract_id=c.id) AS documents,
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.document_id,e.revision) FROM document_events e JOIN contract_documents l ON l.document_id=e.document_id WHERE l.contract_id=c.id) AS documentEvents
    FROM contracts c WHERE c.id=$1`,
      [contractId]
    )
  ).rows[0];
}

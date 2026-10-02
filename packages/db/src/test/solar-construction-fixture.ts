import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
/** Real prerequisite records using production lifecycle and document guards. */
export async function seedSolarConstruction(
  pool: Pool,
  owner: string,
  actor: string,
  options: { activate?: boolean; postal?: boolean; completed?: boolean } = {}
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const profile = randomUUID(),
      contract = randomUUID(),
      version = randomUUID();
    await client.query(
      "INSERT INTO profiles(id,user_id,profile_type,status) VALUES($1,$2,'INDIVIDUAL','ACTIVE')",
      [profile, owner]
    );
    await client.query(
      "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'solar',$3)",
      [contract, profile, version]
    );
    await client.query(
      'INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3::jsonb,$4,$5)',
      [version, contract, JSON.stringify({ text: 'Accepted terms' }), 'Initial', actor]
    );
    if (options.completed)
      await client.query(
        "UPDATE contract_activation_requirements SET service_ends_at=NOW()-INTERVAL '1 day' WHERE version_id=$1",
        [version]
      );
    {
      await client.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [
        contract,
      ]);
      await client.query(
        'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
        [contract, version, actor]
      );
      await client.query(
        'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
        [contract, version, owner]
      );
    }
    const doc = async (role: string) => {
      const id = randomUUID(),
        upload = 'uploads/' + randomUUID(),
        copy = 'business-documents/' + randomUUID();
      await client.query(
        "INSERT INTO storage_records(storage_key,status,file_name,content_type,file_size,category,metadata) VALUES($1,'removed','copy.pdf','application/pdf',20,'contract',$2::jsonb)",
        [
          upload,
          JSON.stringify({
            uploadedBy: actor,
            provisionalUpload: true,
            uploadContext: { profileId: profile, purpose: 'staff_business_document' },
          }),
        ]
      );
      await client.query(
        "INSERT INTO documents(id,profile_id,business_record_type,business_record_id,category,upload_key,original_name,size_bytes,uploaded_by,uploaded_by_type) VALUES($1,$2,'contract',$3,'contract',$4,'copy.pdf',20,$5,'staff')",
        [id, profile, contract, upload, actor]
      );
      await client.query(
        'INSERT INTO contract_documents(contract_id,contract_version_id,document_id,role) VALUES($1,$2,$3,$4)',
        [contract, version, id, role]
      );
      await client.query(
        "INSERT INTO document_events(document_id,revision,state,actor_id) VALUES($1,1,'Uploading',$2)",
        [id, actor]
      );
      await client.query(
        "INSERT INTO storage_records(storage_key,status,content_type,file_size,signed_at,metadata) VALUES($1,'immutable','application/pdf',20,NOW(),$2::jsonb)",
        [
          copy,
          JSON.stringify({
            sourceKey: upload,
            sha256: 'a'.repeat(64),
            profileId: profile,
            uploadedBy: actor,
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
        revision++;
        await client.query(
          'INSERT INTO document_events(document_id,revision,previous_state,state,actor_id) VALUES($1,$2,$3,$4,$5)',
          [id, revision, previous, state, actor]
        );
        previous = state;
      }
      return id;
    };
    const original = await doc('original'),
      signed = await doc('signed');
    const signatureRequest = (
      await client.query(
        'INSERT INTO contract_signature_requests(contract_id,version_id,request_number,original_document_id,requested_by) VALUES($1,$2,1,$3,$4) RETURNING id',
        [contract, version, original, actor]
      )
    ).rows[0].id;
    await client.query(
      "INSERT INTO contract_signatures(contract_id,version_id,request_id,signed_document_id,recorded_by,recorded_by_type) VALUES($1,$2,$3,$4,$5,'staff')",
      [contract, version, signatureRequest, signed, actor]
    );
    if (options.activate !== false)
      await client.query('INSERT INTO contract_activations(contract_id,version_id) VALUES($1,$2)', [
        contract,
        version,
      ]);
    if (options.completed)
      await client.query('INSERT INTO contract_completions(contract_id,version_id) VALUES($1,$2)', [
        contract,
        version,
      ]);
    const request = (
      await client.query(
        "INSERT INTO solar_construction_requests(profile_id,submitted_by,submission_key,status,contract_id,building_type,grid_type,property_form,structural_frame,building_completion_date,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at) VALUES($1,$2,$3,'contract_created',$4,'building_apartment','off_grid','villa','concrete','2020-01-01',true,'fixture-v1','Accepted fixture terms',NOW()) RETURNING id",
        [profile, owner, randomUUID(), contract]
      )
    ).rows[0].id;
    if (options.postal !== false)
      await client.query(
        "INSERT INTO solar_construction_postal(request_id,status,staff_confirmed_by,staff_confirmed_at) VALUES($1,'received',$2,clock_timestamp())",
        [request, actor]
      );
    await client.query('COMMIT');
    return { actor, owner, profile, contract, version, original, signed, request };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
